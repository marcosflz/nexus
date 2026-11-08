import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { activeShare, createShare, revokeShares } from "@/lib/share/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const urlFor = (slug: string) => `${process.env.APP_URL?.replace(/\/$/, "") ?? ""}/s/${slug}`;
const idOk = (id: string) => z.string().uuid().safeParse(id).success;

export async function GET(_req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await context.params;
  if (!idOk(id)) return NextResponse.json({ error: "Hilo no válido" }, { status: 400 });
  const share = await activeShare(user.id, id);
  return NextResponse.json({ share: share ? { slug: share.slug, url: urlFor(share.slug) } : null });
}

export async function POST(_req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await context.params;
  if (!idOk(id)) return NextResponse.json({ error: "Hilo no válido" }, { status: 400 });
  const share = await createShare(user.id, id);
  if (!share) return NextResponse.json({ error: "Hilo no encontrado" }, { status: 404 });
  return NextResponse.json({ share: { slug: share.slug, url: urlFor(share.slug) } });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await context.params;
  if (!idOk(id) || !(await revokeShares(user.id, id))) {
    return NextResponse.json({ error: "Hilo no encontrado" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
