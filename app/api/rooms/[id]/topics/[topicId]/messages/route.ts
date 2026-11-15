import { NextRequest, NextResponse } from "next/server";
import { invalidBody } from "@/lib/bots/http";
import { requireTopic } from "@/lib/rooms/http";
import { postMessage } from "@/lib/rooms/service";
import { roomMessageSchema } from "@/lib/rooms/spec";

export const runtime = "nodejs";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string; topicId: string }> }) {
  const { id, topicId } = await context.params;
  const guard = await requireTopic(id, topicId);
  if (!guard.ok) return guard.response;
  const parsed = roomMessageSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const { room, topic, user } = guard.value;
  return NextResponse.json(await postMessage(room, topic, user.id, parsed.data.text), { status: 201 });
}
