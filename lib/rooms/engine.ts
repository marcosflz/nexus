import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { hasPermission } from "@/lib/access";
import type { BackendRunInput, RoomContext } from "@/lib/agents/backend";
import { checkBotBudget } from "@/lib/agents/budget";
import { BACKEND_UNAVAILABLE, getBackend, isBackendAvailable } from "@/lib/agents/registry";
import { defaultAgentSpec, type AgentSpec } from "@/lib/agents/spec";
import { botProfile } from "@/lib/bots/profile";
export { botProfile } from "@/lib/bots/profile";
import { botConnector } from "@/lib/bots/client";
import { db } from "@/lib/db";
import { botRooms, bots, botTasks, messages, roomTopics, roomTurns, runs, threads } from "@/lib/db/schema";
import { createNotification } from "@/lib/notifications/store";
import { defaultExecutorDeps } from "@/lib/runs/deps";
import type { ExecutorDeps, FinishedInfo } from "@/lib/runs/executor";
import { loadCredential } from "@/lib/runs/launch";
import { activeRunCount, cancelRun } from "@/lib/runs/registry";
import { maxConcurrentRuns } from "@/lib/runs/routine";
import { startRun } from "@/lib/runs/start";
import { createRun, finishRun } from "@/lib/runs/store";
import { getUserAccess } from "@/lib/users";
import { buildRoomHistory, LIMIT_TEXT, parseMentions, resolveLimits, roundLimitReached } from "./spec";
import { insertNotice, roomMembers, touchTopic, type BotRow, type Room, type Topic } from "./store";

export type Turn = typeof roomTurns.$inferSelect;

const ACTIVE = ["running", "awaiting"] as const;
const PENDING = ["queued", "held"] as const;

const isUniqueViolation = (error: unknown): boolean => {
  const code = (error as { code?: string })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
};

export interface WakeOptions {
  roundId?: string;
  hop?: number;
  reason: "mention" | "assigned" | "unblocked" | "children_done" | "reply";
  triggerMessageId?: string | null;
  parentRunId?: string | null;
}

/** Pone en cola un turno por bot. Si ya tenía uno en cola en ese hilo, no se duplica. */
export async function enqueueTurns(topicId: string, botIds: string[], options: WakeOptions): Promise<string> {
  const roundId = options.roundId ?? randomUUID();
  if (botIds.length === 0) return roundId;
  // De uno en uno: así cada turno tiene su propia marca de tiempo y hablan en el orden pedido.
  for (const botId of botIds) {
    await db
      .insert(roomTurns)
      .values({
        topicId,
        botId,
        roundId,
        hop: options.hop ?? 0,
        reason: options.reason,
        triggerMessageId: options.triggerMessageId ?? null,
        parentRunId: options.parentRunId ?? null,
      })
      .onConflictDoNothing();
  }
  return roundId;
}

/** Encola y arranca lo que quepa. No espera a que el bot termine. */
export async function wake(topicId: string, botIds: string[], options: WakeOptions): Promise<void> {
  await enqueueTurns(topicId, botIds, options);
  void dispatchTopic(topicId).catch((error) => console.error("[nexus] no se pudo despachar la sala:", error));
}

/**
 * Reclama el siguiente turno del hilo. Los índices únicos parciales hacen el trabajo:
 * si el hilo ya tiene un turno activo, o el bot está ocupado en otro hilo, la
 * actualización falla y el turno sigue en cola.
 */
async function claimNextTurn(topicId: string): Promise<Turn | null> {
  try {
    const rows = await db.execute<{ id: string }>(sql`
      UPDATE room_turns SET status = 'running', updated_at = now()
      WHERE id = (
        SELECT id FROM room_turns
        WHERE topic_id = ${topicId} AND status = 'queued'
        ORDER BY created_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id`);
    const id = (rows as unknown as { id: string }[])[0]?.id;
    if (!id) return null;
    const [turn] = await db.select().from(roomTurns).where(eq(roomTurns.id, id)).limit(1);
    return turn ?? null;
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

async function setTurn(id: string, patch: Partial<typeof roomTurns.$inferInsert>, from?: readonly Turn["status"][]) {
  const rows = await db
    .update(roomTurns)
    .set({ ...patch, updatedAt: new Date() })
    .where(from ? and(eq(roomTurns.id, id), inArray(roomTurns.status, [...from])) : eq(roomTurns.id, id))
    .returning({ id: roomTurns.id });
  return rows.length > 0;
}

async function roundUsage(roundId: string): Promise<{ runs: number; tokens: number }> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      tokens: sql<number>`coalesce(sum((${runs.usage}->>'total')::bigint), 0)::bigint`,
    })
    .from(runs)
    .where(eq(runs.groupId, roundId));
  return { runs: row?.total ?? 0, tokens: Number(row?.tokens ?? 0) };
}

