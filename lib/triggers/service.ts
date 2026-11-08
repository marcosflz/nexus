import { and, asc, eq, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { agents, agentTriggers, type TriggerKind } from "@/lib/db/schema";
import { enqueueJob } from "@/lib/worker/jobs";
import { nextCronRun, validateCron } from "./cron";
import { newHookToken } from "./hooks";

export const MAX_TRIGGERS_PER_AGENT = 10;
/** Un feed o una página vigilada no se consulta más a menudo que esto. */
export const MIN_POLL_MINUTES = 15;

export type TriggerRow = typeof agentTriggers.$inferSelect;

export interface NewTrigger {
  kind: TriggerKind;
  name?: string;
  prompt?: string;
  config: Record<string, unknown>;
}

export type CreateTriggerResult =
  | { ok: true; trigger: TriggerRow; webhookToken?: string }
  | { ok: false; error: string };

const asString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Valida el config de un disparador y calcula su primera ejecución. */
export function prepareTrigger(
  input: NewTrigger,
  now: Date = new Date(),
): { ok: true; config: Record<string, unknown>; nextRunAt: Date | null; webhookToken?: string } | { ok: false; error: string } {
  const config = input.config;
  switch (input.kind) {
    case "cron": {
      const expr = asString(config.expr);
      const tz = asString(config.tz) || "UTC";
      const check = validateCron(expr, tz, now);
      if (!check.ok) return check;
      return { ok: true, config: { expr, tz }, nextRunAt: nextCronRun(expr, tz, now) };
    }
    case "webhook": {
      const { token, hash } = newHookToken();
      return { ok: true, config: { tokenHash: hash }, nextRunAt: null, webhookToken: token };
    }
    case "rss":
    case "watch": {
      const url = asString(config.url);
      if (!/^https?:\/\//i.test(url)) return { ok: false, error: "Indica una URL http(s)" };
      const intervalMin = Math.max(MIN_POLL_MINUTES, Math.min(Number(config.intervalMin) || 60, 24 * 60));
      return { ok: true, config: { url, intervalMin }, nextRunAt: new Date(now.getTime() + intervalMin * 60_000) };
    }
    case "agent_completed": {
      const sourceAgentId = asString(config.sourceAgentId);
      if (!/^[0-9a-f-]{36}$/i.test(sourceAgentId)) return { ok: false, error: "Indica el agente que se espera" };
      return { ok: true, config: { sourceAgentId }, nextRunAt: null };
    }
  }
}

export async function createTrigger(
  ownerId: string,
  agentId: string,
  input: NewTrigger,
): Promise<CreateTriggerResult> {
  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.ownerId, ownerId)))
    .limit(1);
  if (!agent) return { ok: false, error: "Agente no encontrado" };

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentTriggers)
    .where(eq(agentTriggers.agentId, agentId));
  if (count >= MAX_TRIGGERS_PER_AGENT) {
    return { ok: false, error: `Un agente admite como máximo ${MAX_TRIGGERS_PER_AGENT} disparadores` };
  }

  if (input.kind === "agent_completed") {
    // Solo se puede escuchar a un agente propio: si no, se leería actividad ajena.
    const source = asString(input.config.sourceAgentId);
    const [owned] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, source), eq(agents.ownerId, ownerId)))
      .limit(1);
    if (!owned) return { ok: false, error: "El agente que esperas no existe o no es tuyo" };
    if (source === agentId) return { ok: false, error: "Un agente no puede dispararse a sí mismo" };
  }

  const prepared = prepareTrigger(input);
  if (!prepared.ok) return prepared;

  const [trigger] = await db
    .insert(agentTriggers)
    .values({
      agentId,
      kind: input.kind,
      name: (input.name ?? "").slice(0, 80),
      prompt: (input.prompt ?? "").slice(0, 4000),
      config: prepared.config,
      nextRunAt: prepared.nextRunAt,
    })
    .returning();
  return { ok: true, trigger, webhookToken: prepared.webhookToken };
}

