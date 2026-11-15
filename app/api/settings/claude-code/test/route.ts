import { NextResponse } from "next/server";
import { requireClaudeCodeUser } from "@/lib/instance/claude-code-guard";
import { testClaudeCode } from "@/lib/instance/claude-code";

export const runtime = "nodejs";
export const maxDuration = 150;

/** Una llamada real y mínima con la cuenta vinculada del usuario. */
export async function POST() {
  const auth = await requireClaudeCodeUser();
  if ("response" in auth) return auth.response;
  return NextResponse.json(await testClaudeCode(auth.user.id));
}
