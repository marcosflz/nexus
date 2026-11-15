import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/auth";
import {
  assistantSettings,
  assistantSettingsSchema,
  defaultPrompts,
  saveAssistantSettings,
} from "@/lib/instance/assistant";

export const runtime = "nodejs";

async function view() {
  const [settings, defaults] = await Promise.all([assistantSettings(), defaultPrompts()]);
  return { settings, defaults };
}

export async function GET() {
  const auth = await requireSuperadmin();
  if ("response" in auth) return auth.response;
  return NextResponse.json(await view());
}

export async function PUT(req: NextRequest) {
  const auth = await requireSuperadmin();
  if ("response" in auth) return auth.response;

  const parsed = assistantSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });

  await saveAssistantSettings(parsed.data, auth.user.id);
  return NextResponse.json(await view());
}
