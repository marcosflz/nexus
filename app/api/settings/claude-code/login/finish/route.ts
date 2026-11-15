import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireClaudeCodeUser } from "@/lib/instance/claude-code-guard";
import { finishClaudeCodeLogin } from "@/lib/instance/claude-code";

export const runtime = "nodejs";
export const maxDuration = 130;

const schema = z.object({
  loginId: z.string().min(1).max(200),
  code: z.string().trim().min(1).max(512).regex(/^\S+$/),
});

/** Termina la vinculación con el código que muestra Anthropic. El token se guarda cifrado y no se devuelve. */
export async function POST(req: NextRequest) {
  const auth = await requireClaudeCodeUser();
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pega el código completo que muestra Anthropic" }, { status: 400 });
  const result = await finishClaudeCodeLogin(auth.user.id, parsed.data.loginId, parsed.data.code);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
