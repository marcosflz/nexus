import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getRunMeta } from "@/lib/runs/store";
import { sseResponse } from "@/lib/runs/sse";

export const runtime = "nodejs";
export const maxDuration = 900;

type RouteContext = { params: Promise<{ id: string }> };

const idSchema = z.string().uuid();

/**
 * Sigue un run: backlog desde `?after=<seq>` (o la cabecera `Last-Event-ID`) y
 * después los eventos en vivo. Es lo que permite recargar a mitad de respuesta.
 */
export async function GET(req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Run no válido" }, { status: 400 });
  }

  const run = await getRunMeta(id, user.id);
  if (!run) return NextResponse.json({ error: "Run no encontrado" }, { status: 404 });

  const raw = req.nextUrl.searchParams.get("after") ?? req.headers.get("last-event-id") ?? "0";
  const after = Number.parseInt(raw, 10);

  return sseResponse(id, user.id, Number.isFinite(after) && after > 0 ? after : 0, req.signal);
}
