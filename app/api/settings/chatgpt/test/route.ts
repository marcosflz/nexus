import { NextResponse } from "next/server";
import { requireSubscriptionUser } from "@/lib/instance/claude-code-guard";
import { testChatGpt } from "@/lib/instance/chatgpt";
import { CHATGPT_PROVIDER } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 100;

/** Una llamada real y mínima con el plan del usuario. */
export async function POST() {
  const auth = await requireSubscriptionUser(CHATGPT_PROVIDER);
  if ("response" in auth) return auth.response;
  return NextResponse.json(await testChatGpt(auth.user.id));
}
