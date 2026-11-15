import { and, asc, eq, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { bots, botTriggers, type TriggerKind } from "@/lib/db/schema";
import { enqueueJob } from "@/lib/worker/jobs";
import { nextCronRun, validateCron } from "./cron";
import { newHookToken } from "./hooks";

export const MAX_TRIGGERS_PER_BOT = 10;
/** Un feed o una página vigilada no se consulta más a menudo que esto. */
export const MIN_POLL_MINUTES = 15;

export type TriggerRow = typeof botTriggers.$inferSelect;

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
    case "bot_completed": {
      const sourceBotId = asString(config.sourceBotId);
      if (!/^[0-9a-f-]{36}$/i.test(sourceBotId)) return { ok: false, error: "Indica el Nexbot que se espera" };
      return { ok: true, config: { sourceBotId }, nextRunAt: null };
    }
  }
}

export async function createTrigger(
  ownerId: string,
  botId: string,
  input: NewTrigger,
): Promise<CreateTriggerResult> {
  const [agent] = await db
    .select({ id: bots.id })
    .from(bots)
    .where(and(eq(bots.id, botId), eq(bots.ownerId, ownerId)))
    .limit(1);
  if (!agent) return { ok: false, error: "Nexbot no encontrado" };

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(botTriggers)
    .where(eq(botTriggers.botId, botId));
  if (count >= MAX_TRIGGERS_PER_BOT) {
    return { ok: false, error: `Un Nexbot admite como máximo ${MAX_TRIGGERS_PER_BOT} disparadores` };
  }

  if (input.kind === "bot_completed") {
    // Solo se puede escuchar a un Nexbot propio: si no, se leería actividad ajena.
    const source = asString(input.config.sourceBotId);
    const [owned] = await db
      .select({ id: bots.id })
      .from(bots)
      .where(and(eq(bots.id, source), eq(bots.ownerId, ownerId)))
      .limit(1);
    if (!owned) return { ok: false, error: "El Nexbot que esperas no existe o no es tuyo" };
    if (source === botId) return { ok: false, error: "Un Nexbot no puede dispararse a sí mismo" };
  }

  const prepared = prepareTrigger(input);
  if (!prepared.ok) return prepared;

  const [trigger] = await db
    .insert(botTriggers)
    .values({
      botId,
      kind: input.kind,
      name: (input.name ?? "").slice(0, 80),
      prompt: (input.prompt ?? "").slice(0, 4000),
      config: prepared.config,
      nextRunAt: prepared.nextRunAt,
    })
    .returning();
  return { ok: true, trigger, webhookToken: prepared.webhookToken };
}

export async function listTriggers(ownerId: string, botId: string): Promise<TriggerRow[]> {
  return db
    .select({ t: botTriggers })
    .from(botTriggers)
    .innerJoin(bots, eq(bots.id, botTriggers.botId))
    .where(and(eq(botTriggers.botId, botId), eq(bots.ownerId, ownerId)))
    .orderBy(asc(botTriggers.createdAt))
    .then((rows) => rows.map((row) => row.t));
}

export async function setTriggerEnabled(ownerId: string, triggerId: string, enabled: boolean): Promise<boolean> {
  const [row] = await db
    .select({ t: botTriggers })
    .from(botTriggers)
    .innerJoin(bots, eq(bots.id, botTriggers.botId))
    .where(and(eq(botTriggers.id, triggerId), eq(bots.ownerId, ownerId)))
    .limit(1);
  if (!row) return false;
  const prepared = enabled ? prepareTrigger({ kind: row.t.kind, config: row.t.config as Record<string, unknown> }) : null;
  await db
    .update(botTriggers)
    .set({
      enabled,
      failureCount: 0,
      // Al reactivar se recalcula la próxima ejecución (si no, dispararía de golpe lo atrasado).
      ...(prepared?.ok && row.t.kind !== "webhook" ? { nextRunAt: prepared.nextRunAt } : {}),
    })
    .where(eq(botTriggers.id, triggerId));
  return true;
}

export async function deleteTrigger(ownerId: string, triggerId: string): Promise<boolean> {
  const owned = db.select({ id: bots.id }).from(bots).where(eq(bots.ownerId, ownerId));
  const removed = await db
    .delete(botTriggers)
    .where(and(eq(botTriggers.id, triggerId), sql`${botTriggers.botId} IN (${owned})`))
    .returning({ id: botTriggers.id });
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
    .from(botTriggers)
    .where(and(eq(botTriggers.enabled, true), isNotNull(botTriggers.nextRunAt), lte(botTriggers.nextRunAt, now)))
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
    await db.update(botTriggers).set({ enabled: false }).where(eq(botTriggers.id, trigger.id));
    return false;
  }
  const won = await db
    .update(botTriggers)
    .set({ nextRunAt: next, lastRunAt: now })
    // Postgres guarda microsegundos y JS milisegundos: se compara a milisegundos o un
    // valor escrito desde SQL nunca coincidiría y el disparador quedaría atascado.
    .where(
      and(
        eq(botTriggers.id, trigger.id),
        sql`date_trunc('milliseconds', ${botTriggers.nextRunAt}) = ${trigger.nextRunAt.toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: botTriggers.id });
  if (won.length === 0) return false;
  await enqueueJob({
    kind: "trigger_poll",
    payload: { triggerId: trigger.id },
    dedupeKey: `poll:${trigger.id}:${trigger.nextRunAt.toISOString()}`,
  });
  return true;
}
