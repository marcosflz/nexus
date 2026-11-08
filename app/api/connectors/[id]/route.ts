import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { deleteConnector } from "@/lib/connectors/store";

export const runtime = "nodejs";

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success || !(await deleteConnector(user.id, id))) {
    return NextResponse.json({ error: "Conector no encontrado" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
