import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getSearchSettings, saveSearchSettings, searchUpdateSchema } from "@/lib/instance/search";
import { recordAdminAction } from "@/lib/users";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  return NextResponse.json(await getSearchSettings());
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const parsed = searchUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });

  const problem = await saveSearchSettings(parsed.data, auth.user.id);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  await recordAdminAction(auth.user, null, "search.update", {
    order: parsed.data.providers.filter((provider) => provider.enabled).map((provider) => provider.id),
    keysChanged: parsed.data.providers.filter((provider) => provider.apiKey || provider.clearKey).map((provider) => provider.id),
    minResults: parsed.data.minResults,
  });
  return NextResponse.json(await getSearchSettings());
}
