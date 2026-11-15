import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { botTriggers, bots } from "@/lib/db/schema";
import { createNotification } from "@/lib/notifications/store";
import { enqueueJob } from "@/lib/worker/jobs";
import type { FinishedInfo } from "./executor";

/** Profundidad máxima de agentes encadenados: A → B → C. Evita bucles A → B → A. */
export const MAX_CHAIN_DEPTH = 3;

const preview = (text: string, max = 200) => (text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * Qué pasa cuando termina un run:
 *  - si lo lanzó una rutina o disparador, se avisa en la bandeja;
 *  - si fue bien, se disparan los agentes que esperan a este (`bot_completed`).
 */
export function makeOnFinished(options: { chainDepth?: number } = {}) {
  const depth = options.chainDepth ?? 0;

  return async (info: FinishedInfo): Promise<void> => {
    const unattended = info.initiator !== "user";

    if (unattended) {
      const base = { userId: info.userId, agentId: null, runId: info.runId, threadId: info.threadId };
      if (info.outcome === "success") {
        await createNotification({ ...base, kind: "run_completed", title: `${info.agentName} ha terminado`, body: preview(info.text) });
      } else if (info.outcome === "error") {
        await createNotification({ ...base, kind: "run_failed", title: `${info.agentName} falló`, body: preview(info.text) });
      } else if (info.outcome === "interrupt") {
        const approval = info.interrupts?.some((item) => item.reason === "approval");
        await createNotification({
          ...base,
          kind: approval ? "needs_approval" : "needs_input",
          title: approval ? `${info.agentName} necesita tu aprobación` : `${info.agentName} necesita tu respuesta`,
          body: info.interrupts?.map((item) => item.toolName ?? item.reason).join(", ") ?? "",
        });
      }
    }

    if (info.outcome === "success" && info.botId && depth < MAX_CHAIN_DEPTH) {
      await fireAgentCompleted(info, depth);
    }
  };
}

/** Encola un run para cada agente que esté suscrito al fin de este (solo del mismo dueño). */
async function fireAgentCompleted(info: FinishedInfo, depth: number): Promise<void> {
  if (!info.botId) return;
  const rows = await db
    .select({ id: botTriggers.id, botId: botTriggers.botId, prompt: botTriggers.prompt, config: botTriggers.config })
    .from(botTriggers)
    .innerJoin(bots, eq(bots.id, botTriggers.botId))
    .where(and(eq(botTriggers.kind, "bot_completed"), eq(botTriggers.enabled, true), eq(bots.ownerId, info.userId)));

  for (const trigger of rows) {
    const config = trigger.config as { sourceBotId?: string };
    // Un agente no se dispara a sí mismo: sería un bucle inmediato.
    if (config.sourceBotId !== info.botId || trigger.botId === info.botId) continue;
    await enqueueJob({
      kind: "bot_run",
      dedupeKey: `chain:${info.runId}:${trigger.id}`,
      payload: {
        botId: trigger.botId,
        triggerId: trigger.id,
        prompt: trigger.prompt || "Otro agente ha terminado. Revisa su resultado y continúa con tu tarea.",
        context: `Resultado del agente «${info.agentName}»:\n${info.text.slice(0, 8000)}`,
        source: `agente ${info.agentName}`,
        chainDepth: depth + 1,
      },
    });
  }
}
