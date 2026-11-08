import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { listVersions } from "@/lib/agents/store";

export const runtime = "nodejs";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Agente no válido" }, { status: 400 });
  }
  const versions = await listVersions(user.id, id);
  if (!versions) return NextResponse.json({ error: "Agente no encontrado" }, { status: 404 });
  return NextResponse.json({ versions });
}
