import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/auth";
import { claudeCodeUpdateSchema, getClaudeCodeSettings, saveClaudeCodeSettings } from "@/lib/instance/claude-code";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireSuperadmin();
  if ("response" in auth) return auth.response;
  return NextResponse.json(await getClaudeCodeSettings());
}

export async function PUT(req: NextRequest) {
  const auth = await requireSuperadmin();
  if ("response" in auth) return auth.response;

  const parsed = claudeCodeUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });

  await saveClaudeCodeSettings(parsed.data, auth.user.id);
  return NextResponse.json(await getClaudeCodeSettings());
}
