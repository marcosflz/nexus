import { NextRequest, NextResponse } from "next/server";
import { invalidBody, outcomeError, requireBot } from "@/lib/bots/http";
import { createBotTask, listBotTasks } from "@/lib/bots/service";
import { botTaskSchema } from "@/lib/bots/spec";
import { permissionDenied } from "@/lib/auth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
  const guard = await requireBot((await context.params).id);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ tasks: await listBotTasks(guard.value.bot.id) });
}

export async function POST(req: NextRequest, context: RouteContext) {
  const guard = await requireBot((await context.params).id);
  if (!guard.ok) return guard.response;
  const parsed = botTaskSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const denied = parsed.data.kind !== "agent" ? permissionDenied(guard.value.user, "computer") : null;
  if (denied) return denied;
  const result = await createBotTask(guard.value.bot, guard.value.user.id, parsed.data);
  if (!result.ok) return outcomeError(result);
  return NextResponse.json({ task: result.value }, { status: 202 });
}
