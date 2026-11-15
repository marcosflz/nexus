import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { botMemories as memories } from "@/lib/db/schema";
import { likePattern } from "@/lib/sql";

export const MAX_MEMORIES_PER_SCOPE = 200;
const MAX_KEY = 80;
const MAX_VALUE = 1000;

export interface MemoryScope {
  userId: string;
  /** Null = memoria personal del usuario; con id, memoria de ese Nexbot. */
  botId: string | null;
}

const scopeFilter = (scope: MemoryScope) =>
  and(
    eq(memories.userId, scope.userId),
    scope.botId ? eq(memories.botId, scope.botId) : isNull(memories.botId),
    isNull(memories.deletedAt),
  );

/** Normaliza una clave a `minusculas_con_guiones_bajos`. */
export function normalizeKey(key: string): string {
  return key
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_KEY);
}

export type RememberResult = { ok: true; key: string; updated: boolean } | { ok: false; error: string };

export async function remember(scope: MemoryScope, rawKey: string, rawValue: string): Promise<RememberResult> {
  const key = normalizeKey(rawKey);
  const value = rawValue.trim().slice(0, MAX_VALUE);
  if (!key || !value) return { ok: false, error: "Hacen falta una clave y un valor" };

  const updated = await db
    .update(memories)
    .set({ value, updatedAt: new Date() })
    .where(and(scopeFilter(scope), eq(memories.key, key)))
    .returning({ id: memories.id });
  if (updated.length > 0) return { ok: true, key, updated: true };

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(memories)
    .where(scopeFilter(scope));
  if (count >= MAX_MEMORIES_PER_SCOPE) {
    return { ok: false, error: "La memoria está llena: olvida algo antes de guardar más" };
  }
  await db.insert(memories).values({ userId: scope.userId, botId: scope.botId, key, value });
  return { ok: true, key, updated: false };
}

export async function recall(scope: MemoryScope, query: string, limit = 8) {
  const trimmed = query.trim();
  const pattern = trimmed ? likePattern(trimmed.slice(0, 100)) : null;
  const rows = await db
    .select({ key: memories.key, value: memories.value, updatedAt: memories.updatedAt })
    .from(memories)
    .where(
      pattern
        ? and(scopeFilter(scope), or(ilike(memories.key, pattern), ilike(memories.value, pattern)))
        : scopeFilter(scope),
    )
    .orderBy(desc(memories.updatedAt))
    .limit(limit);
  return rows;
}

export async function forget(scope: MemoryScope, rawKey: string): Promise<boolean> {
  const removed = await db
    .update(memories)
    .set({ deletedAt: new Date() })
    .where(and(scopeFilter(scope), eq(memories.key, normalizeKey(rawKey))))
    .returning({ id: memories.id });
  return removed.length > 0;
}
