import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { invalidBody } from "@/lib/bots/http";
import { outcomeError, requireRoom } from "@/lib/rooms/http";
import { addMember, removeMember } from "@/lib/rooms/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const addSchema = z.object({ botId: z.string().uuid(), confirmMixedNetwork: z.boolean().default(false) });

export async function POST(req: NextRequest, context: RouteContext) {
  const guard = await requireRoom((await context.params).id);
  if (!guard.ok) return guard.response;
  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const result = await addMember(guard.value.room, parsed.data.botId, parsed.data.confirmMixedNetwork);
  if (!result.ok) return outcomeError(result);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  const guard = await requireRoom((await context.params).id);
  if (!guard.ok) return guard.response;
  const botId = req.nextUrl.searchParams.get("botId") ?? "";
  if (!z.string().uuid().safeParse(botId).success) return NextResponse.json({ error: "Bot no válido" }, { status: 400 });
  await removeMember(guard.value.room, botId);
  return NextResponse.json({ ok: true });
}
