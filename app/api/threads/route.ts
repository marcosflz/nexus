import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { threads } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

const postSchema = z.object({ title: z.string().max(200).optional() });

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const rows = await db
    .select({
      id: threads.id,
      title: threads.title,
      createdAt: threads.createdAt,
      updatedAt: threads.updatedAt,
    })
    .from(threads)
    .where(eq(threads.userId, user.id))
    .orderBy(desc(threads.updatedAt))
    .limit(200);

  return NextResponse.json({ threads: rows });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  const [thread] = await db
    .insert(threads)
    .values({ userId: user.id, title: parsed.success && parsed.data.title ? parsed.data.title : "Nuevo chat" })
    .returning();

  return NextResponse.json({ thread }, { status: 201 });
}