async function activeRoomRuns(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(runs)
    .where(and(eq(runs.userId, userId), eq(runs.initiator, "room"), eq(runs.status, "running")));
  return row?.total ?? 0;
}

export async function roomContext(room: Room, topic: Topic, bot: BotRow, members: BotRow[]): Promise<RoomContext> {
  return {
    environment: bot.environmentEnabled,
    handle: bot.slug,
    botName: bot.name,
    botInstructions: bot.instructions,
    roomName: room.name,
    topicId: topic.id,
    topicTitle: topic.title,
    members: members
      .filter((member) => member.id !== bot.id)
      .map((member) => ({ handle: member.slug, name: member.name, description: member.description.slice(0, 300) })),
  };
}

const REASON_TEXT: Record<string, string> = {
  mention: "te han mencionado",
  reply: "eres responsable de este hilo y hay un mensaje nuevo",
  assigned: "se te ha asignado esta tarea",
  unblocked: "lo que bloqueaba esta tarea ya está resuelto",
  children_done: "las subtareas de esta tarea han terminado",
};

/** El bot está ocupado fuera de las salas: una tarea de ordenador o un turno pedido desde un chat. */
export async function botBusyOutsideRooms(botId: string): Promise<boolean> {
  const [task] = await db
    .select({ id: botTasks.id })
    .from(botTasks)
    .where(and(eq(botTasks.botId, botId), eq(botTasks.kind, "computer"), inArray(botTasks.status, ["queued", "running", "awaiting_approval"])))
    .limit(1);
  if (task) return true;
  const [chat] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.botId, botId), eq(runs.initiator, "user"), eq(runs.computer, false), inArray(runs.status, ["running", "awaiting_input"])))
    .limit(1);
  return Boolean(chat);
}

/** El mensaje que guarda el ejecutor queda firmado por el bot. */
export function botMessageDeps(botId: string): ExecutorDeps {
  return { ...roomExecutorDeps(botId), onFinished: defaultExecutorDeps().onFinished };
}

/** Dependencias del ejecutor para un turno: el mensaje queda firmado por el bot. */
export function roomExecutorDeps(botId: string): ExecutorDeps {
  const base = defaultExecutorDeps();
  return {
    ...base,
    onFinished: onTurnFinished,
    async saveAssistantMessage({ threadId, runId, content, sources, tools, parts, followups, usage, reasoning }) {
      const [row] = await db
        .insert(messages)
        .values({ threadId, runId, role: "assistant", content, sources, tools, parts, followups, usage, botId, reasoning: reasoning ?? null })
        .returning({ id: messages.id });
      await db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, threadId));
      return row.id;
    },
  };
}

type LaunchResult = "started" | "skipped" | "busy";

