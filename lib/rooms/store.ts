import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { botRoomMembers, botRooms, bots, messages, roomActivity, roomTopics, threads } from "@/lib/db/schema";

export type Room = typeof botRooms.$inferSelect;
export type Topic = typeof roomTopics.$inferSelect;
export type BotRow = typeof bots.$inferSelect;

export interface Actor {
  userId?: string | null;
  botId?: string | null;
  runId?: string | null;
}

/** Avisos que la sala muestra con un botón: no son mensajes de nadie. */
export type RoomNotice =
  | { kind: "limit"; limit: "hops" | "runs" | "tokens"; roundId: string }
  | { kind: "bot_stopped"; botId: string }
  | { kind: "no_profile"; botId: string }
  | { kind: "error"; botId: string }
  | { kind: "info" };

export async function insertNotice(threadId: string, content: string, notice: RoomNotice): Promise<void> {
  await db.insert(messages).values({ threadId, role: "system", content: content.slice(0, 2000), notice });
  await db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, threadId));
}

export async function logActivity(
  roomId: string,
  topicId: string | null,
  actor: Actor,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(roomActivity).values({
    roomId,
    topicId,
    actorUserId: actor.userId ?? null,
    actorBotId: actor.botId ?? null,
    runId: actor.runId ?? null,
    action,
    detail,
  });
}

export async function roomMembers(roomId: string): Promise<BotRow[]> {
  const rows = await db
    .select({ bot: bots })
    .from(botRoomMembers)
    .innerJoin(bots, eq(bots.id, botRoomMembers.botId))
    .where(eq(botRoomMembers.roomId, roomId))
    .orderBy(asc(botRoomMembers.createdAt));
  return rows.map((row) => row.bot);
}

export async function getTopic(roomId: string, topicId: string): Promise<Topic | null> {
  const [topic] = await db
    .select()
    .from(roomTopics)
    .where(and(eq(roomTopics.id, topicId), eq(roomTopics.roomId, roomId)))
    .limit(1);
  return topic ?? null;
}

export async function touchTopic(topicId: string, patch: Partial<typeof roomTopics.$inferInsert> = {}): Promise<void> {
  await db.update(roomTopics).set({ ...patch, updatedAt: new Date() }).where(eq(roomTopics.id, topicId));
}
