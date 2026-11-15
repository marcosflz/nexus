import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { invalidBody } from "@/lib/bots/http";
import { requireTopic } from "@/lib/rooms/http";
import { roundAction } from "@/lib/rooms/service";

export const runtime = "nodejs";

const bodySchema = z.object({ action: z.enum(["stop", "continue"]) });

/** Parar la conversación de los bots en un hilo, o dejar que siga tras un límite. */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string; topicId: string }> }) {
  const { id, topicId } = await context.params;
  const guard = await requireTopic(id, topicId);
  if (!guard.ok) return guard.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const { room, topic, user } = guard.value;
  return NextResponse.json({ turns: await roundAction(room, topic, user.id, parsed.data.action) });
}
