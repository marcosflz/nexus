import { NextRequest, NextResponse } from "next/server";
import { invalidBody, outcomeError, requireBotUser } from "@/lib/bots/http";
import { createBot, listBots } from "@/lib/bots/service";
import { botInputSchema } from "@/lib/bots/spec";
import { permissionDenied } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const guard = await requireBotUser();
  if (!guard.ok) return guard.response;
  return NextResponse.json({ bots: await listBots(guard.value.id) });
}

export async function POST(req: NextRequest) {
  const guard = await requireBotUser();
  if (!guard.ok) return guard.response;
  const parsed = botInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const denied = parsed.data.environmentEnabled ? permissionDenied(guard.value, "computer") : null;
  if (denied) return denied;
  const result = await createBot(guard.value.id, parsed.data);
  if (!result.ok) return outcomeError(result);
  return NextResponse.json({ bot: result.value }, { status: 201 });
}
