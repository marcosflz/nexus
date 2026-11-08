import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, exists, ilike, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { messages, threads } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { likePattern } from "@/lib/sql";
import { ownedProject } from "@/lib/threads/queries";

export const runtime = "nodejs";

const postSchema = z.object({ title: z.string().max(200).optional(), projectId: z.string().uuid().optional() });

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const query = req.nextUrl.searchParams.get("q")?.trim().slice(0, 100) ?? "";
  const pattern = query ? likePattern(query) : null;

  const rows = await db
    .select({
      id: threads.id,
      title: threads.title,
      createdAt: threads.createdAt,
      updatedAt: threads.updatedAt,
      pinnedAt: threads.pinnedAt,
      projectId: threads.projectId,
    })
    .from(threads)
    .where(
      and(
        eq(threads.userId, user.id),
        pattern
          ? or(
              ilike(threads.title, pattern),
              exists(
                db
                  .select({ one: messages.id })
                  .from(messages)
                  .where(
                    and(
                      eq(messages.threadId, threads.id),
                      isNull(messages.supersededAt),
                      ilike(messages.content, pattern),
                    ),
                  ),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(threads.updatedAt))
    .limit(200);

  return NextResponse.json({ threads: rows });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  const projectId = parsed.success ? (parsed.data.projectId ?? null) : null;
  if (projectId && !(await ownedProject(user.id, projectId))) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  const [thread] = await db
    .insert(threads)
    .values({
      userId: user.id,
      title: parsed.success && parsed.data.title ? parsed.data.title : "Nuevo chat",
      projectId,
    })
    .returning();

  return NextResponse.json({ thread }, { status: 201 });
}
