import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { requireClaudeCodeUser } from "@/lib/instance/claude-code-guard";
import { claudeCodeTokenSchema, linkClaudeCodeAccount, unlinkClaudeCodeAccount } from "@/lib/instance/claude-code";

export const runtime = "nodejs";
export const maxDuration = 40;

const schema = z.object({ token: claudeCodeTokenSchema });

/** Alternativa al flujo web: pegar un token generado con `claude setup-token` en tu equipo. */
export async function PUT(req: NextRequest) {
  const auth = await requireClaudeCodeUser();
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Token no válido" }, { status: 400 });
  }
  const result = await linkClaudeCodeAccount(auth.user.id, parsed.data.token);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}

/** Desvincula la cuenta: borra el token guardado. Se permite aunque ya no tenga permiso. */
export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  await unlinkClaudeCodeAccount(user.id);
  return NextResponse.json({ ok: true });
}
