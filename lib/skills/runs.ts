import { and, eq, inArray } from "drizzle-orm";
import { hasPermission } from "@/lib/access";
import { getBackend, isBackendAvailable, BACKEND_UNAVAILABLE } from "@/lib/agents/registry";
import { defaultAgentSpec } from "@/lib/agents/spec";
import { standardBotConnector } from "@/lib/bots/client";
import { getOwnedBot } from "@/lib/bots/service";
import { runtimeOfBot } from "@/lib/bots/profile";
import { checkBotBudget } from "@/lib/agents/budget";
import { connectorsForRun } from "@/lib/connectors/store";
import { db } from "@/lib/db";
import { messages, runs, skillDrafts, skillTests, threads } from "@/lib/db/schema";
import { buildHistory, loadCredential } from "@/lib/runs/launch";
import { createRun } from "@/lib/runs/store";
import { startRun } from "@/lib/runs/start";
import { activeRunCount } from "@/lib/runs/registry";
import { maxConcurrentRuns } from "@/lib/runs/routine";
import { getUserAccess } from "@/lib/users";
import { ownedDraft } from "./store";
import { validateSkillFiles } from "./sidecar";

export async function launchCreator(userId: string, draftId: string, text: string) {
  if (!isBackendAvailable()) throw new Error(BACKEND_UNAVAILABLE);
  if (activeRunCount() >= maxConcurrentRuns()) throw new Error("No hay hueco para otro run ahora mismo");
  const draft = await ownedDraft(userId, draftId);
  if (!draft) throw new Error("Borrador no encontrado");
  const credential = await loadCredential(userId);
  if (!credential.ok) throw new Error(credential.error);
  const run = await db.transaction(async (tx) => {
    await tx.select({ id: skillDrafts.id }).from(skillDrafts).where(eq(skillDrafts.id, draftId)).for("update");
    const active = await tx.select({ id: runs.id }).from(runs).where(and(eq(runs.threadId, draft.threadId), inArray(runs.status, ["running", "awaiting_input"])));
    if (active.length) throw new Error("El creador ya está trabajando en este borrador");
    await tx.insert(messages).values({ threadId: draft.threadId, role: "user", content: text });
    const now = new Date();
    const [created] = await tx.insert(runs).values({ threadId: draft.threadId, userId, prompt: text, backend: "nas-adk", initiator: "user", leaseUntil: new Date(now.getTime() + 60_000), heartbeatAt: now }).returning();
    return created;
  });
  const history = await buildHistory(draft.threadId);
  void startRun(getBackend(), { runId: run.id, threadId: draft.threadId, userId, initiator: "user", userText: text,
    credential: credential.value, creatorDraftId: draft.id,
    agent: { id: null, versionId: null, spec: defaultAgentSpec({ name: "Creador de skills", tools: [] }) },
    history: history.slice(0, -1), limits: { maxTurns: 30 },
  });
  return { runId: run.id, threadId: draft.threadId };
}

export async function launchSkillTest(userId: string, draftId: string, input: string, expected: string, botId?: string) {
  if (!isBackendAvailable()) throw new Error(BACKEND_UNAVAILABLE);
  if (activeRunCount() >= maxConcurrentRuns()) throw new Error("No hay hueco para otro run ahora mismo");
  const draft = await ownedDraft(userId, draftId);
  if (!draft) throw new Error("Borrador no encontrado");
  const pack = await validateSkillFiles(draft.files);
  const bot = botId ? await getOwnedBot(userId, botId) : null;
  if (botId && !bot) throw new Error("Nexbot no encontrado");
  const account = await getUserAccess(userId);
  if (bot && (!account || !hasPermission(account, "bots"))) throw new Error("No tienes permiso para usar Nexbots");
  const scripts = Object.keys(pack.files).some((path) => path.startsWith("scripts/"));
  if (scripts && (!bot?.environmentEnabled || bot.status !== "running" || !account || !hasPermission(account, "computer"))) throw new Error("Para probar scripts, selecciona un Nexbot con ordenador en marcha");
  const spec = bot ? runtimeOfBot(bot) : defaultAgentSpec();
  spec.memory.enabled = false;
  if (bot) { const budget = await checkBotBudget(bot.id, spec, userId); if (!budget.ok) throw new Error(budget.reason); }
  const credential = await loadCredential(userId, spec.model.provider, spec.model.model);
  if (!credential.ok) throw new Error(credential.error);
  const [thread] = await db.insert(threads).values({ userId, title: `Prueba · ${pack.manifest.name}`, origin: "skill_test", botId: bot?.id, backend: "nas-adk" }).returning();
  await db.insert(messages).values({ threadId: thread.id, role: "user", content: input });
  const [test] = await db.insert(skillTests).values({ ownerId: userId, draftId, package: pack, input, expected }).returning();
  const run = await createRun(thread.id, userId, input, { botId: bot?.id, backend: "nas-adk" });
  await db.update(skillTests).set({ runId: run.id }).where(eq(skillTests.id, test.id));
  const link = bot?.environmentEnabled && bot.status === "running" ? await standardBotConnector(bot.id) : null;
  void startRun(getBackend(), { runId: run.id, threadId: thread.id, userId, initiator: "user", userText: input,
    credential: credential.value, testId: test.id, agent: { id: null, versionId: null, spec }, botVersionId: bot?.currentVersionId,
    connectors: [...(await connectorsForRun(userId, null, spec)).links, ...(link ? [link] : [])],
    limits: { maxTurns: spec.budgets.maxToolCalls || 25 },
  });
  return { testId: test.id, runId: run.id, threadId: thread.id };
}
