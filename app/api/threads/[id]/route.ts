import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { messages, threads } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

const patchSchema = z.object({ title: z.string().min(1).max(200) });

type RouteContext = { params: Promise<{ id: string }> };

async function ownedThread(userId: string, threadId: string) {
  const [thread] = await db
    .select()
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userId, userId)))
    .limit(1);
  return thread ?? null;
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await context.params;
  const thread = await ownedThread(user.id, id);
  if (!thread) return NextResponse.json({ error: "Hilo no encontrado" }, { status: 404 });

  const rows = await db
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      sources: messages.sources,
      tools: messages.tools,
      attachments: messages.attachments,
      usage: messages.usage,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.threadId, id))
    .orderBy(asc(messages.createdAt));

  const mapped = rows.map((row) => ({
    ...row,
    attachments:
      row.attachments?.map(({ name, mime, size }) => ({ name, mime, size })) ?? null,
  }));

  return NextResponse.json({ thread, messages: mapped });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Título no válido" }, { status: 400 });

  const thread = await ownedThread(user.id, id);
  if (!thread) return NextResponse.json({ error: "Hilo no encontrado" }, { status: 404 });

  await db
    .update(threads)
    .set({ title: parsed.data.title, updatedAt: new Date() })
    .where(eq(threads.id, id));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await context.params;
  const thread = await ownedThread(user.id, id);
  if (!thread) return NextResponse.json({ error: "Hilo no encontrado" }, { status: 404 });

  await db.delete(threads).where(eq(threads.id, id));
  return NextResponse.json({ ok: true });
}
