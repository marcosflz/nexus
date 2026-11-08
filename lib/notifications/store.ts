import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications, type NotificationKind } from "@/lib/db/schema";

export interface NewNotification {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  agentId?: string | null;
  runId?: string | null;
  threadId?: string | null;
}

export async function createNotification(input: NewNotification): Promise<void> {
  try {
    await db.insert(notifications).values({
      userId: input.userId,
      kind: input.kind,
      title: input.title.slice(0, 200),
      body: (input.body ?? "").slice(0, 1000),
      agentId: input.agentId ?? null,
      runId: input.runId ?? null,
      threadId: input.threadId ?? null,
    });
  } catch (error) {
    // Una notificación perdida no debe tumbar el run que la origina.
    console.error("[nexus] no se pudo crear la notificación:", error);
  }
}

export async function listNotifications(userId: string, limit = 50) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function unreadCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.count ?? 0;
}

/** Marca como leídas las indicadas, o todas las del usuario si no se indica ninguna. */
export async function markRead(userId: string, ids?: string[]): Promise<void> {
  const base = and(eq(notifications.userId, userId), isNull(notifications.readAt));
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(ids && ids.length > 0 ? and(base, sql`${notifications.id} = ANY(${ids}::uuid[])`) : base);
}
