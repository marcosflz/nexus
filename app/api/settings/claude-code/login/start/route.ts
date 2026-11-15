import { NextResponse } from "next/server";
import { requireClaudeCodeUser } from "@/lib/instance/claude-code-guard";
import { startClaudeCodeLogin } from "@/lib/instance/claude-code";

export const runtime = "nodejs";
export const maxDuration = 70;

/** Empieza a vincular la cuenta de Anthropic del usuario: devuelve la URL de autorización. */
export async function POST() {
  const auth = await requireClaudeCodeUser();
  if ("response" in auth) return auth.response;
  const { status, data } = await startClaudeCodeLogin(auth.user.id);
  if (status !== 200 || !("url" in data)) {
    return NextResponse.json({ error: ("error" in data && data.error) || "No se pudo iniciar la vinculación" }, {
      status: status === 200 ? 502 : status,
    });
  }
  // Solo se acepta una URL de autorización de Anthropic: el navegador la abrirá tal cual.
  const url = new URL(data.url);
  if (url.protocol !== "https:" || !["claude.com", "claude.ai"].includes(url.hostname)) {
    return NextResponse.json({ error: "El CLI devolvió una URL inesperada" }, { status: 502 });
  }
  return NextResponse.json({ loginId: data.loginId, url: url.toString() });
}
