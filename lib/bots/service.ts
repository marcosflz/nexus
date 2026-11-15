import { and, count, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { checkSkillAssignments } from "@/lib/skills/store";
import { runtimeOfBot } from "./profile";
import { runtimeSettingsSchema } from "@/lib/runtime/spec";
import { sql } from "drizzle-orm";
import { ZodError } from "zod";
import { botVersions, bots, botTasks, messages, runs } from "@/lib/db/schema";
import { cancelRun } from "@/lib/runs/registry";
import { launchRoutineRun } from "@/lib/runs/routine";
import { finishRun } from "@/lib/runs/store";
import { sandboxAvailable } from "@/lib/sandbox/client";
import { botApi, botConnector, botReport, destroyBot, ensureBot, recreateBot, stopBot } from "./client";
import {
  botConfigSchema,
  botSlug,
  isConfigPending,
  isTerminalTask,
  sanitizeSteps,
  statusFromReport,
  taskStatusFromRun,
  type BotConfig,
  type BotInput,
  type BotPatch,
  type BotRuntimeReport,
  type BotTaskInput,
} from "./spec";

export type Bot = typeof bots.$inferSelect;
export type BotTask = typeof botTasks.$inferSelect;
export type Outcome<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

/** El bot no es confiable: lo que informa se acota antes de guardarlo. */
const MAX_TASK_RESULT = 256_000;
const MAX_TASK_ERROR = 2_000;

const fail = (status: number, error: string): Outcome<never> => ({ ok: false, status, error });

const maxBotsPerUser = () => Math.max(1, Number(process.env.NEXUS_MAX_BOTS_PER_USER) || 5);
const maxRunningBots = () => Math.max(1, Number(process.env.NEXUS_MAX_RUNNING_BOTS) || 4);

const configOf = (bot: Bot): BotConfig => botConfigSchema.parse(bot.config ?? {});

async function setBot(id: string, patch: Partial<typeof bots.$inferInsert>): Promise<void> {
  await db.update(bots).set({ ...patch, updatedAt: new Date() }).where(eq(bots.id, id));
}

export async function getOwnedBot(userId: string, id: string): Promise<Bot | null> {
  const [bot] = await db.select().from(bots).where(and(eq(bots.id, id), eq(bots.ownerId, userId))).limit(1);
  return bot ?? null;
}

export async function listBots(userId: string): Promise<Bot[]> {
  return db.select().from(bots).where(eq(bots.ownerId, userId)).orderBy(desc(bots.createdAt));
}

export async function createBot(userId: string, input: BotInput): Promise<Outcome<Bot>> {
  const [{ total }] = await db.select({ total: count() }).from(bots).where(eq(bots.ownerId, userId));
  if (total >= maxBotsPerUser()) return fail(409, `Has llegado al máximo de ${maxBotsPerUser()} bots`);
  try { await checkSkillAssignments(userId, input.skillIds); } catch (error) { return fail(400, String(error)); }

  const base = botSlug(input.name);

  const bot = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`bots:${userId}`}))`);
    const existing = await tx.select({ slug: bots.slug }).from(bots).where(eq(bots.ownerId, userId));
    if (existing.length >= maxBotsPerUser()) return null;
    const reserved = new Set(existing.map((item) => item.slug));
    let available = base;
    for (let suffix = 2; reserved.has(available); suffix += 1) available = `${base}-${suffix}`;
    const [created] = await tx.insert(bots).values({ ownerId: userId, slug: available, name: input.name,
      avatar: input.avatar, description: input.description, instructions: input.instructions, config: input.config,
      role: input.role, execution: input.execution, environmentEnabled: input.environmentEnabled, skillIds: input.skillIds,
    }).returning();
    return saveBotVersion(tx, created);
  });
  if (!bot) return fail(409, `Has llegado al máximo de ${maxBotsPerUser()} bots`);
  return { ok: true, value: bot };
}

type BotTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function saveBotVersion(tx: BotTransaction, bot: Bot): Promise<Bot> {
  const previous = await tx.select({ version: botVersions.version }).from(botVersions).where(eq(botVersions.botId, bot.id)).orderBy(desc(botVersions.version)).limit(1);
  const [version] = await tx.insert(botVersions).values({ botId: bot.id, version: (previous[0]?.version ?? 0) + 1, spec: runtimeOfBot(bot), skillIds: bot.skillIds }).returning();
  const [updated] = await tx.update(bots).set({ currentVersionId: version.id }).where(eq(bots.id, bot.id)).returning();
  return updated;
}

export async function updateBot(bot: Bot, patch: BotPatch): Promise<Outcome<Bot>> {
  try { if (patch.skillIds) await checkSkillAssignments(bot.ownerId, patch.skillIds); } catch (error) { return fail(400, String(error)); }
  if (patch.environmentEnabled === false && bot.environmentEnabled && bot.status === "running") {
    const stopped = await haltBot(bot);
    if (!stopped.ok) return stopped;
  }
  let updated: Bot;
  try { updated = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(bots).where(eq(bots.id, bot.id)).for("update");
    const { config, execution, ...fields } = patch;
    const merged: Record<string, unknown> = { ...current.execution, ...execution };
    for (const key of ["knowledge", "memory", "ui", "budgets", "policy"]) {
      if (execution?.[key] && typeof execution[key] === "object") merged[key] = { ...current.execution[key] as object, ...execution[key] as object };
    }
    const [saved] = await tx.update(bots).set({ ...fields,
      ...(execution ? { execution: runtimeSettingsSchema.parse(merged) } : {}),
      ...(config ? { config: { ...configOf(current), ...config } } : {}), updatedAt: new Date(),
    }).where(eq(bots.id, bot.id)).returning();
    return saveBotVersion(tx, saved);
  }); } catch (error) {
    if (error instanceof ZodError) return fail(400, error.issues[0]?.message ?? "Configuración no válida");
    throw error;
  }
  return { ok: true, value: updated };
}

const ACTIVE_TASK = ["queued", "running", "awaiting_approval"];

async function interruptActiveTasks(botId: string, reason: string): Promise<void> {
  // Un run sigue en marcha fuera del bot: hay que pararlo también.
  const driven = await db
    .select({ runId: botTasks.runId })
    .from(botTasks)
    .where(and(eq(botTasks.botId, botId), ne(botTasks.kind, "plan"), inArray(botTasks.status, ACTIVE_TASK)));
  for (const { runId } of driven) if (runId) cancelRun(runId);
  await db
    .update(botTasks)
    .set({ status: "interrupted", error: reason, finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(botTasks.botId, botId), eq(botTasks.kind, "plan"), inArray(botTasks.status, ACTIVE_TASK)));
}

async function applyReport(bot: Bot, result: Awaited<ReturnType<typeof ensureBot>>): Promise<Outcome<Bot>> {
  if (!result.ok) {
    await setBot(bot.id, { status: "error", lastError: result.error });
    return fail(result.status, result.error);
  }
  const { status, error } = statusFromReport(result.data);
  await setBot(bot.id, { status, lastError: error });
  return { ok: true, value: { ...bot, status, lastError: error } };
}

export async function startBot(bot: Bot): Promise<Outcome<Bot>> {
  if (!bot.environmentEnabled) return fail(400, "Activa el ordenador en la configuración del Nexbot");
  const [{ running }] = await db
    .select({ running: count() })
    .from(bots)
    .where(and(eq(bots.desiredState, "running"), ne(bots.id, bot.id)));
  if (running >= maxRunningBots()) return fail(409, `Ya hay ${running} bots en marcha, el máximo de esta instalación`);
  await setBot(bot.id, { desiredState: "running", status: "starting", lastError: null });
  return applyReport(bot, await ensureBot(bot.id, configOf(bot)));
}

/** Tira el contenedor y crea otro sobre el mismo volumen. */
export async function rebuildBot(bot: Bot): Promise<Outcome<Bot>> {
  if (!bot.environmentEnabled) return fail(400, "Este Nexbot no tiene ordenador");
  await setBot(bot.id, { desiredState: "running", status: "starting", lastError: null });
  await interruptActiveTasks(bot.id, "El contenedor del bot se recreó");
  return applyReport(bot, await recreateBot(bot.id, configOf(bot)));
}

export async function haltBot(bot: Bot): Promise<Outcome<Bot>> {
  const result = await stopBot(bot.id);
  if (!result.ok) {
    await setBot(bot.id, { lastError: result.error });
    return fail(result.status, result.error);
  }
  await setBot(bot.id, { desiredState: "stopped", status: "stopped", lastError: null });
  await interruptActiveTasks(bot.id, "El bot se detuvo");
  return { ok: true, value: { ...bot, desiredState: "stopped", status: "stopped", lastError: null } };
}

/** Sin `purge` el volumen se conserva: borrar los datos debe pedirse expresamente. */
export async function deleteBot(bot: Bot, purge: boolean): Promise<Outcome<null>> {
  const active = await db.select({ id: runs.id }).from(runs).where(and(eq(runs.botId, bot.id), inArray(runs.status, ["running", "awaiting_input"])));
  for (const run of active) if (!cancelRun(run.id)) await finishRun(run.id, { kind: "cancelled" });
  if (bot.environmentEnabled || purge) {
    const result = await destroyBot(bot.id, purge);
    if (!result.ok) return fail(result.status, result.error);
  }
  await db.delete(bots).where(eq(bots.id, bot.id));
  return { ok: true, value: null };
}

/** Hay cambios guardados que el contenedor actual todavía no tiene. */
export const configPendingOf = (bot: Bot, report: BotRuntimeReport | null): boolean =>
  report !== null && isConfigPending(configOf(bot), report.options);

/** Compara lo guardado con la realidad. `reachable: false` significa que no se sabe. */
export async function syncBot(bot: Bot): Promise<{ bot: Bot; runtime: BotRuntimeReport | null; reachable: boolean }> {
  if (!bot.environmentEnabled) return { bot, runtime: null, reachable: true };
  const report = await botReport(bot.id);
  if (!report.ok) return { bot, runtime: null, reachable: false };
  const { status, error } = statusFromReport(report.data);
  // «starting» lo resuelve la propia llamada de arranque.
  if (bot.status !== "starting" && (status !== bot.status || error !== bot.lastError)) {
    await setBot(bot.id, { status, lastError: error });
    if (status !== "running") await interruptActiveTasks(bot.id, error ?? "El bot no está en marcha");
    return { bot: { ...bot, status, lastError: error }, runtime: report.data, reachable: true };
  }
  return { bot, runtime: report.data, reachable: true };
}

/** Arranca los bots que debían estar en marcha. Se llama al iniciar la aplicación. */
export async function reconcileBots(): Promise<void> {
  if (!sandboxAvailable()) return;
  const wanted = await db.select().from(bots).where(eq(bots.desiredState, "running"));
  for (const bot of wanted) {
    if (bot.environmentEnabled) await applyReport(bot, await ensureBot(bot.id, configOf(bot)));
  }
}

// --- Tareas -------------------------------------------------------------------

interface RemoteTask {
  status: string;
  error: string | null;
  result: unknown;
  artifacts: string[];
  failedStep?: number | null;
  approval?: { message: string } | null;
  events?: unknown[];
}

export async function createBotTask(bot: Bot, userId: string, input: BotTaskInput): Promise<Outcome<BotTask>> {
  if (input.kind !== "agent" && (!bot.environmentEnabled || bot.status !== "running")) return fail(409, "La tarea necesita el ordenador del Nexbot en marcha");

  if (input.kind === "plan") {
    const [task] = await db
      .insert(botTasks)
      .values({
        botId: bot.id,
        userId,
        kind: "plan",
        input: { steps: sanitizeSteps(input.steps), timeoutS: input.timeoutS, trace: input.trace },
      })
      .returning();
    const sent = await botApi<RemoteTask>(bot.id, "POST", "tasks", {
      id: task.id,
      steps: input.steps,
      timeoutS: input.timeoutS,
      trace: input.trace,
    });
    if (!sent.ok) {
      await db
        .update(botTasks)
        .set({ status: "failed", error: sent.error, finishedAt: new Date(), updatedAt: new Date() })
        .where(eq(botTasks.id, task.id));
      return fail(sent.status, sent.error);
    }
    return { ok: true, value: task };
  }

  const launched = await launchRoutineRun({
    botId: bot.id, ownerId: bot.ownerId, prompt: input.prompt,
    source: `Nexbot ${bot.name}`, manual: true,
    ...(input.kind === "computer" ? { computer: { maxSteps: input.maxSteps } } : {}),
  });
  if (!launched.ok) return fail(launched.retry ? 429 : 400, launched.error);

  try {
    const [task] = await db
      .insert(botTasks)
      .values({ botId: bot.id, userId, kind: input.kind, status: "running", input: { prompt: input.prompt }, runId: launched.runId })
      .returning();
    return { ok: true, value: task };
  } catch (error) {
    // El índice único de la base de datos gana a dos peticiones simultáneas: esta sobra.
    if (!cancelRun(launched.runId)) await finishRun(launched.runId, { kind: "cancelled" });
    const code = (error as { code?: string })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") return fail(409, "El bot ya está usando su escritorio");
    throw error;
  }
}

async function storeTask(task: BotTask, patch: Partial<typeof botTasks.$inferInsert>): Promise<BotTask> {
  const [row] = await db.update(botTasks).set({ ...patch, updatedAt: new Date() }).where(eq(botTasks.id, task.id)).returning();
  return row;
}

/** Actualiza la tarea desde su fuente real. El bot se considera no confiable: solo aporta estado. */
export async function syncTask(task: BotTask): Promise<{ task: BotTask; live: RemoteTask | null }> {
  if (task.kind !== "plan") {
    if (!task.runId || isTerminalTask(task.status)) return { task, live: null };
    const [run] = await db.select({ status: runs.status, error: runs.error }).from(runs).where(eq(runs.id, task.runId)).limit(1);
    if (!run) return { task, live: null };
    const status = taskStatusFromRun(run.status);
    if (status === task.status) return { task, live: null };
    const finished = isTerminalTask(status);
    const [answer] = finished
      ? await db.select({ content: messages.content }).from(messages).where(and(eq(messages.runId, task.runId), eq(messages.role, "assistant"))).limit(1)
      : [];
    return {
      task: await storeTask(task, {
        status,
        error: run.error,
        finishedAt: finished ? new Date() : null,
        ...(answer ? { result: { text: answer.content.slice(0, MAX_TASK_RESULT) } } : {}),
      }),
      live: null,
    };
  }
  const remote = await botApi<RemoteTask>(task.botId, "GET", `tasks/${task.id}`);
  if (!remote.ok) return { task, live: null };
  const { status, result, artifacts } = remote.data;
  const error = typeof remote.data.error === "string" ? remote.data.error.slice(0, MAX_TASK_ERROR) : null;
  if (status === task.status && error === task.error) return { task, live: remote.data };
  return {
    task: await storeTask(task, {
      status,
      error,
      result: JSON.stringify(result ?? null).length > MAX_TASK_RESULT ? { truncated: true } : (result ?? null),
      artifacts: Array.isArray(artifacts) ? artifacts.slice(0, 500) : [],
      finishedAt: isTerminalTask(status) ? new Date() : null,
    }),
    live: remote.data,
  };
}

export async function getBotTask(botId: string, taskId: string): Promise<BotTask | null> {
  const [task] = await db.select().from(botTasks).where(and(eq(botTasks.id, taskId), eq(botTasks.botId, botId))).limit(1);
  return task ?? null;
}

export async function listBotTasks(botId: string): Promise<BotTask[]> {
  const rows = await db.select().from(botTasks).where(eq(botTasks.botId, botId)).orderBy(desc(botTasks.createdAt)).limit(50);
  return Promise.all(rows.map(async (task) => (isTerminalTask(task.status) ? task : (await syncTask(task)).task)));
}

export async function actOnTask(task: BotTask, action: "cancel" | "approve" | "deny"): Promise<Outcome<BotTask>> {
  if (task.kind !== "plan") {
    if (action !== "cancel") return fail(400, "Las aprobaciones de esta tarea se deciden en la Bandeja");
    if (!task.runId || isTerminalTask(task.status)) return fail(409, "La tarea ya no está en marcha");
    // Si este proceso no lo ejecuta (run en pausa o huérfano), se cierra aquí directamente.
    if (!cancelRun(task.runId)) await finishRun(task.runId, { kind: "cancelled" });
    return { ok: true, value: (await syncTask(task)).task };
  }
  const result =
    action === "cancel"
      ? await botApi(task.botId, "POST", `tasks/${task.id}/cancel`, {})
      : await botApi(task.botId, "POST", `tasks/${task.id}/decision`, { approved: action === "approve" });
  if (!result.ok) return fail(result.status, result.error);
  return { ok: true, value: (await syncTask(task)).task };
}
