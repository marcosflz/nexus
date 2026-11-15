import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { cancelChatGptLogin } from "@/lib/instance/chatgpt";

export const runtime = "nodejs";

const schema = z.object({ loginId: z.string().min(1).max(200) });

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
  await cancelChatGptLogin(user.id, parsed.data.loginId);
  return NextResponse.json({ ok: true });
}