async function launchTurn(turn: Turn): Promise<LaunchResult> {
  const [row] = await db
    .select({ topic: roomTopics, room: botRooms, bot: bots })
    .from(roomTopics)
    .innerJoin(botRooms, eq(botRooms.id, roomTopics.roomId))
    .innerJoin(bots, eq(bots.id, turn.botId))
    .where(eq(roomTopics.id, turn.topicId))
    .limit(1);
  if (!row) {
    await setTurn(turn.id, { status: "skipped", error: "El hilo ya no existe" });
    return "skipped";
  }
  const { topic, room, bot } = row;
  const skip = async (text: string, notice: Parameters<typeof insertNotice>[2], status: Turn["status"] = "skipped") => {
    await setTurn(turn.id, { status, error: text });
    await insertNotice(topic.threadId, text, notice);
    return "skipped" as const;
  };

  const limits = resolveLimits(room.limits);
  const usage = await roundUsage(turn.roundId);
  const limit = roundLimitReached({ hop: turn.hop, ...usage }, limits);
  if (limit) {
    // Se retiene toda la ronda: «Continuar» la reabre como una ronda nueva.
    await setTurn(turn.id, { status: "held" });
    await db
      .update(roomTurns)
      .set({ status: "held", updatedAt: new Date() })
      .where(and(eq(roomTurns.topicId, topic.id), eq(roomTurns.roundId, turn.roundId), eq(roomTurns.status, "queued")));
    await insertNotice(topic.threadId, `${LIMIT_TEXT[limit]}. Los bots esperan a que decidas si continúan.`, {
      kind: "limit",
      limit,
      roundId: turn.roundId,
    });
    return "skipped";
  }

  if (bot.environmentEnabled && bot.status !== "running") {
    return skip(`@${bot.slug} no está en marcha y no ha podido responder.`, { kind: "bot_stopped", botId: bot.id });
  }

  // Una tarea de ordenador o un turno de chat ya usan su escritorio: el turno espera.
  if (await botBusyOutsideRooms(bot.id)) {
    await setTurn(turn.id, { status: "queued" });
    return "busy";
  }

  const failed = (text: string) => skip(`@${bot.slug} no ha podido responder: ${text}`, { kind: "error", botId: bot.id }, "failed");
  const profile = await botProfile(bot.id);
  if (!profile.ok) {
    return profile.paused
      ? skip(`El perfil de @${bot.slug} está en pausa. Actívalo o quítaselo en su panel.`, { kind: "no_profile", botId: bot.id })
      : failed(profile.error);
  }
  const { agent, spec } = profile;
  if (!isBackendAvailable()) return failed(BACKEND_UNAVAILABLE);
  const owner = await getUserAccess(room.ownerId);
  if (owner && !(hasPermission(owner, "bots"))) {
    return failed("tu cuenta no tiene permiso para usar NexBots");
  }
  {
    const budget = await checkBotBudget(bot.id, spec, room.ownerId);
    if (!budget.ok) return failed(budget.reason);
  }
  const credential = await loadCredential(room.ownerId, spec.model.provider, spec.model.model);
  if (!credential.ok) return failed(credential.error);

  const link = bot.environmentEnabled ? await botConnector(bot.id) : null;
  if (bot.environmentEnabled && !link) return skip(`No se pudo conectar con @${bot.slug}.`, { kind: "bot_stopped", botId: bot.id });

  const members = await roomMembers(room.id);
  const handleOf = (botId: string) => members.find((member) => member.id === botId)?.slug ?? "bot";
  const thread = await db
    .select({ role: messages.role, content: messages.content, botId: messages.botId })
    .from(messages)
    .where(and(eq(messages.threadId, topic.threadId), isNull(messages.supersededAt)))
    .orderBy(asc(messages.createdAt));
  const history = buildRoomHistory(thread, bot.id, handleOf, randomUUID().slice(0, 8));
  // El aviso de turno es lo último que lee el modelo: si no remite al hilo, los modelos
  // pequeños contestan al aviso («¡Hola! ¿En qué puedo ayudarte?») y no a lo que se les pidió.
  const prompt =
    `Es tu turno en el hilo «${topic.title}»: ${REASON_TEXT[turn.reason] ?? "te toca responder"}. ` +
    `Haz lo último que se te ha pedido en el hilo, con tus herramientas si hace falta; este aviso no es la petición. ` +
    `Tu respuesta ya se publica con tu nombre: no la empieces con @${bot.slug}.`;

  // El cupo mensual se reparte entre los turnos en marcha: en paralelo no pueden sobrepasarlo.
  const monthly = credential.value.remainingTokens;
  const share = monthly == null ? null : Math.floor(monthly / ((await activeRoomRuns(room.ownerId)) + 1));
  const roundLeft = Math.max(1, limits.maxTokensPerRound - usage.tokens);
  const remainingTokens = share == null ? roundLeft : Math.min(share, roundLeft);

  const backend = getBackend();
  const run = await createRun(topic.threadId, room.ownerId, prompt, {
    initiator: "room",
    backend: backend.id,
    agentId: agent.id,
    agentVersionId: agent.versionId,
    botId: bot.id,
    groupId: turn.roundId,
    parentRunId: turn.parentRunId,
  });
  if (!(await setTurn(turn.id, { runId: run.id }, ["running"]))) {
    // Lo cancelaron mientras se preparaba.
    await finishRun(run.id, { kind: "cancelled" });
    return "skipped";
  }
  if (topic.assigneeBotId === bot.id && (topic.status === "todo" || topic.status === "backlog")) {
    await touchTopic(topic.id, { status: "in_progress" });
  }

  const input: BackendRunInput = {
    runId: run.id,
    threadId: topic.threadId,
    userId: room.ownerId,
    initiator: "room",
    credential: { ...credential.value, remainingTokens },
    userText: prompt,
    agent: { id: agent.id, versionId: agent.versionId, spec },
    botVersionId: profile.botVersionId,
    history,
    // Solo su propio bot: los conectores del perfil actuarían fuera de su contenedor.
    connectors: link ? [link] : [],
    room: await roomContext(room, topic, bot, members),
    limits: { maxTurns: limits.maxStepsPerTurn },
  };
  void startRun(backend, input, roomExecutorDeps(bot.id));
  return "started";
}

