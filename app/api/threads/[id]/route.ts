import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { messageFeedback, messages, threads } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { ownedProject } from "@/lib/threads/queries";
import { getActiveRunForThread, reclaimExpiredRuns } from "@/lib/runs/store";

export const runtime = "nodejs";

const patchSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    pinned: z.boolean().optional(),
    projectId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.title !== undefined || v.pinned !== undefined || v.projectId !== undefined);

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
      parts: messages.parts,
      followups: messages.followups,
      runId: messages.runId,
      rating: messageFeedback.rating,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .leftJoin(
      messageFeedback,
      and(eq(messageFeedback.messageId, messages.id), eq(messageFeedback.userId, user.id)),
    )
    // Los mensajes reemplazados al editar/regenerar siguen guardados pero ya no se muestran.
    .where(and(eq(messages.threadId, id), isNull(messages.supersededAt)))
    .orderBy(asc(messages.createdAt));

  const mapped = rows.map((row) => ({
    ...row,
    attachments:
      row.attachments?.map(({ name, mime, size }) => ({ name, mime, size })) ?? null,
  }));

  // Un run con el lease vencido está huérfano: se cierra antes de anunciarlo como activo.
  await reclaimExpiredRuns().catch(() => {});
  const active = await getActiveRunForThread(id);

  return NextResponse.json({
    thread,
    messages: mapped,
    // Run en curso o en pausa: la UI se engancha con GET /api/runs/:id/events.
    activeRun: active
      ? { id: active.id, status: active.status, lastSeq: active.lastSeq }
      : null,
  });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });

  const thread = await ownedThread(user.id, id);
  if (!thread) return NextResponse.json({ error: "Hilo no encontrado" }, { status: 404 });

  const { title, pinned, projectId } = parsed.data;
  if (projectId) {
    const project = await ownedProject(user.id, projectId);
    if (!project) return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }

  // Fijar o mover no cambia `updatedAt`: el chat no debe saltar al principio de «Recientes».
  const changes: Partial<typeof threads.$inferInsert> = {};
  if (title !== undefined) {
    changes.title = title;
    changes.updatedAt = new Date();
  }
  if (pinned !== undefined) changes.pinnedAt = pinned ? new Date() : null;
  if (projectId !== undefined) changes.projectId = projectId;

  await db.update(threads).set(changes).where(eq(threads.id, id));
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
