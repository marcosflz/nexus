import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agents, messages, threads } from "@/lib/db/schema";
import { checkAgentBudget } from "@/lib/agents/budget";
import { BACKEND_UNAVAILABLE, getBackend, isBackendAvailable } from "@/lib/agents/registry";
import { loadVersion } from "@/lib/agents/store";
import { connectorsForRun } from "@/lib/connectors/store";
import { createNotification } from "@/lib/notifications/store";
import { defaultExecutorDeps } from "./deps";
import { makeOnFinished } from "./finish-hooks";
import { loadCredential } from "./launch";
import { activeRunCount } from "./registry";
import { startRun } from "./start";
import { createRun } from "./store";

export const maxConcurrentRuns = () => Math.max(1, Number(process.env.NEXUS_MAX_CONCURRENT_RUNS) || 4);

export type RoutineOutcome =
  | { ok: true; runId: string; threadId: string }
  /** `retry`: no es un fallo del agente sino falta de hueco; se vuelve a intentar luego. */
  | { ok: false; error: string; retry?: boolean };

export interface RoutineRequest {
  agentId: string;
  triggerId?: string | null;
  prompt: string;
  /** Contexto no confiable (cuerpo de un webhook, contenido nuevo de un feed…). */
  context?: string;
  /** De dónde viene, para el título del hilo: «cron», «webhook», «agente X»… */
  source: string;
  chainDepth?: number;
}

/**
 * Lanza un run sin que nadie esté mirando: lo originan un cron, un webhook, un
 * feed o el fin de otro agente. Corre con la identidad y los permisos del
 * dueño del agente y con `initiator: "routine"`, así que toda acción con
 * efectos pasa por el motor de políticas y pide aprobación.
 */
export async function launchRoutineRun(request: RoutineRequest): Promise<RoutineOutcome> {
  const [agent] = await db.select().from(agents).where(eq(agents.id, request.agentId)).limit(1);
  if (!agent?.currentVersionId) return { ok: false, error: "El agente ya no existe" };
  if (agent.status !== "active") return { ok: false, error: "El agente está en pausa" };

  const resolved = await loadVersion(agent, agent.currentVersionId);
  if (!resolved) return { ok: false, error: "La versión del agente no es válida" };
  const { spec } = resolved;

  if (activeRunCount() >= maxConcurrentRuns()) {
    return { ok: false, error: "No hay hueco para otro run ahora mismo", retry: true };
  }

  const notify = (kind: "run_failed" | "budget_exceeded", title: string, body: string) =>
    createNotification({ userId: agent.ownerId, agentId: agent.id, kind, title, body });

  const budget = await checkAgentBudget(agent.id, spec, agent.ownerId);
  if (!budget.ok) {
    await notify("budget_exceeded", `${spec.name}: presupuesto agotado`, budget.reason);
    return { ok: false, error: budget.reason };
  }

  if (!isBackendAvailable()) {
    const error = BACKEND_UNAVAILABLE;
    await notify("run_failed", `${spec.name} no pudo ejecutarse`, error);
    return { ok: false, error };
  }
  const credential = await loadCredential(agent.ownerId, spec.model.provider);
  if (!credential.ok) {
    await notify("run_failed", `${spec.name} no pudo ejecutarse`, credential.error);
    return { ok: false, error: credential.error };
  }

  const text = request.context ? `${request.prompt}\n\n${request.context}` : request.prompt;
  const [thread] = await db
    .insert(threads)
    .values({
      userId: agent.ownerId,
      title: `${spec.name} · ${request.source}`.slice(0, 120),
      agentId: agent.id,
      backend: "nas-adk",
      origin: "routine",
    })
    .returning({ id: threads.id });
  await db.insert(messages).values({ threadId: thread.id, role: "user", content: text.slice(0, 20_000), agentId: agent.id });

  const backend = getBackend();
  const run = await createRun(thread.id, agent.ownerId, text, {
    initiator: "trigger",
    backend: backend.id,
    agentId: agent.id,
    agentVersionId: resolved.versionId,
  });

  void startRun(
    backend,
    {
      runId: run.id,
      threadId: thread.id,
      userId: agent.ownerId,
      initiator: "trigger",
      credential: { ...credential.value, model: spec.model.model || credential.value.model },
      userText: text,
      agent: { id: agent.id, versionId: resolved.versionId, spec },
      connectors: (await connectorsForRun(agent.ownerId, agent.id, spec)).links,
      limits: { maxTurns: spec.budgets.maxToolCalls || 25 },
    },
    { ...defaultExecutorDeps(), onFinished: makeOnFinished({ chainDepth: request.chainDepth }) },
  );

  return { ok: true, runId: run.id, threadId: thread.id };
}
