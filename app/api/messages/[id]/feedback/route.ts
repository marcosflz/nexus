import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { messageFeedback, messages, threads } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

const bodySchema = z.object({
  rating: z.union([z.literal(1), z.literal(-1), z.null()]),
  comment: z.string().max(1000).optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

/** Valora (+1/−1) una respuesta, o retira la valoración con `null`. */
export async function POST(req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Petición no válida" }, { status: 400 });
  }

  // Solo se puede valorar un mensaje de asistente de un hilo propio.
  const [owned] = await db
    .select({ id: messages.id })
    .from(messages)
    .innerJoin(threads, eq(threads.id, messages.threadId))
    .where(and(eq(messages.id, id), eq(threads.userId, user.id), eq(messages.role, "assistant")))
    .limit(1);
  if (!owned) return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });

  if (parsed.data.rating === null) {
    await db
      .delete(messageFeedback)
      .where(and(eq(messageFeedback.messageId, id), eq(messageFeedback.userId, user.id)));
    return NextResponse.json({ ok: true, rating: null });
  }

  await db
    .insert(messageFeedback)
    .values({
      messageId: id,
      userId: user.id,
      rating: parsed.data.rating,
      comment: parsed.data.comment ?? null,
    })
    .onConflictDoUpdate({
      target: [messageFeedback.messageId, messageFeedback.userId],
      set: { rating: parsed.data.rating, comment: parsed.data.comment ?? null },
    });
  return NextResponse.json({ ok: true, rating: parsed.data.rating });
}
