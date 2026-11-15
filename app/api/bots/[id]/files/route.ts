import { NextRequest, NextResponse } from "next/server";
import { outcomeError, requireBot } from "@/lib/bots/http";
import { botApi, botFile } from "@/lib/bots/client";

export const runtime = "nodejs";

/** Sin `download`, lista el directorio. Con él, transmite el fichero como adjunto. */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await requireBot((await context.params).id);
  if (!guard.ok) return guard.response;
  const { bot } = guard.value;
  const path = req.nextUrl.searchParams.get("path") ?? "";

  if (req.nextUrl.searchParams.get("download") === "1") {
    const upstream = await botFile(bot.id, path);
    if (!upstream?.body) return NextResponse.json({ error: "Fichero no encontrado" }, { status: 404 });
    // Un artefacto puede ser HTML de una web cualquiera: nunca se sirve para que se renderice.
    const name = path.split("/").pop()?.replace(/[^\w.-]/g, "_") || "fichero";
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const result = await botApi(bot.id, "GET", `files?path=${encodeURIComponent(path)}`);
  if (!result.ok) return outcomeError(result);
  return NextResponse.json(result.data);
}
