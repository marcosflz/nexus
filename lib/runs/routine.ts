import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bots, messages, runs, threads } from "@/lib/db/schema";
import { checkBotBudget } from "@/lib/agents/budget";
import { BACKEND_UNAVAILABLE, getBackend, isBackendAvailable } from "@/lib/agents/registry";
import { defaultAgentSpec } from "@/lib/agents/spec";
import { runtimeOfBot } from "@/lib/bots/profile";
import { botConnector, standardBotConnector } from "@/lib/bots/client";
import { connectorsForRun } from "@/lib/connectors/store";
import { createNotification } from "@/lib/notifications/store";
import { defaultExecutorDeps } from "./deps";
import { makeOnFinished } from "./finish-hooks";
import { hasPermission } from "@/lib/access";
import { getUserAccess } from "@/lib/users";
import { getProvider } from "@/lib/providers";
import { loadCredential } from "./launch";
import { activeRunCount } from "./registry";
import { startRun } from "./start";
import { createRun } from "./store";

export const maxConcurrentRuns = () => Math.max(1, Number(process.env.NEXUS_MAX_CONCURRENT_RUNS) || 4);
export type RoutineOutcome = { ok: true; runId: string; threadId: string } | { ok: false; error: string; retry?: boolean };
export interface RoutineRequest {
  botId?: string | null;
  ownerId?: string;
  triggerId?: string | null;
  prompt: string;
  context?: string;
  source: string;
  chainDepth?: number;
  manual?: boolean;
  computer?: { maxSteps: number };
}

/** Scheduled and manual tasks share the same Nexbot configuration and harness. */
export async function launchRoutineRun(request: RoutineRequest): Promise<RoutineOutcome> {
  const [bot] = request.botId ? await db.select().from(bots).where(eq(bots.id, request.botId)).limit(1) : [];
  if (request.botId && !bot) return { ok: false, error: "El Nexbot ya no existe" };
  if (bot && request.ownerId && bot.ownerId !== request.ownerId) return { ok: false, error: "Nexbot no encontrado" };
  const ownerId = bot?.ownerId ?? request.ownerId;
  if (!ownerId) return { ok: false, error: "Falta el dueño del run" };
  const spec = bot ? runtimeOfBot(bot) : defaultAgentSpec();
  const notify = (error: string) => createNotification({ userId: ownerId, kind: "run_failed", title: `${spec.name} no pudo ejecutarse`, body: error });
  if (activeRunCount() >= maxConcurrentRuns()) return { ok: false, error: "No hay hueco para otro run ahora mismo", retry: true };
  if (!isBackendAvailable()) return { ok: false, error: BACKEND_UNAVAILABLE };
  const owner = await getUserAccess(ownerId);
  if (!owner || owner.disabled || (bot && !hasPermission(owner, "bots")) || (!request.manual && !hasPermission(owner, "routines")) || (request.computer && !hasPermission(owner, "computer"))) return { ok: false, error: "La cuenta no tiene permiso para esta tarea" };
  const budget = bot ? await checkBotBudget(bot.id, spec, ownerId) : { ok: true as const };
  if (!budget.ok) { await notify(budget.reason); return { ok: false, error: budget.reason }; }
  const credential = await loadCredential(ownerId, spec.model.provider, spec.model.model);
  if (!credential.ok) { await notify(credential.error); return { ok: false, error: credential.error }; }
  if (request.computer && getProvider(credential.value.provider)?.requires === "claudeCode") return { ok: false, error: "El ordenador necesita un modelo con visión por API" };
  const link = bot?.environmentEnabled && bot.status === "running" && hasPermission(owner, "computer") ? await (request.computer ? botConnector(bot.id) : standardBotConnector(bot.id)) : null;
  if (request.computer && !link) return { ok: false, error: "Arranca el ordenador del Nexbot antes de usarlo" };
  const initiator = request.manual ? "user" : "trigger";
  const text = request.context ? `${request.prompt}\n\n${request.context}` : request.prompt;
  const [thread] = await db.insert(threads).values({ userId: ownerId, botId: bot?.id, title: `${spec.name} · ${request.source}`.slice(0, 120), backend: "nas-adk", origin: request.manual ? "chat" : "routine" }).returning({ id: threads.id });
  await db.insert(messages).values({ threadId: thread.id, role: "user", content: text.slice(0, 20_000) });
  const backend = getBackend();
  const run = await createRun(thread.id, ownerId, text, { initiator, backend: backend.id, botId: bot?.id, computer: Boolean(request.computer) });
  if (request.triggerId) await db.update(runs).set({ triggerId: request.triggerId }).where(eq(runs.id, run.id));
  void startRun(backend, { runId: run.id, threadId: thread.id, userId: ownerId, initiator, credential: credential.value,
    userText: text, agent: { id: null, versionId: null, spec }, botVersionId: bot?.currentVersionId, computer: Boolean(request.computer),
    connectors: request.computer ? [link!] : [...(await connectorsForRun(ownerId, null, spec)).links, ...(link ? [link] : [])],
    limits: { maxTurns: request.computer?.maxSteps ?? (spec.budgets.maxToolCalls || 25) },
  }, { ...defaultExecutorDeps(), onFinished: makeOnFinished({ chainDepth: request.chainDepth }) });
  return { ok: true, runId: run.id, threadId: thread.id };
}
