import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isBackendAvailable } from "@/lib/agents/registry";
import { sandboxAvailable } from "@/lib/sandbox/client";

export const runtime = "nodejs";

/** Qué capacidades opcionales hay en esta instalación. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  return NextResponse.json({
    agents: isBackendAvailable(),
    computer: sandboxAvailable(),
    /** Esta persona puede elegir Claude Code (admin o con permiso concedido). */
    claudeCode: user.role === "admin" || user.canUseClaudeCode,
  });
}
