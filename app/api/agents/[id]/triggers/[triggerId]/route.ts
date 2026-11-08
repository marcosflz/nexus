import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { deleteTrigger, setTriggerEnabled } from "@/lib/triggers/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; triggerId: string }> };

const uuid = z.string().uuid();

export async function PATCH(req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { triggerId } = await context.params;
  const parsed = z.object({ enabled: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success || !uuid.safeParse(triggerId).success) {
    return NextResponse.json({ error: "Petición no válida" }, { status: 400 });
  }
  if (!(await setTriggerEnabled(user.id, triggerId, parsed.data.enabled))) {
    return NextResponse.json({ error: "Disparador no encontrado" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { triggerId } = await context.params;
  if (!uuid.safeParse(triggerId).success || !(await deleteTrigger(user.id, triggerId))) {
    return NextResponse.json({ error: "Disparador no encontrado" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
