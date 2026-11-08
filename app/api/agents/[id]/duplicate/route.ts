import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { duplicateAgent } from "@/lib/agents/store";

export const runtime = "nodejs";

/** Copia un agente propio o público a la cuenta de quien lo pide. */
export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Agente no válido" }, { status: 400 });
  }
  const copy = await duplicateAgent(user.id, id);
  if (!copy) return NextResponse.json({ error: "Agente no encontrado" }, { status: 404 });
  return NextResponse.json({ agent: copy.agent }, { status: 201 });
}
