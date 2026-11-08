import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { defaultBackendId, describeBackends } from "@/lib/agents/registry";
import { sandboxAvailable } from "@/lib/sandbox/client";

export const runtime = "nodejs";

/** Qué motores hay disponibles en esta instalación. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  return NextResponse.json({
    backends: describeBackends(),
    defaultBackend: defaultBackendId(),
    computer: sandboxAvailable(),
  });
}
