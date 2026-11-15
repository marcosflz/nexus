import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { listNotifications, markRead } from "@/lib/notifications/store";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  return NextResponse.json({ notifications: await listNotifications(user.id) });
}

const readSchema = z.object({ ids: z.array(z.string().uuid()).max(100).optional() });

/** Marca notificaciones como leídas (todas si no se indican ids). */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const parsed = readSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Petición no válida" }, { status: 400 });
  await markRead(user.id, parsed.data.ids);
  return NextResponse.json({ ok: true });
}
