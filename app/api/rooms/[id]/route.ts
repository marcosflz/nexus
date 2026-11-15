import { NextRequest, NextResponse } from "next/server";
import { invalidBody } from "@/lib/bots/http";
import { requireRoom } from "@/lib/rooms/http";
import { deleteRoom, roomOverview, updateRoom } from "@/lib/rooms/service";
import { roomPatchSchema } from "@/lib/rooms/spec";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
  const guard = await requireRoom((await context.params).id);
  if (!guard.ok) return guard.response;
  return NextResponse.json(await roomOverview(guard.value.room));
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const guard = await requireRoom((await context.params).id);
  if (!guard.ok) return guard.response;
  const parsed = roomPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  return NextResponse.json({ room: await updateRoom(guard.value.room, parsed.data) });
}

/** Borra la sala con sus hilos. Los bots y sus datos no se tocan. */
export async function DELETE(_req: NextRequest, context: RouteContext) {
  const guard = await requireRoom((await context.params).id);
  if (!guard.ok) return guard.response;
  await deleteRoom(guard.value.room);
  return NextResponse.json({ ok: true });
}
