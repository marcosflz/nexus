import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { unlinkChatGpt } from "@/lib/instance/chatgpt";

export const runtime = "nodejs";

/** Desvincula la cuenta de ChatGPT: borra las credenciales guardadas. */
export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  await unlinkChatGpt(user.id);
  return NextResponse.json({ ok: true });
}
