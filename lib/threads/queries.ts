import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, threads } from "@/lib/db/schema";

export interface ThreadRow {
  id: string;
  title: string;
  updatedAt: string;
  pinnedAt: string | null;
  projectId: string | null;
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
};

export function serializeThread(row: {
  id: string;
  title: string;
  updatedAt: Date;
  pinnedAt: Date | null;
  projectId: string | null;
}): ThreadRow {
  return {
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
    pinnedAt: row.pinnedAt ? row.pinnedAt.toISOString() : null,
    projectId: row.projectId,
  };
}

export async function listThreadsFor(userId: string, limit = 200): Promise<ThreadRow[]> {
  const rows = await db
    .select(threadSummaryColumns)
    .from(threads)
    .where(eq(threads.userId, userId))
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
