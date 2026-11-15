import { NextRequest, NextResponse } from "next/server";
import { invalidBody } from "@/lib/bots/http";
import { outcomeError, requireTopic } from "@/lib/rooms/http";
import { deleteTopic, topicDetail, updateTopic } from "@/lib/rooms/service";
import { topicPatchSchema } from "@/lib/rooms/spec";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; topicId: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
  const { id, topicId } = await context.params;
  const guard = await requireTopic(id, topicId);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ topic: guard.value.topic, ...(await topicDetail(guard.value.topic)) });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id, topicId } = await context.params;
  const guard = await requireTopic(id, topicId);
  if (!guard.ok) return guard.response;
  const parsed = topicPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const result = await updateTopic(guard.value.room, guard.value.topic, parsed.data, { userId: guard.value.user.id });
  if (!result.ok) return outcomeError(result);
  return NextResponse.json({ topic: result.value });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id, topicId } = await context.params;
  const guard = await requireTopic(id, topicId);
  if (!guard.ok) return guard.response;
  await deleteTopic(guard.value.topic);
  return NextResponse.json({ ok: true });
}
