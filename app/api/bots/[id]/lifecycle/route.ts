import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { invalidBody, outcomeError, requireBot } from "@/lib/bots/http";
import { haltBot, rebuildBot, startBot } from "@/lib/bots/service";
import { permissionDenied } from "@/lib/auth";

export const runtime = "nodejs";

const bodySchema = z.object({ action: z.enum(["start", "stop", "recreate"]) });

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await requireBot((await context.params).id);
  if (!guard.ok) return guard.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const denied = parsed.data.action !== "stop" ? permissionDenied(guard.value.user, "computer") : null;
  if (denied) return denied;
  const { bot } = guard.value;
  const action = { start: startBot, stop: haltBot, recreate: rebuildBot }[parsed.data.action];
  const result = await action(bot);
  if (!result.ok) return outcomeError(result);
  return NextResponse.json({ bot: result.value });
}
