import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { botDesktopFrame, botDesktopStream } from "@/lib/bots/client";
import { requireBot } from "@/lib/bots/http";

export const runtime = "nodejs";

const fpsSchema = z.coerce.number().min(0.5).max(5).catch(2);

/**
 * Pantalla del bot, solo para su dueño y solo de lectura. Es MJPEG para que el
 * navegador lo pinte en un `<img>`: por aquí no puede viajar ninguna acción.
 * `?frame=1` devuelve un único fotograma.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await requireBot((await context.params).id);
  if (!guard.ok) return guard.response;
  const { bot } = guard.value;

  if (req.nextUrl.searchParams.get("frame") === "1") {
    const frame = await botDesktopFrame(bot.id);
    if (!frame?.body) return NextResponse.json({ error: "El escritorio no está disponible" }, { status: 409 });
    return new Response(frame.body, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
  }

  const fps = fpsSchema.parse(req.nextUrl.searchParams.get("fps") ?? 2);
  const upstream = await botDesktopStream(bot.id, fps, req.signal);
  if (!(upstream instanceof Response) || !upstream.body) {
    const failure = upstream instanceof Response ? { failure: "Sin datos", status: 502 } : upstream;
    return NextResponse.json({ error: failure.failure }, { status: failure.status });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "multipart/x-mixed-replace",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
