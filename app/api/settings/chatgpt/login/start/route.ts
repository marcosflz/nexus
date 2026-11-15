import { NextResponse } from "next/server";
import { requireSubscriptionUser } from "@/lib/instance/claude-code-guard";
import { startChatGptLogin } from "@/lib/instance/chatgpt";
import { CHATGPT_PROVIDER } from "@/lib/providers";

export const runtime = "nodejs";

/** Empieza «Sign in with ChatGPT» para la cuenta del propio usuario. */
export async function POST() {
  const auth = await requireSubscriptionUser(CHATGPT_PROVIDER);
  if ("response" in auth) return auth.response;
  const result = await startChatGptLogin(auth.user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ loginId: result.loginId, url: result.url });
}
