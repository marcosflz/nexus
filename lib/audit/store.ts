import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { actionAudit } from "@/lib/db/schema";
import type { ActionKind, PolicyEffect } from "@/lib/policy/types";

export interface AuditRow {
  userId: string;
  threadId?: string | null;
  runId?: string | null;
  tool: string;
  kind: ActionKind;
  effect: PolicyEffect;
  rule: string;
  reason?: string | null;
  target?: unknown;
  args?: unknown;
  result?: unknown;
  durationMs?: number | null;
}

const SENSITIVE_KEY = /(pass|secret|token|authorization|cookie|api[_-]?key|credential)/i;

/**
 * Sustituye por `"[redactado]"` cualquier valor cuya clave huela a secreto.
 * La auditoría sirve para saber *qué* pasó, no para custodiar credenciales.
 */
export function redactArgs(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map((item) => redactArgs(item, depth + 1));
  if (typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[redactado]" : redactArgs(nested, depth + 1);
  }
  return out;
}

/** Escribe la fila de auditoría. Nunca debe tumbar un turno si falla. */
export async function recordAction(row: AuditRow): Promise<void> {
  try {
    await db.insert(actionAudit).values({
      userId: row.userId,
      threadId: row.threadId ?? null,
      runId: row.runId ?? null,
      tool: row.tool,
      kind: row.kind,
      effect: row.effect,
      rule: row.rule,
      reason: row.reason ?? null,
      target: (row.target ?? null) as never,
      args: redactArgs(row.args) as never,
      result: (row.result ?? null) as never,
      durationMs: row.durationMs ?? null,
    });
  } catch (error) {
    console.error("[nexus] no se pudo escribir la auditoría", error);
  }
}

export async function listAudit(userId: string, limit = 100) {
  return db
    .select()
    .from(actionAudit)
    .where(eq(actionAudit.userId, userId))
    .orderBy(desc(actionAudit.createdAt))
    .limit(limit);
}