/** Arranca los turnos en cola de un hilo, de uno en uno y en orden. */
export async function dispatchTopic(topicId: string): Promise<void> {
  for (let guard = 0; guard < 20; guard += 1) {
    if (activeRunCount() >= maxConcurrentRuns()) return;
    const turn = await claimNextTurn(topicId);
    if (!turn) return;
    let result: LaunchResult;
    try {
      result = await launchTurn(turn);
    } catch (error) {
      await setTurn(turn.id, { status: "failed", error: error instanceof Error ? error.message.slice(0, 500) : "Error" });
      throw error;
    }
    if (result !== "skipped") return;
  }
}

/** Cierra los turnos cuyo run murió sin avisar (reinicio del servidor, lease vencido). */
export async function reconcileTurns(): Promise<void> {
  const stale = await db
    .select({ id: roomTurns.id, status: runs.status, topicId: roomTurns.topicId })
    .from(roomTurns)
    .leftJoin(runs, eq(runs.id, roomTurns.runId))
    .where(and(inArray(roomTurns.status, [...ACTIVE]), sql`${roomTurns.updatedAt} < now() - interval '90 seconds'`));
  for (const row of stale) {
    if (row.status === "running") continue;
    if (row.status === "awaiting_input") await setTurn(row.id, { status: "awaiting" }, ["running"]);
    else if (row.status === "completed") await setTurn(row.id, { status: "done" }, ACTIVE);
    else await setTurn(row.id, { status: "failed", error: "El turno se interrumpió" }, ACTIVE);
  }
}

/** Despacha todos los hilos con turnos en cola. Lo llama el worker y el fin de cada turno. */
export async function dispatchAllRooms(): Promise<void> {
  await reconcileTurns();
  const pending = await db
    .selectDistinct({ topicId: roomTurns.topicId })
    .from(roomTurns)
    .where(eq(roomTurns.status, "queued"))
    .limit(50);
  for (const { topicId } of pending) {
    await dispatchTopic(topicId).catch((error) => console.error("[nexus] no se pudo despachar la sala:", error));
  }
}

/** Fin de un turno: lo cierra y, si el bot mencionó a otros, les da la palabra. */
export async function onTurnFinished(info: FinishedInfo): Promise<void> {
  const [turn] = await db.select().from(roomTurns).where(eq(roomTurns.runId, info.runId)).limit(1);
  if (!turn) return;
  const [bot] = await db.select().from(bots).where(eq(bots.id, turn.botId)).limit(1);
  const [topic] = await db.select().from(roomTopics).where(eq(roomTopics.id, turn.topicId)).limit(1);

  if (info.outcome === "interrupt") {
    await setTurn(turn.id, { status: "awaiting" }, ["running"]);
    await createNotification({
      userId: info.userId,
      agentId: info.agentId,
      runId: info.runId,
      threadId: info.threadId,
      kind: "needs_approval",
      title: `@${bot?.slug ?? "bot"} necesita tu aprobación`,
      body: info.interrupts?.map((item) => item.toolName ?? item.reason).join(", ") ?? "",
    });
    return;
  }

  if (info.outcome === "success") {
    const closed = await setTurn(turn.id, { status: "done" }, ACTIVE);
    if (closed && topic) {
      const members = await roomMembers(topic.roomId);
      const others = members.filter((member) => member.id !== turn.botId);
      const mentioned = parseMentions(info.text, others.map((member) => member.slug));
      const targets = mentioned.map((handle) => others.find((member) => member.slug === handle)!.id);
      await enqueueTurns(topic.id, targets, {
        roundId: turn.roundId,
        hop: turn.hop + 1,
        reason: "mention",
        parentRunId: info.runId,
      });
      await touchTopic(topic.id);
    }
  } else if (info.outcome === "cancelled") {
    await setTurn(turn.id, { status: "cancelled" }, ACTIVE);
  } else {
    const failed = await setTurn(turn.id, { status: "failed", error: info.text.slice(0, 500) }, ACTIVE);
    if (failed && topic) {
      await insertNotice(topic.threadId, `@${bot?.slug ?? "bot"} no ha podido terminar: ${info.text.slice(0, 400)}`, {
        kind: "error",
        botId: turn.botId,
      });
    }
  }
  await dispatchAllRooms();
}

