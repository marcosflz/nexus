import { randomBytes } from "node:crypto";
import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, threads, threadShares } from "@/lib/db/schema";
import type { SourceItem } from "@/lib/sources";

export const newSlug = () => randomBytes(9).toString("base64url");

export interface SharedMessage {
  role: "user" | "assistant";
  content: string;
  sources: SourceItem[];
  createdAt: string;
}

export interface SharedThread {
  title: string;
  messages: SharedMessage[];
}

/**
 * Crea (o recupera) el enlace público de un hilo del usuario. Si ya hay uno
 * activo, se reutiliza: compartir dos veces no genera dos URLs vivas.
 */
export async function createShare(userId: string, threadId: string, uptoMessageId?: string | null) {
  const [thread] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userId, userId)))
    .limit(1);
  if (!thread) return null;

  const [existing] = await db
    .select()
    .from(threadShares)
    .where(and(eq(threadShares.threadId, threadId), isNull(threadShares.revokedAt)))
    .limit(1);
  if (existing) return existing;

  const [share] = await db
    .insert(threadShares)
    .values({ slug: newSlug(), threadId, uptoMessageId: uptoMessageId ?? null })
    .returning();
  return share;
}

export async function activeShare(userId: string, threadId: string) {
  const [row] = await db
    .select({ share: threadShares })
    .from(threadShares)
    .innerJoin(threads, eq(threads.id, threadShares.threadId))
    .where(and(eq(threadShares.threadId, threadId), eq(threads.userId, userId), isNull(threadShares.revokedAt)))
    .limit(1);
  return row?.share ?? null;
}

export async function revokeShares(userId: string, threadId: string): Promise<boolean> {
  const owned = await db
    .select({ id: threads.id })
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userId, userId)))
    .limit(1);
  if (owned.length === 0) return false;
  await db
    .update(threadShares)
    .set({ revokedAt: new Date() })
    .where(and(eq(threadShares.threadId, threadId), isNull(threadShares.revokedAt)));
  return true;
}

/**
 * Lo que ve quien abre el enlace: el texto y las fuentes. Nunca las herramientas
 * ni sus argumentos, los adjuntos, el uso de tokens ni datos del usuario.
 */
export async function loadSharedThread(slug: string): Promise<SharedThread | null> {
  const [row] = await db
    .select({ share: threadShares, title: threads.title })
    .from(threadShares)
    .innerJoin(threads, eq(threads.id, threadShares.threadId))
    .where(and(eq(threadShares.slug, slug), isNull(threadShares.revokedAt)))
    .limit(1);
  if (!row) return null;

  let limit: Date | null = null;
  if (row.share.uptoMessageId) {
    const [upto] = await db
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.id, row.share.uptoMessageId))
      .limit(1);
    limit = upto?.createdAt ?? null;
  }

  const rows = await db
    .select({ role: messages.role, content: messages.content, sources: messages.sources, createdAt: messages.createdAt })
    .from(messages)
    .where(
      and(
        eq(messages.threadId, row.share.threadId),
        isNull(messages.supersededAt),
        limit ? lte(messages.createdAt, limit) : undefined,
      ),
    )
    .orderBy(asc(messages.createdAt));

  return {
    title: row.title,
    messages: rows
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content,
        sources: message.sources ?? [],
        createdAt: message.createdAt.toISOString(),
      })),
  };
}
