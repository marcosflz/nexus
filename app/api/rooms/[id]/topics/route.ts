import { NextRequest, NextResponse } from "next/server";
import { invalidBody } from "@/lib/bots/http";
import { outcomeError, requireRoom } from "@/lib/rooms/http";
import { createTopic } from "@/lib/rooms/service";
import { topicInputSchema } from "@/lib/rooms/spec";

export const runtime = "nodejs";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await requireRoom((await context.params).id);
  if (!guard.ok) return guard.response;
  const parsed = topicInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const result = await createTopic(guard.value.room, { userId: guard.value.user.id }, parsed.data);
  if (!result.ok) return outcomeError(result);
  return NextResponse.json({ topic: result.value }, { status: 201 });
}
