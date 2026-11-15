import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { ownedProject } from "@/lib/threads/queries";

export const runtime = "nodejs";

const nameSchema = z.object({ name: z.string().trim().min(1).max(80) });

type RouteContext = { params: Promise<{ id: string }> };

async function resolve(context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "No autenticado" }, { status: 401 }) } as const;
  const { id } = await context.params;
  const notFound = NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  if (!z.string().uuid().safeParse(id).success) return { error: notFound } as const;
  if (!(await ownedProject(user.id, id))) return { error: notFound } as const;
  return { id } as const;
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const r = await resolve(context);
  if ("error" in r) return r.error;
  const parsed = nameSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Nombre no válido" }, { status: 400 });
  await db.update(projects).set({ name: parsed.data.name, updatedAt: new Date() }).where(eq(projects.id, r.id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const r = await resolve(context);
  if ("error" in r) return r.error;
  await db.delete(projects).where(eq(projects.id, r.id));
  return NextResponse.json({ ok: true });
}
