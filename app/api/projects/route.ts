import { NextRequest, NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { listProjectsFor, MAX_PROJECTS } from "@/lib/threads/queries";

export const runtime = "nodejs";

const nameSchema = z.object({ name: z.string().trim().min(1).max(80) });

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  return NextResponse.json({ projects: await listProjectsFor(user.id) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const parsed = nameSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Nombre no válido" }, { status: 400 });

  const [{ total }] = await db.select({ total: count() }).from(projects).where(eq(projects.userId, user.id));
  if (total >= MAX_PROJECTS) {
    return NextResponse.json({ error: "Has alcanzado el máximo de proyectos" }, { status: 400 });
  }
  const [row] = await db.insert(projects).values({ userId: user.id, name: parsed.data.name }).returning();
  return NextResponse.json(
    { project: { id: row.id, name: row.name, updatedAt: row.updatedAt.toISOString() } },
    { status: 201 },
  );
}
