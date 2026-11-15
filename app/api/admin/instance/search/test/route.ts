import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { searchTestSchema, testSearchProvider } from "@/lib/instance/search";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const parsed = searchTestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
  return NextResponse.json(await testSearchProvider(parsed.data));
}
