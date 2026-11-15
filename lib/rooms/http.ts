import { NextResponse } from "next/server";
import { z } from "zod";
import type { SessionUser } from "@/lib/auth";
import { requireBotUser } from "@/lib/bots/http";
import { getOwnedRoom } from "./service";
import { getTopic, type Room, type Topic } from "./store";

type Guard<T> = { ok: true; value: T } | { ok: false; response: Response };

const notFound = (what: string) => ({ ok: false as const, response: NextResponse.json({ error: `${what} no encontrada` }, { status: 404 }) });
const isUuid = (value: string) => z.string().uuid().safeParse(value).success;

/** Una sala ajena responde igual que una inexistente. */
export async function requireRoom(id: string): Promise<Guard<{ user: SessionUser; room: Room }>> {
  const user = await requireBotUser();
  if (!user.ok) return user;
  if (!isUuid(id)) return notFound("Sala");
  const room = await getOwnedRoom(user.value.id, id);
  return room ? { ok: true, value: { user: user.value, room } } : notFound("Sala");
}

export async function requireTopic(roomId: string, topicId: string): Promise<Guard<{ user: SessionUser; room: Room; topic: Topic }>> {
  const guard = await requireRoom(roomId);
  if (!guard.ok) return guard;
  if (!isUuid(topicId)) return notFound("Tarea");
  const topic = await getTopic(guard.value.room.id, topicId);
  return topic ? { ok: true, value: { ...guard.value, topic } } : notFound("Tarea");
}

export const outcomeError = (result: { status: number; error: string; code?: string }) =>
  NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
