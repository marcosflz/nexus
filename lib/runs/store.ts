import { and, asc, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { runEvents, runs } from "@/lib/db/schema";
import type { HermesTokens } from "@/lib/hermes/events";
import {
  RUN_LEASE_MS,
  nextRunState,
  type Run,
  type RunEventRecord,
  type RunStatus,
} from "./types";

function toRun(row: typeof runs.$inferSelect): Run {
  return {
    id: row.id,
    threadId: row.threadId,
    userId: row.userId,
    status: row.status as RunStatus,
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

export async function createRun(threadId: string, userId: string, prompt: string): Promise<Run> {
  const now = new Date();
  const [row] = await db
    .insert(runs)
    .values({
      threadId,
      userId,
      prompt,
      status: "running",
      leaseUntil: new Date(now.getTime() + RUN_LEASE_MS),
      heartbeatAt: now,
    })
    .returning();
  return toRun(row);
}

export async function appendEvent(
  runId: string,
  seq: number,
  type: string,
  payload: unknown,
): Promise<void> {
  await db
    .insert(runEvents)
    .values({ runId, seq, type, payload: payload as never })
    .onConflictDoNothing();
  await db
    .update(runs)
    .set({ lastSeq: seq, updatedAt: new Date() })
    .where(eq(runs.id, runId));
}

export async function heartbeat(runId: string): Promise<void> {
  const now = new Date();
  await db
    .update(runs)
    .set({
      heartbeatAt: now,
      leaseUntil: new Date(now.getTime() + RUN_LEASE_MS),
      updatedAt: now,
    })
    .where(eq(runs.id, runId));
}

export async function setAgentSession(runId: string, sessionId: string): Promise<void> {
  await db
    .update(runs)
    .set({ agentSessionId: sessionId, updatedAt: new Date() })
    .where(eq(runs.id, runId));
}

export async function finishRun(
  runId: string,
  transition: { kind: "finished" | "error" | "cancelled"; interrupted?: boolean },
  options: { usage?: HermesTokens | null; error?: string | null } = {},
): Promise<RunStatus> {
  const [current] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!current) return "error";

  const at = new Date();
  const status =
    transition.kind === "finished"
      ? nextRunState(current.status as RunStatus, {
          kind: "finished",
          at,
          interrupted: Boolean(transition.interrupted),
        })
      : nextRunState(current.status as RunStatus, { kind: transition.kind, at });

  await db
    .update(runs)
    .set({
      status,
      leaseUntil: null,
      error: options.error ?? null,
      usage: (options.usage ?? null) as never,
      updatedAt: at,
    })
    .where(eq(runs.id, runId));

  return status;
}

export async function getRun(
  runId: string,
  userId: string,
): Promise<{ run: Run; events: RunEventRecord[] } | null> {
  const [row] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
    .limit(1);
  if (!row) return null;

  const events = await db
    .select()
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(asc(runEvents.seq));

  return {
    run: toRun(row),
    events: events.map((event) => ({
      runId: event.runId,
      seq: event.seq,
      type: event.type,
      payload: event.payload,
      createdAt: event.createdAt,
    })),
  };
}

/**
 * Marca como `interrupted` los runs cuyo lease venció. Se llama al arrancar el
 * proceso: si el servidor se cayó a mitad de un turno, ese turno no terminó.
 */
export async function reclaimExpiredRuns(now: Date = new Date()): Promise<number> {
  const stale = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.status, "running"),
        or(isNull(runs.leaseUntil), lt(runs.leaseUntil, now)),
      ),
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
