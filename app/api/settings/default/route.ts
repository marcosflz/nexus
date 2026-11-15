import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { modelAllowed } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { enabledModels, getCredentialRow, setDefaultCredential } from "@/lib/credentials";

export const runtime = "nodejs";

const schema = z.object({ provider: z.string().min(1).max(60), model: z.string().trim().min(1).max(200) });

/** Proveedor y modelo predeterminados: los de los agentes sin modelo fijo y el inicial del chat. */
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
  const { provider, model } = parsed.data;
  const row = await getCredentialRow(user.id, provider);
  if (!row || !enabledModels(row).some((m) => m.id === model) || !modelAllowed(user, provider, model)) {
    return NextResponse.json({ error: "Ese modelo no está activo" }, { status: 400 });
  }
  await setDefaultCredential(user.id, provider, model);
  return NextResponse.json({ ok: true });
}
