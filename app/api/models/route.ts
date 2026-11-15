import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { activeModelGroups } from "@/lib/models/available";

export const runtime = "nodejs";

/** Modelos activos de todos los proveedores listos, agrupados, para el selector del chat. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  return NextResponse.json(await activeModelGroups(user));
}