async function cancelTurns(where: ReturnType<typeof and>): Promise<number> {
  const rows = await db
    .select()
    .from(roomTurns)
    .where(and(where, inArray(roomTurns.status, [...ACTIVE, ...PENDING])));
  for (const turn of rows) {
    await setTurn(turn.id, { status: "cancelled" });
    // Si este proceso no lo ejecuta (run en pausa o huérfano), se cierra aquí.
    if (turn.runId && !cancelRun(turn.runId)) await finishRun(turn.runId, { kind: "cancelled" });
  }
  return rows.length;
}

/** Para la conversación de un hilo: corta el turno activo y vacía la cola. */
export const stopTopic = (topicId: string) => cancelTurns(eq(roomTurns.topicId, topicId));

/** Un bot que sale de la sala deja de tener turnos en ella. */
export async function cancelBotTurnsInRoom(roomId: string, botId: string): Promise<number> {
  const topics = await db.select({ id: roomTopics.id }).from(roomTopics).where(eq(roomTopics.roomId, roomId));
  if (topics.length === 0) return 0;
  return cancelTurns(and(eq(roomTurns.botId, botId), inArray(roomTurns.topicId, topics.map((topic) => topic.id))));
}

export async function cancelRoomTurns(roomId: string): Promise<void> {
  const topics = await db.select({ id: roomTopics.id }).from(roomTopics).where(eq(roomTopics.roomId, roomId));
  if (topics.length > 0) await cancelTurns(inArray(roomTurns.topicId, topics.map((topic) => topic.id)));
}

/** «Continuar»: lo retenido por un límite vuelve a la cola como una ronda nueva. */
export async function continueTopic(topicId: string): Promise<number> {
  const roundId = randomUUID();
  const held = await db
    .select({ id: roomTurns.id })
    .from(roomTurns)
    .where(and(eq(roomTurns.topicId, topicId), eq(roomTurns.status, "held")))
    .orderBy(asc(roomTurns.createdAt));
  let resumed = 0;
  for (const { id } of held) {
    try {
      if (await setTurn(id, { status: "queued", roundId, hop: 0 }, ["held"])) resumed += 1;
    } catch (error) {
      // Ya había otro en cola para ese bot: este sobra.
      if (!isUniqueViolation(error)) throw error;
      await setTurn(id, { status: "cancelled" });
    }
  }
  void dispatchTopic(topicId).catch((error) => console.error("[nexus] no se pudo despachar la sala:", error));
  return resumed;
}

/** El bot tiene un turno de sala en marcha: su escritorio está ocupado. */
export async function botBusyInRoom(botId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: roomTurns.id })
    .from(roomTurns)
    .where(and(eq(roomTurns.botId, botId), inArray(roomTurns.status, [...ACTIVE])))
    .limit(1);
  return Boolean(row);
}

/** Turno al que pertenece un run, para que lo que haga en el tablero siga en su ronda. */
export async function turnOfRun(runId: string): Promise<Turn | null> {
  const [turn] = await db.select().from(roomTurns).where(eq(roomTurns.runId, runId)).limit(1);
  return turn ?? null;
}

/** Datos para reanudar un turno en pausa con el mismo confinamiento con el que empezó. */
export async function roomResume(run: { id: string; botId: string | null }): Promise<{ room: RoomContext; deps: ExecutorDeps } | null> {
  const turn = await turnOfRun(run.id);
  if (!turn || !run.botId) return null;
  const [row] = await db
    .select({ topic: roomTopics, room: botRooms, bot: bots })
    .from(roomTopics)
    .innerJoin(botRooms, eq(botRooms.id, roomTopics.roomId))
    .innerJoin(bots, eq(bots.id, turn.botId))
    .where(eq(roomTopics.id, turn.topicId))
    .limit(1);
  if (!row) return null;
  await setTurn(turn.id, { status: "running" }, ["awaiting"]);
  return {
    room: await roomContext(row.room, row.topic, row.bot, await roomMembers(row.room.id)),
    deps: roomExecutorDeps(turn.botId),
  };
}
