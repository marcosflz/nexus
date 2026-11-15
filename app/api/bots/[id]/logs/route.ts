import { NextRequest, NextResponse } from "next/server";
import { outcomeError, requireBot } from "@/lib/bots/http";
import { botApi, botContainerLogs } from "@/lib/bots/client";

export const runtime = "nodejs";

/** El log del runtime; con el bot parado, el del contenedor (sirve para ver por qué murió). */
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await requireBot((await context.params).id);
  if (!guard.ok) return guard.response;
  const { bot } = guard.value;
  const runtime = await botApi<{ lines: unknown[] }>(bot.id, "GET", "logs?limit=500");
  if (runtime.ok) return NextResponse.json({ source: "runtime", lines: runtime.data.lines });
  const container = await botContainerLogs(bot.id, 500);
  if (!container.ok) return outcomeError(container);
  return NextResponse.json({ source: "container", lines: container.data.logs.split("\n") });
}
