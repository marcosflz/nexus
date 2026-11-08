import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { runEvents, runs } from "@/lib/db/schema";
import type { HermesTokens } from "@/lib/hermes/events";
import {
  RUN_LEASE_MS,
  nextRunState,
  type Run,
  type RunEventRecord,
  type RunInitiator,
  type RunStatus,
} from "./types";

function toRun(row: typeof runs.$inferSelect): Run {
  return {
    id: row.id,
    threadId: row.threadId,
    userId: row.userId,
    status: row.status as RunStatus,
    initiator: row.initiator as RunInitiator,
    backend: row.backend,
    agentId: row.agentId,
    agentVersionId: row.agentVersionId,
    agentSessionId: row.agentSessionId,
    leaseUntil: row.leaseUntil,
    heartbeatAt: row.heartbeatAt,
    lastSeq: row.lastSeq,
    error: row.error,
    usage: (row.usage as HermesTokens | null) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface CreateRunOptions {
  initiator?: RunInitiator;
  backend?: string;
  parentRunId?: string | null;
  agentId?: string | null;
  agentVersionId?: string | null;
}

export async function createRun(
  threadId: string,
  userId: string,
  prompt: string,
  options: CreateRunOptions = {},
): Promise<Run> {
  const now = new Date();
  const [row] = await db
    .insert(runs)
    .values({
      threadId,
      userId,
      prompt,
      status: "running",
      initiator: options.initiator ?? "user",
      backend: options.backend ?? null,
      parentRunId: options.parentRunId ?? null,
      agentId: options.agentId ?? null,
      agentVersionId: options.agentVersionId ?? null,
      leaseUntil: new Date(now.getTime() + RUN_LEASE_MS),
      heartbeatAt: now,
    })
    .returning();
  return toRun(row);
}

export interface NewRunEvent {
  seq: number;
  type: string;
  payload: unknown;
}

/**
 * Añade eventos al log del run en una sola escritura. No toca `runs`: el
 * `last_seq` se actualiza en el heartbeat y al cerrar, no en cada delta.
 */
export async function appendEvents(runId: string, events: NewRunEvent[]): Promise<void> {
  if (events.length === 0) return;
  await db
    .insert(runEvents)
    .values(
      events.map((event) => ({
        runId,
        seq: event.seq,
        type: event.type,
        payload: event.payload as never,
      })),
    )
    .onConflictDoNothing();
}

export async function appendEvent(
  runId: string,
  seq: number,
  type: string,
  payload: unknown,
): Promise<void> {
  await appendEvents(runId, [{ seq, type, payload }]);
  await db
    .update(runs)
    .set({ lastSeq: seq, updatedAt: new Date() })
    .where(eq(runs.id, runId));
}

export async function heartbeat(runId: string, lastSeq?: number): Promise<void> {
  const now = new Date();
  await db
    .update(runs)
    .set({
      heartbeatAt: now,
      leaseUntil: new Date(now.getTime() + RUN_LEASE_MS),
      updatedAt: now,
      ...(lastSeq === undefined ? {} : { lastSeq }),
    })
    .where(eq(runs.id, runId));
}

export async function setAgentSession(runId: string, sessionId: string): Promise<void> {
  await db
    .update(runs)
    .set({ agentSessionId: sessionId, updatedAt: new Date() })
    .where(eq(runs.id, runId));
}

export interface FinishOptions {
  usage?: HermesTokens | null;
  error?: string | null;
  lastSeq?: number;
  outcome?: unknown;
  /** Sesión del motor para reanudar (solo al pausar). */
  checkpoint?: unknown;
}

export async function finishRun(
  runId: string,
  transition: {
    kind: "finished" | "error" | "cancelled" | "awaiting-input";
    interrupted?: boolean;
  },
  options: FinishOptions = {},
): Promise<RunStatus> {
  const [current] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!current) return "error";

  const at = new Date();
  const from = current.status as RunStatus;
  const status =
    transition.kind === "finished"
      ? nextRunState(from, {
          kind: "finished",
          at,
          interrupted: Boolean(transition.interrupted),
        })
      : nextRunState(from, { kind: transition.kind, at });

  await db
    .update(runs)
    .set({
      status,
      // Un run en pausa no necesita lease: no hay proceso que lo mantenga vivo.
      leaseUntil: null,
      error: options.error ?? null,
      usage: (options.usage ?? null) as never,
      outcome: (options.outcome ?? null) as never,
      ...(options.checkpoint === undefined ? {} : { checkpoint: options.checkpoint as never }),
      updatedAt: at,
      ...(options.lastSeq === undefined ? {} : { lastSeq: options.lastSeq }),
    })
    .where(eq(runs.id, runId));

  return status;
}

/** Run del usuario sin sus eventos (para comprobar propiedad y estado). */
export async function getRunMeta(runId: string, userId: string): Promise<Run | null> {
  const [row] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
    .limit(1);
  return row ? toRun(row) : null;
}

/** Eventos con `seq` estrictamente mayor que `after`, en orden. */
export async function getEventsAfter(runId: string, after: number): Promise<RunEventRecord[]> {
  const rows = await db
    .select()
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), gt(runEvents.seq, after)))
    .orderBy(asc(runEvents.seq));
  return rows.map((event) => ({
    runId: event.runId,
    seq: event.seq,
    type: event.type,
    payload: event.payload,
    createdAt: event.createdAt,
  }));
}

