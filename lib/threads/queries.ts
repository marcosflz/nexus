import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, runs, threads } from "@/lib/db/schema";

export interface ThreadRow {
  id: string;
  title: string;
  updatedAt: string;
  pinnedAt: string | null;
  projectId: string | null;
  /** Hay un run en marcha (con lease vigente) en el hilo. */
  running: boolean;
}

export interface ProjectRow {
  id: string;
  name: string;
  updatedAt: string;
}

export const MAX_PROJECTS = 100;

export const threadSummaryColumns = {
  id: threads.id,
  title: threads.title,
  updatedAt: threads.updatedAt,
  pinnedAt: threads.pinnedAt,
  projectId: threads.projectId,
  running: threadRunning(),
};

/**
 * ¿Hay un run en curso en el hilo? Se exige el lease vigente para que un run
 * huérfano (el proceso murió sin cerrarlo) no deje el indicador girando.
 */
export function threadRunning() {
  return sql<boolean>`exists (select 1 from ${runs} where ${runs.threadId} = ${threads.id} and ${runs.status} = 'running' and ${runs.leaseUntil} > now())`.mapWith(
    Boolean,
  );
}

export function serializeThread(row: {
  id: string;
  title: string;
  updatedAt: Date;
  pinnedAt: Date | null;
  projectId: string | null;
  running?: boolean;
}): ThreadRow {
  return {
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
    pinnedAt: row.pinnedAt ? row.pinnedAt.toISOString() : null,
    projectId: row.projectId,
    running: row.running === true,
  };
}

export async function listThreadsFor(userId: string, limit = 200): Promise<ThreadRow[]> {
  const rows = await db
    .select(threadSummaryColumns)
    .from(threads)
    // Los hilos de las salas de NexBots se ven en su sala, no en la barra del chat.
    .where(and(eq(threads.userId, userId), ne(threads.origin, "room"), ne(threads.origin, "skill_creator"), ne(threads.origin, "skill_test")))
    .orderBy(desc(threads.updatedAt))
    .limit(limit);
  return rows.map(serializeThread);
}

export async function listProjectsFor(userId: string): Promise<ProjectRow[]> {
  const rows = await db
    .select({ id: projects.id, name: projects.name, updatedAt: projects.updatedAt })
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.updatedAt))
    .limit(MAX_PROJECTS);
  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
}

export async function ownedProject(userId: string, projectId: string) {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return row ?? null;
}
