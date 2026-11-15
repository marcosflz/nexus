import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSubscriptionUser } from "@/lib/instance/claude-code-guard";
import { finishChatGptLogin } from "@/lib/instance/chatgpt";
import { CHATGPT_PROVIDER } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  loginId: z.string().min(1).max(200),
  redirectUrl: z.string().trim().min(10).max(8000),
});

/** Termina el inicio de sesión con la dirección pegada. Las credenciales no llegan al navegador. */
export async function POST(req: NextRequest) {
  const auth = await requireSubscriptionUser(CHATGPT_PROVIDER);
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Pega la dirección completa de la página (http://127.0.0.1:1455/…)" }, { status: 400 });
  }
  const result = await finishChatGptLogin(auth.user.id, parsed.data.loginId, parsed.data.redirectUrl);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