export async function getRun(
  runId: string,
  userId: string,
): Promise<{ run: Run; events: RunEventRecord[] } | null> {
  const run = await getRunMeta(runId, userId);
  if (!run) return null;
  return { run, events: await getEventsAfter(runId, 0) };
}

/** Sesión guardada de un run en pausa. */
export async function getRunCheckpoint(runId: string): Promise<unknown[] | null> {
  const [row] = await db
    .select({ checkpoint: runs.checkpoint })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  return Array.isArray(row?.checkpoint) ? (row.checkpoint as unknown[]) : null;
}

/**
 * Vuelve a poner en marcha un run en pausa. Solo transiciona desde
 * `awaiting_input`; devuelve false si otro proceso ya lo reanudó (carrera de
 * dos pestañas respondiendo a la vez).
 */
export async function reopenRun(runId: string): Promise<boolean> {
  const now = new Date();
  const updated = await db
    .update(runs)
    .set({
      status: "running",
      leaseUntil: new Date(now.getTime() + RUN_LEASE_MS),
      heartbeatAt: now,
      updatedAt: now,
    })
    .where(and(eq(runs.id, runId), eq(runs.status, "awaiting_input")))
    .returning({ id: runs.id });
  return updated.length > 0;
}

/**
 * Último run de un hilo que sigue en marcha o a la espera del usuario.
 *
 * El ejecutor guarda el evento final *antes* de cambiar el estado del run, así
 * que hay una ventana de milisegundos en la que `status` aún dice `running` pero
 * la respuesta ya está completa y guardada. Si se anunciara como activo, la UI
 * se enganchería y mostraría la respuesta dos veces: por eso un run con evento
 * terminal persistido no cuenta como activo.
 */
export async function getActiveRunForThread(threadId: string): Promise<Run | null> {
  const [row] = await db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.threadId, threadId),
        inArray(runs.status, ["running", "awaiting_input"]),
        sql`NOT EXISTS (
          SELECT 1 FROM run_events e
          WHERE e.run_id = ${runs.id}
            AND (e.type = 'RUN_ERROR'
                 OR (e.type = 'RUN_FINISHED' AND coalesce(e.payload->'outcome'->>'type', 'success') <> 'interrupt'))
            AND e.seq = (SELECT max(seq) FROM run_events WHERE run_id = ${runs.id})
        )`,
      ),
    )
    .orderBy(desc(runs.createdAt))
    .limit(1);
  return row ? toRun(row) : null;
}

/**
 * Marca como `interrupted` los runs que ya no tienen quien los ejecute.
 *
 * Por defecto solo toca los de lease vencido. Al arrancar el proceso se usa
 * `ignoreLease`: el bus y el ejecutor son de un solo proceso, así que cualquier
 * run `running` que no esté en el registro de este proceso (que arranca vacío)
 * pertenece a uno anterior que murió, aunque su lease aún no haya vencido.
 * Los `awaiting_input` no se tocan: están pausados, no huérfanos.
 */
export async function reclaimExpiredRuns(
  now: Date = new Date(),
  options: { ignoreLease?: boolean } = {},
): Promise<number> {
  const stale = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      options.ignoreLease
        ? eq(runs.status, "running")
        : and(eq(runs.status, "running"), or(isNull(runs.leaseUntil), lt(runs.leaseUntil, now))),
    );

  if (stale.length === 0) return 0;

  for (const { id } of stale) {
    await db
      .update(runs)
      .set({ status: "interrupted", leaseUntil: null, updatedAt: now })
      .where(eq(runs.id, id));
  }
  return stale.length;
}
