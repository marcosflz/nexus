import { NextRequest, NextResponse } from "next/server";
import { invalidBody, outcomeError, requireBot } from "@/lib/bots/http";
import { configPendingOf, deleteBot, syncBot, updateBot } from "@/lib/bots/service";
import { botPatchSchema } from "@/lib/bots/spec";
import { permissionDenied } from "@/lib/auth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
  const guard = await requireBot((await context.params).id);
  if (!guard.ok) return guard.response;
  const synced = await syncBot(guard.value.bot);
  return NextResponse.json({
    ...synced,
    configPending: configPendingOf(synced.bot, synced.runtime),
    spec: (await import("@/lib/bots/profile")).runtimeOfBot(synced.bot),
  });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const guard = await requireBot((await context.params).id);
  if (!guard.ok) return guard.response;
  const parsed = botPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const denied = parsed.data.environmentEnabled ? permissionDenied(guard.value.user, "computer") : null;
  if (denied) return denied;
  const result = await updateBot(guard.value.bot, parsed.data);
  if (!result.ok) return outcomeError(result);
  return NextResponse.json({ bot: result.value });
}

/** `?purge=1` borra también el volumen; sin él, los datos se conservan. */
export async function DELETE(req: NextRequest, context: RouteContext) {
  const guard = await requireBot((await context.params).id);
  if (!guard.ok) return guard.response;
  const result = await deleteBot(guard.value.bot, req.nextUrl.searchParams.get("purge") === "1");
  if (!result.ok) return outcomeError(result);
  return NextResponse.json({ ok: true });
}