export async function listTriggers(ownerId: string, agentId: string): Promise<TriggerRow[]> {
  return db
    .select({ t: agentTriggers })
    .from(agentTriggers)
    .innerJoin(agents, eq(agents.id, agentTriggers.agentId))
    .where(and(eq(agentTriggers.agentId, agentId), eq(agents.ownerId, ownerId)))
    .orderBy(asc(agentTriggers.createdAt))
    .then((rows) => rows.map((row) => row.t));
}

export async function setTriggerEnabled(ownerId: string, triggerId: string, enabled: boolean): Promise<boolean> {
  const [row] = await db
    .select({ t: agentTriggers })
    .from(agentTriggers)
    .innerJoin(agents, eq(agents.id, agentTriggers.agentId))
    .where(and(eq(agentTriggers.id, triggerId), eq(agents.ownerId, ownerId)))
    .limit(1);
  if (!row) return false;
  const prepared = enabled ? prepareTrigger({ kind: row.t.kind, config: row.t.config as Record<string, unknown> }) : null;
  await db
    .update(agentTriggers)
    .set({
      enabled,
      failureCount: 0,
      // Al reactivar se recalcula la próxima ejecución (si no, dispararía de golpe lo atrasado).
      ...(prepared?.ok && row.t.kind !== "webhook" ? { nextRunAt: prepared.nextRunAt } : {}),
    })
    .where(eq(agentTriggers.id, triggerId));
  return true;
}

export async function deleteTrigger(ownerId: string, triggerId: string): Promise<boolean> {
  const owned = db.select({ id: agents.id }).from(agents).where(eq(agents.ownerId, ownerId));
  const removed = await db
    .delete(agentTriggers)
    .where(and(eq(agentTriggers.id, triggerId), sql`${agentTriggers.agentId} IN (${owned})`))
    .returning({ id: agentTriggers.id });
  return removed.length > 0;
}

/**
 * Convierte en trabajos los disparadores vencidos (cron, rss, watch).
 *
 * `next_run_at` avanza con un UPDATE condicionado al valor anterior: si dos
 * ticks (o dos instancias) ven el mismo disparador, solo uno lo gana. La clave
 * de deduplicación del trabajo es un segundo cinturón de seguridad.
 */
export async function scheduleDueTriggers(now: Date = new Date()): Promise<number> {
  const due = await db
    .select()
    .from(agentTriggers)
    .where(and(eq(agentTriggers.enabled, true), isNotNull(agentTriggers.nextRunAt), lte(agentTriggers.nextRunAt, now)))
    .limit(100);

  let scheduled = 0;
  for (const trigger of due) {
    try {
      if (await scheduleOne(trigger, now)) scheduled += 1;
    } catch (error) {
      // Un disparador defectuoso no debe impedir que se planifiquen los demás.
      console.error(`[nexus] no se pudo planificar el disparador ${trigger.id}:`, error);
    }
  }
  return scheduled;
}

async function scheduleOne(trigger: TriggerRow, now: Date): Promise<boolean> {
  if (!trigger.nextRunAt) return false;
  const config = trigger.config as { expr?: string; tz?: string; intervalMin?: number };
  let next: Date;
  try {
    next =
      trigger.kind === "cron"
        ? nextCronRun(config.expr ?? "", config.tz ?? "UTC", now)
        : new Date(now.getTime() + (config.intervalMin ?? 60) * 60_000);
  } catch {
    // Un cron corrupto no debe bloquear al resto: se desactiva.
    await db.update(agentTriggers).set({ enabled: false }).where(eq(agentTriggers.id, trigger.id));
    return false;
  }
  const won = await db
    .update(agentTriggers)
    .set({ nextRunAt: next, lastRunAt: now })
    // Postgres guarda microsegundos y JS milisegundos: se compara a milisegundos o un
    // valor escrito desde SQL nunca coincidiría y el disparador quedaría atascado.
    .where(
      and(
        eq(agentTriggers.id, trigger.id),
        sql`date_trunc('milliseconds', ${agentTriggers.nextRunAt}) = ${trigger.nextRunAt.toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: agentTriggers.id });
  if (won.length === 0) return false;
  await enqueueJob({
    kind: "trigger_poll",
    payload: { triggerId: trigger.id },
    dedupeKey: `poll:${trigger.id}:${trigger.nextRunAt.toISOString()}`,
  });
  return true;
}
