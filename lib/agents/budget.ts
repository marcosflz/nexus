import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";
import type { AgentSpec } from "./spec";

export interface BudgetUsage {
  runsToday: number;
  tokensToday: number;
}

export type BudgetVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Compara el consumo del día con los límites del agente (0 = sin límite).
 * Es pura para poder probarla; `usageToday` hace la consulta.
 */
export function evaluateBudget(budgets: AgentSpec["budgets"], usage: BudgetUsage): BudgetVerdict {
  if (budgets.maxRunsPerDay > 0 && usage.runsToday >= budgets.maxRunsPerDay) {
    return { ok: false, reason: `Límite diario de ${budgets.maxRunsPerDay} ejecuciones alcanzado` };
  }
  if (budgets.maxTokensPerDay > 0 && usage.tokensToday >= budgets.maxTokensPerDay) {
    return { ok: false, reason: `Límite diario de ${budgets.maxTokensPerDay.toLocaleString("es")} tokens alcanzado` };
  }
  return { ok: true };
}

export function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Consumo de hoy de un agente **por usuario**: cada ejecución la paga con su
 * propia clave quien la lanza, así que el límite del agente se mide por persona
 * y un agente público no agota el cupo de su autor por lo que hagan otros.
 */
export async function usageToday(agentId: string, userId: string, now: Date = new Date()): Promise<BudgetUsage> {
  const [row] = await db
    .select({
      runs: sql<number>`count(*)::int`,
      tokens: sql<number>`coalesce(sum((${runs.usage}->>'total')::bigint), 0)::bigint`,
    })
    .from(runs)
    .where(and(eq(runs.agentId, agentId), eq(runs.userId, userId), gte(runs.createdAt, startOfUtcDay(now))));
  return { runsToday: row?.runs ?? 0, tokensToday: Number(row?.tokens ?? 0) };
}

export async function checkAgentBudget(agentId: string, spec: AgentSpec, userId: string): Promise<BudgetVerdict> {
  const { budgets } = spec;
  if (budgets.maxRunsPerDay === 0 && budgets.maxTokensPerDay === 0) return { ok: true };
  return evaluateBudget(budgets, await usageToday(agentId, userId));
}
