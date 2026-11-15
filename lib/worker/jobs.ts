import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs, type JobKind } from "@/lib/db/schema";
import { backoffMs } from "./backoff";

export type JobRow = typeof jobs.$inferSelect;

export interface EnqueueOptions {
  kind: JobKind;
  payload: Record<string, unknown>;
  runAt?: Date;
  /** Si ya existe un trabajo con esta clave, no se crea otro (idempotencia del planificador). */
  dedupeKey?: string;
  maxAttempts?: number;
}

/** Encola un trabajo. Devuelve su id, o null si `dedupeKey` ya existía. */
export async function enqueueJob(options: EnqueueOptions): Promise<string | null> {
  const [row] = await db
    .insert(jobs)
    .values({
      kind: options.kind,
      payload: options.payload,
      runAt: options.runAt ?? new Date(),
      dedupeKey: options.dedupeKey,
      maxAttempts: options.maxAttempts ?? 3,
    })
    .onConflictDoNothing({ target: jobs.dedupeKey })
    .returning({ id: jobs.id });
  return row?.id ?? null;
}

/**
 * Reclama hasta `limit` trabajos vencidos. `FOR UPDATE SKIP LOCKED` hace que dos
 * workers (o dos ticks solapados) nunca reciban el mismo trabajo.
 */
export async function claimJobs(workerId: string, limit: number, lockMs = 5 * 60_000): Promise<JobRow[]> {
  if (limit <= 0) return [];
  const rows = await db.execute<Record<string, unknown>>(sql`
    UPDATE jobs
    SET status = 'running', locked_by = ${workerId},
        locked_until = now() + (${lockMs} * interval '1 millisecond'),
        attempts = attempts + 1, updated_at = now()
    WHERE id IN (
      SELECT id FROM jobs
      WHERE status = 'queued' AND run_at <= now()
      ORDER BY run_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING id, kind, payload, run_at AS "runAt", status, attempts, max_attempts AS "maxAttempts",
              locked_by AS "lockedBy", locked_until AS "lockedUntil", dedupe_key AS "dedupeKey",
              last_error AS "lastError", created_at AS "createdAt", updated_at AS "updatedAt"`);
  return rows as unknown as JobRow[];
}

export async function completeJob(id: string): Promise<void> {
  await db.update(jobs).set({ status: "done", lockedBy: null, lockedUntil: null, updatedAt: new Date() }).where(eq(jobs.id, id));
}

/** Reintenta con backoff exponencial; al agotar los intentos el trabajo queda `dead`. */
export async function failJob(job: Pick<JobRow, "id" | "attempts" | "maxAttempts">, error: string): Promise<void> {
  const dead = job.attempts >= job.maxAttempts;
  await db
    .update(jobs)
    .set({
      status: dead ? "dead" : "queued",
      runAt: dead ? undefined : new Date(Date.now() + backoffMs(job.attempts)),
      lastError: error.slice(0, 1000),
      lockedBy: null,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, job.id));
}

/** Devuelve un trabajo a la cola sin gastar un intento (p. ej. no hay hueco para otro run). */
export async function deferJob(job: Pick<JobRow, "id">, ms: number): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: "queued",
      runAt: new Date(Date.now() + ms),
      attempts: sql`greatest(${jobs.attempts} - 1, 0)`,
      lockedBy: null,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, job.id));
}

/** Trabajos cuyo worker murió a mitad: vuelven a la cola, o a `dead` si ya no quedan intentos. */
export async function reclaimStaleJobs(): Promise<number> {
  const rows = await db
    .update(jobs)
    .set({
      status: sql`CASE WHEN ${jobs.attempts} >= ${jobs.maxAttempts} THEN 'dead' ELSE 'queued' END`,
      lastError: "El worker se detuvo mientras lo ejecutaba",
      lockedBy: null,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.status, "running"), lt(jobs.lockedUntil, new Date())))
    .returning({ id: jobs.id });
  return rows.length;
}
