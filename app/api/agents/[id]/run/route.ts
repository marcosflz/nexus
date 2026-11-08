import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { enqueueJob } from "@/lib/worker/jobs";

export const runtime = "nodejs";

/** «Ejecutar ahora»: lanza el agente como una rutina, con la tarea que se indique. */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await context.params;
  const parsed = z.object({ prompt: z.string().trim().min(1).max(4000) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Indica qué tiene que hacer el agente" }, { status: 400 });
  }
  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.ownerId, user.id)))
    .limit(1);
  if (!agent) return NextResponse.json({ error: "Agente no encontrado" }, { status: 404 });

  await enqueueJob({ kind: "agent_run", payload: { agentId: id, prompt: parsed.data.prompt, source: "manual" } });
  return NextResponse.json({ queued: true }, { status: 202 });
}
