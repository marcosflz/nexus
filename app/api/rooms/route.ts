import { NextRequest, NextResponse } from "next/server";
import { invalidBody, requireBotUser } from "@/lib/bots/http";
import { outcomeError } from "@/lib/rooms/http";
import { createRoom, listRooms } from "@/lib/rooms/service";
import { roomInputSchema } from "@/lib/rooms/spec";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireBotUser();
  if (!user.ok) return user.response;
  return NextResponse.json({ rooms: await listRooms(user.value.id) });
}

export async function POST(req: NextRequest) {
  const user = await requireBotUser();
  if (!user.ok) return user.response;
  const parsed = roomInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const result = await createRoom(user.value.id, parsed.data);
  if (!result.ok) return outcomeError(result);
  return NextResponse.json({ room: result.value }, { status: 201 });
}
