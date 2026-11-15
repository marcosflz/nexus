import { botApi } from "@/lib/bots/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { cancelRun } from "@/lib/runs/registry";
import { finishRun, getRunMeta } from "@/lib/runs/store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Run no válido" }, { status: 400 });
  }

  const run = await getRunMeta(id, user.id);
  if (!run) return NextResponse.json({ error: "Run no encontrado" }, { status: 404 });

  if (run.status !== "running" && run.status !== "awaiting_input") {
    return NextResponse.json({ ok: true, status: run.status });
  }

  if (run.botId && run.runtimeSnapshot?.scripts) await botApi(run.botId, "POST", "skills/cancel", { runId: id });

  // Si este proceso lo está ejecutando, el ejecutor registra la cancelación y
  // cierra el log. Si no (run en pausa o huérfano), se cierra aquí directamente.
  if (!cancelRun(id)) {
    await finishRun(id, { kind: "cancelled" });
    return NextResponse.json({ ok: true, status: "cancelled" });
  }
  return NextResponse.json({ ok: true, status: "cancelling" });
}
