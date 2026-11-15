import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { botConfigSchema } from "@/lib/bots/spec";
import { db } from "@/lib/db";
import {
  botRoomMembers,
  botRooms,
  bots,
  messages,
  roomActivity,
  roomTopicBlockers,
  roomTopics,
  roomTurns,
  threads,
  type TopicStatus,
} from "@/lib/db/schema";
import { cancelBotTurnsInRoom, cancelRoomTurns, continueTopic, stopTopic, turnOfRun, wake, type WakeOptions } from "./engine";
import {
  BOT_SETTABLE_STATUSES,
  depthOf,
  isClosedStatus,
  MAX_BOARD_WRITES_PER_RUN,
  MAX_SUBTASK_DEPTH,
  parseMentions,
  resolveLimits,
  resolveTargets,
  roomInputSchema,
  roomPatchSchema,
  topicInputSchema,
  topicPatchSchema,
  TOPIC_LABEL,
  wouldCreateCycle,
} from "./spec";
import { getTopic, insertNotice, logActivity, roomMembers, touchTopic, type Actor, type BotRow, type Room, type Topic } from "./store";

export type Outcome<T> = { ok: true; value: T } | { ok: false; status: number; error: string; code?: string };
const fail = (status: number, error: string, code?: string): Outcome<never> => ({ ok: false, status, error, code });

const maxRoomsPerUser = () => Math.max(1, Number(process.env.NEXUS_MAX_ROOMS_PER_USER) || 20);
const MAX_TOPICS_PER_ROOM = 500;

export async function getOwnedRoom(userId: string, id: string): Promise<Room | null> {
  const [room] = await db.select().from(botRooms).where(and(eq(botRooms.id, id), eq(botRooms.ownerId, userId))).limit(1);
  return room ?? null;
}

export async function listRooms(userId: string) {
  const rooms = await db.select().from(botRooms).where(eq(botRooms.ownerId, userId)).orderBy(desc(botRooms.updatedAt));
  if (rooms.length === 0) return [];
  const ids = rooms.map((room) => room.id);
  const members = await db
    .select({ roomId: botRoomMembers.roomId, id: bots.id, name: bots.name, slug: bots.slug, status: bots.status })
    .from(botRoomMembers)
    .innerJoin(bots, eq(bots.id, botRoomMembers.botId))
    .where(inArray(botRoomMembers.roomId, ids));
  const topics = await db
    .select({ roomId: roomTopics.roomId, total: count() })
    .from(roomTopics)
    .where(and(inArray(roomTopics.roomId, ids), sql`${roomTopics.status} NOT IN ('done', 'cancelled')`))
    .groupBy(roomTopics.roomId);
  return rooms.map((room) => ({
    id: room.id,
    name: room.name,
    description: room.description,
    members: members.filter((member) => member.roomId === room.id).map(({ roomId: _roomId, ...member }) => member),
    openTopics: topics.find((row) => row.roomId === room.id)?.total ?? 0,
  }));
}

const networkOf = (bot: BotRow) => botConfigSchema.parse(bot.config ?? {}).network;

async function ownedBots(userId: string, botIds: string[]): Promise<BotRow[] | null> {
  if (botIds.length === 0) return [];
  const rows = await db.select().from(bots).where(and(eq(bots.ownerId, userId), inArray(bots.id, botIds)));
  return rows.length === new Set(botIds).size ? rows : null;
}

/**
 * La sala es un canal entre sus bots: uno sin internet junto a otro con internet
 * podría sacar datos a través de él. Mezclarlos exige que la persona lo acepte.
 */
function mixedNetworkError(room: Pick<Room, "mixedNetworkAck"> | null, all: BotRow[], confirm: boolean): Outcome<never> | null {
  if (confirm || room?.mixedNetworkAck) return null;
  if (new Set(all.map(networkOf)).size <= 1) return null;
  return fail(
    409,
    "Vas a juntar bots con y sin internet. Los bots de una sala se leen entre sí, así que uno sin internet podría pasar datos a otro que sí tiene. Confírmalo para continuar.",
    "mixed_network",
  );
}

export async function createRoom(userId: string, input: z.infer<typeof roomInputSchema>): Promise<Outcome<Room>> {
  const [{ total }] = await db.select({ total: count() }).from(botRooms).where(eq(botRooms.ownerId, userId));
  if (total >= maxRoomsPerUser()) return fail(409, `Has llegado al máximo de ${maxRoomsPerUser()} salas`);
  const members = await ownedBots(userId, input.botIds);
  if (!members) return fail(400, "Solo puedes añadir tus propios bots");
  const mixed = mixedNetworkError(null, members, input.confirmMixedNetwork);
  if (mixed) return mixed;
  const [room] = await db
    .insert(botRooms)
    .values({
      ownerId: userId,
      name: input.name,
      description: input.description,
      mixedNetworkAck: input.confirmMixedNetwork && new Set(members.map(networkOf)).size > 1,
    })
    .returning();
  if (members.length > 0) await db.insert(botRoomMembers).values(members.map((bot) => ({ roomId: room.id, botId: bot.id })));
  await logActivity(room.id, null, { userId }, "room_created", { bots: members.map((bot) => bot.slug) });
  return { ok: true, value: room };
}

export async function updateRoom(room: Room, patch: z.infer<typeof roomPatchSchema>): Promise<Room> {
  const { limits, ...fields } = patch;
  const [updated] = await db
    .update(botRooms)
    .set({ ...fields, ...(limits ? { limits: { ...room.limits, ...limits } } : {}), updatedAt: new Date() })
    .where(eq(botRooms.id, room.id))
    .returning();
  return updated;
}

export async function deleteRoom(room: Room): Promise<void> {
  await cancelRoomTurns(room.id);
  const topics = await db.select({ threadId: roomTopics.threadId }).from(roomTopics).where(eq(roomTopics.roomId, room.id));
  // Los hilos arrastran sus mensajes, runs y tarjetas.
  if (topics.length > 0) await db.delete(threads).where(inArray(threads.id, topics.map((topic) => topic.threadId)));
  await db.delete(botRooms).where(eq(botRooms.id, room.id));
}

export async function addMember(room: Room, botId: string, confirm: boolean): Promise<Outcome<null>> {
  const added = await ownedBots(room.ownerId, [botId]);
  if (!added) return fail(404, "Bot no encontrado");
  const current = await roomMembers(room.id);
  if (current.some((bot) => bot.id === botId)) return { ok: true, value: null };
  if (current.length >= 20) return fail(409, "Una sala admite 20 bots como máximo");
  const mixed = mixedNetworkError(room, [...current, ...added], confirm);
  if (mixed) return mixed;
  await db.insert(botRoomMembers).values({ roomId: room.id, botId }).onConflictDoNothing();
  if (confirm && !room.mixedNetworkAck && new Set([...current, ...added].map(networkOf)).size > 1) {
    await db.update(botRooms).set({ mixedNetworkAck: true }).where(eq(botRooms.id, room.id));
  }
  await logActivity(room.id, null, { userId: room.ownerId }, "member_added", { bot: added[0].slug });
  return { ok: true, value: null };
}

export async function removeMember(room: Room, botId: string): Promise<void> {
  await cancelBotTurnsInRoom(room.id, botId);
  await db.delete(botRoomMembers).where(and(eq(botRoomMembers.roomId, room.id), eq(botRoomMembers.botId, botId)));
  await db.update(roomTopics).set({ assigneeBotId: null }).where(and(eq(roomTopics.roomId, room.id), eq(roomTopics.assigneeBotId, botId)));
  await logActivity(room.id, null, { userId: room.ownerId }, "member_removed", { botId });
}

const memberView = (bot: BotRow) => ({
  id: bot.id,
  name: bot.name,
  slug: bot.slug,
  avatar: bot.avatar,
  description: bot.description,
  status: bot.status,
  network: networkOf(bot),
});

/** Todo lo que pinta la sala: miembros, tarjetas con sus bloqueos y quién está hablando. */
export async function roomOverview(room: Room) {
  const [members, topics] = await Promise.all([
    roomMembers(room.id),
    db.select().from(roomTopics).where(eq(roomTopics.roomId, room.id)).orderBy(desc(roomTopics.updatedAt)).limit(MAX_TOPICS_PER_ROOM),
  ]);
  const ids = topics.map((topic) => topic.id);
  const [blockers, turns, counts] = ids.length
    ? await Promise.all([
        db.select().from(roomTopicBlockers).where(inArray(roomTopicBlockers.topicId, ids)),
        db
          .select({ topicId: roomTurns.topicId, botId: roomTurns.botId, status: roomTurns.status })
          .from(roomTurns)
          .where(and(inArray(roomTurns.topicId, ids), inArray(roomTurns.status, ["queued", "held", "running", "awaiting"]))),
        db
          .select({ threadId: messages.threadId, total: count() })
          .from(messages)
          .where(and(inArray(messages.threadId, topics.map((topic) => topic.threadId)), sql`${messages.role} <> 'system'`))
          .groupBy(messages.threadId),
      ])
    : [[], [], []];
  const statusOf = new Map(topics.map((topic) => [topic.id, topic.status]));
  return {
    room: { id: room.id, name: room.name, description: room.description, limits: resolveLimits(room.limits), mixedNetworkAck: room.mixedNetworkAck },
    members: members.map(memberView),
    topics: topics.map((topic) => {
      const children = topics.filter((child) => child.parentTopicId === topic.id);
      const topicTurns = turns.filter((turn) => turn.topicId === topic.id);
      return {
        id: topic.id,
        title: topic.title,
        status: topic.status,
        assigneeBotId: topic.assigneeBotId,
        parentTopicId: topic.parentTopicId,
        createdByBotId: topic.createdByBotId,
        updatedAt: topic.updatedAt,
        messages: counts.find((row) => row.threadId === topic.threadId)?.total ?? 0,
        blockedBy: blockers
          .filter((edge) => edge.topicId === topic.id)
          .map((edge) => ({ id: edge.blockedById, resolved: statusOf.get(edge.blockedById) === "done" })),
        children: { total: children.length, done: children.filter((child) => child.status === "done").length },
        activeBotId: topicTurns.find((turn) => turn.status === "running" || turn.status === "awaiting")?.botId ?? null,
        queued: topicTurns.filter((turn) => turn.status === "queued").length,
        held: topicTurns.filter((turn) => turn.status === "held").length,
      };
    }),
  };
}

export async function topicDetail(topic: Topic) {
  const [rows, turns, activity] = await Promise.all([
    db
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        botId: messages.botId,
        runId: messages.runId,
        tools: messages.tools,
        reasoning: messages.reasoning,
        notice: messages.notice,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(and(eq(messages.threadId, topic.threadId), isNull(messages.supersededAt)))
      .orderBy(asc(messages.createdAt)),
    db
      .select({ id: roomTurns.id, botId: roomTurns.botId, status: roomTurns.status, runId: roomTurns.runId, reason: roomTurns.reason, hop: roomTurns.hop })
      .from(roomTurns)
      .where(and(eq(roomTurns.topicId, topic.id), inArray(roomTurns.status, ["queued", "held", "running", "awaiting"])))
      .orderBy(asc(roomTurns.createdAt)),
    db.select().from(roomActivity).where(eq(roomActivity.topicId, topic.id)).orderBy(desc(roomActivity.createdAt)).limit(50),
  ]);
  return { messages: rows, turns, activity };
}

async function unresolvedBlockers(topicId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(roomTopicBlockers)
    .innerJoin(roomTopics, eq(roomTopics.id, roomTopicBlockers.blockedById))
    .where(and(eq(roomTopicBlockers.topicId, topicId), sql`${roomTopics.status} <> 'done'`));
  return row?.total ?? 0;
}

/** Despierta al responsable, salvo que la tarjeta esté cerrada o siga bloqueada. */
async function wakeAssignee(topic: Topic, options: WakeOptions): Promise<void> {
  if (!topic.assigneeBotId || isClosedStatus(topic.status)) return;
  if ((await unresolvedBlockers(topic.id)) > 0) return;
  await wake(topic.id, [topic.assigneeBotId], options);
}

export interface NewTopic {
  title: string;
  text: string;
  assigneeBotId: string | null;
  status?: TopicStatus;
  parentTopicId: string | null;
}

/** Crea el hilo y su tarjeta. `round` mantiene en la misma ronda lo que un bot delega. */
export async function createTopic(
  room: Room,
  actor: Actor,
  input: NewTopic,
  round?: Pick<WakeOptions, "roundId" | "hop" | "parentRunId">,
): Promise<Outcome<Topic>> {
  const [{ total }] = await db.select({ total: count() }).from(roomTopics).where(eq(roomTopics.roomId, room.id));
  if (total >= MAX_TOPICS_PER_ROOM) return fail(409, "Esta sala tiene demasiados hilos");
  const members = await roomMembers(room.id);
  if (input.assigneeBotId && !members.some((bot) => bot.id === input.assigneeBotId)) {
    return fail(400, "El responsable debe ser un bot de la sala");
  }
  if (input.parentTopicId && !(await getTopic(room.id, input.parentTopicId))) return fail(400, "La tarea padre no es de esta sala");

  const [thread] = await db
    .insert(threads)
    .values({ userId: room.ownerId, title: input.title.slice(0, 120), backend: "nas-adk", origin: "room" })
    .returning({ id: threads.id });
  const [topic] = await db
    .insert(roomTopics)
    .values({
      roomId: room.id,
      threadId: thread.id,
      title: input.title,
      status: input.status ?? "todo",
      assigneeBotId: input.assigneeBotId,
      parentTopicId: input.parentTopicId,
      createdByBotId: actor.botId ?? null,
    })
    .returning();
  await logActivity(room.id, topic.id, actor, "topic_created", { title: topic.title, assigneeBotId: topic.assigneeBotId });

  let messageId: string | null = null;
  if (input.text) {
    const [message] = await db
      .insert(messages)
      .values({ threadId: thread.id, role: actor.botId ? "assistant" : "user", content: input.text, botId: actor.botId ?? null, runId: actor.runId ?? null })
      .returning({ id: messages.id });
    messageId = message.id;
  }
  // Las menciones de un bot las resuelve el fin de su turno, no la creación de la subtarea.
  const mentioned = actor.botId ? [] : mentionedBots(input.text, members);
  const targets = resolveTargets({ mentioned, assigneeBotId: topic.assigneeBotId, authorBotId: actor.botId });
  if (targets.length > 0 && !isClosedStatus(topic.status)) {
    await wake(topic.id, targets, {
      ...round,
      reason: mentioned.length > 0 ? "mention" : "assigned",
      triggerMessageId: messageId,
    });
  }
  return { ok: true, value: topic };
}

function mentionedBots(text: string, members: BotRow[]): string[] {
  return parseMentions(text, members.map((bot) => bot.slug)).map((handle) => members.find((bot) => bot.slug === handle)!.id);
}

/** Mensaje de la persona en un hilo. Sin mención responde el responsable; sin responsable, queda como nota. */
export async function postMessage(room: Room, topic: Topic, userId: string, text: string) {
  const [message] = await db.insert(messages).values({ threadId: topic.threadId, role: "user", content: text }).returning({ id: messages.id });
  await db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, topic.threadId));
  // Trabajo nuevo reabre una tarjeta cerrada.
  const reopened = isClosedStatus(topic.status);
  await touchTopic(topic.id, reopened ? { status: "todo" } : {});
  if (reopened) await logActivity(room.id, topic.id, { userId }, "status_changed", { from: topic.status, to: "todo", reason: "reopened" });

  const mentioned = mentionedBots(text, await roomMembers(room.id));
  const targets = resolveTargets({ mentioned, assigneeBotId: topic.assigneeBotId });
  if (targets.length > 0) {
    await wake(topic.id, targets, { reason: mentioned.length > 0 ? "mention" : "reply", triggerMessageId: message.id });
  }
  return { messageId: message.id, woken: targets };
}

async function onTopicDone(room: Room, topic: Topic): Promise<void> {
  const dependents = await db
    .select({ topic: roomTopics })
    .from(roomTopicBlockers)
    .innerJoin(roomTopics, eq(roomTopics.id, roomTopicBlockers.topicId))
    .where(eq(roomTopicBlockers.blockedById, topic.id));
  for (const { topic: dependent } of dependents) {
    if (isClosedStatus(dependent.status) || (await unresolvedBlockers(dependent.id)) > 0) continue;
    const next = dependent.status === "blocked" ? "todo" : dependent.status;
    if (next !== dependent.status) await touchTopic(dependent.id, { status: next });
    await logActivity(room.id, dependent.id, {}, "unblocked", { by: topic.id });
    await wakeAssignee({ ...dependent, status: next }, { reason: "unblocked" });
  }
  if (!topic.parentTopicId) return;
  const parent = await getTopic(room.id, topic.parentTopicId);
  if (!parent) return;
  const siblings = await db.select({ status: roomTopics.status }).from(roomTopics).where(eq(roomTopics.parentTopicId, parent.id));
  if (siblings.every((sibling) => isClosedStatus(sibling.status))) await wakeAssignee(parent, { reason: "children_done" });
}

async function setBlockers(room: Room, topic: Topic, blockedByIds: string[]): Promise<Outcome<null>> {
  const unique = [...new Set(blockedByIds)];
  if (unique.length > 0) {
    const found = await db.select({ id: roomTopics.id }).from(roomTopics).where(and(eq(roomTopics.roomId, room.id), inArray(roomTopics.id, unique)));
    if (found.length !== unique.length) return fail(400, "Solo puede bloquearla otra tarea de la misma sala");
  }
  const roomTopicIds = (await db.select({ id: roomTopics.id }).from(roomTopics).where(eq(roomTopics.roomId, room.id))).map((row) => row.id);
  const edges = (await db.select().from(roomTopicBlockers).where(inArray(roomTopicBlockers.topicId, roomTopicIds)))
    .filter((edge) => edge.topicId !== topic.id)
    .map((edge) => [edge.topicId, edge.blockedById] as [string, string]);
  for (const blockedById of unique) {
    if (wouldCreateCycle(edges, topic.id, blockedById)) return fail(400, "Ese bloqueo crearía un ciclo");
    edges.push([topic.id, blockedById]);
  }
  await db.delete(roomTopicBlockers).where(eq(roomTopicBlockers.topicId, topic.id));
  if (unique.length > 0) await db.insert(roomTopicBlockers).values(unique.map((blockedById) => ({ topicId: topic.id, blockedById })));
  return { ok: true, value: null };
}

/**
 * Cambia una tarjeta. `actor.botId` marca que lo pide un bot: no puede cerrarla ni
 * cancelarla, y lo que despierte sigue en su ronda (`round`).
 */
export async function updateTopic(
  room: Room,
  topic: Topic,
  patch: z.infer<typeof topicPatchSchema>,
  actor: Actor,
  round?: Pick<WakeOptions, "roundId" | "hop" | "parentRunId">,
): Promise<Outcome<Topic>> {
  if (patch.status && actor.botId && !BOT_SETTABLE_STATUSES.includes(patch.status)) {
    return fail(403, `Solo una persona puede marcar una tarea como «${TOPIC_LABEL[patch.status]}»`);
  }
  if (patch.assigneeBotId) {
    const members = await roomMembers(room.id);
    if (!members.some((bot) => bot.id === patch.assigneeBotId)) return fail(400, "El responsable debe ser un bot de la sala");
  }
  if (patch.blockedByIds) {
    const blockers = await setBlockers(room, topic, patch.blockedByIds);
    if (!blockers.ok) return blockers;
    await logActivity(room.id, topic.id, actor, "blockers_changed", { blockedByIds: patch.blockedByIds });
  }

  const fields: Partial<typeof roomTopics.$inferInsert> = {};
  if (patch.title !== undefined && patch.title !== topic.title) fields.title = patch.title;
  if (patch.status !== undefined && patch.status !== topic.status) fields.status = patch.status;
  if (patch.assigneeBotId !== undefined && patch.assigneeBotId !== topic.assigneeBotId) fields.assigneeBotId = patch.assigneeBotId;
  if (Object.keys(fields).length > 0) await touchTopic(topic.id, fields);
  const updated = { ...topic, ...fields } as Topic;

  if (fields.title) await db.update(threads).set({ title: fields.title.slice(0, 120) }).where(eq(threads.id, topic.threadId));
  if (fields.status) {
    await logActivity(room.id, topic.id, actor, "status_changed", { from: topic.status, to: fields.status });
    if (fields.status === "cancelled") await stopTopic(topic.id);
    if (fields.status === "done") await onTopicDone(room, updated);
  }
  if ("assigneeBotId" in fields) {
    await logActivity(room.id, topic.id, actor, "assigned", { from: topic.assigneeBotId, to: fields.assigneeBotId ?? null });
    // Asignar una tarea despierta a su nuevo responsable (salvo que se la asigne él mismo).
    if (fields.assigneeBotId && fields.assigneeBotId !== actor.botId) await wakeAssignee(updated, { ...round, reason: "assigned" });
  }
  return { ok: true, value: updated };
}

export async function deleteTopic(topic: Topic): Promise<void> {
  await stopTopic(topic.id);
  await db.update(roomTopics).set({ parentTopicId: null }).where(eq(roomTopics.parentTopicId, topic.id));
  await db.delete(threads).where(eq(threads.id, topic.threadId));
}

export async function roundAction(room: Room, topic: Topic, userId: string, action: "stop" | "continue"): Promise<number> {
  const affected = action === "stop" ? await stopTopic(topic.id) : await continueTopic(topic.id);
  await logActivity(room.id, topic.id, { userId }, action === "stop" ? "round_stopped" : "round_continued", { turns: affected });
  if (action === "stop" && affected > 0) await insertNotice(topic.threadId, "Has parado la conversación de los bots en este hilo.", { kind: "info" });
  return affected;
}

// --- Tablero visto por un bot -------------------------------------------------

export const boardOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("list") }),
  z.object({
    op: z.literal("create_subtask"),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(8000).default(""),
    assignee: z.string().trim().max(60).default(""),
  }),
  z.object({ op: z.literal("set_status"), status: z.string().max(20), topic: z.string().max(60).default("") }),
  z.object({ op: z.literal("assign"), assignee: z.string().trim().min(1).max(60), topic: z.string().max(60).default("") }),
  z.object({ op: z.literal("add_blocker"), blockedBy: z.string().min(1).max(60), topic: z.string().max(60).default("") }),
]);
export type BoardOp = z.infer<typeof boardOpSchema>;

const boardError = (error: string) => ({ error });

/**
 * Operación del tablero pedida por un bot durante su turno. Todo se resuelve dentro
 * de la sala del hilo en el que corre el run: no puede alcanzar otra sala ni otra cuenta.
 */
export async function boardOperation(run: { id: string; threadId: string; userId: string }, op: BoardOp): Promise<Record<string, unknown>> {
  const turn = await turnOfRun(run.id);
  if (!turn) return boardError("Este run no pertenece a ninguna sala");
  const [current] = await db.select().from(roomTopics).where(eq(roomTopics.threadId, run.threadId)).limit(1);
  const room = current ? await getOwnedRoom(run.userId, current.roomId) : null;
  if (!current || !room) return boardError("Este run no pertenece a ninguna sala");
  const members = await roomMembers(room.id);
  const actor: Actor = { botId: turn.botId, runId: run.id };
  const round = { roundId: turn.roundId, hop: turn.hop + 1, parentRunId: run.id };
  const topics = await db.select().from(roomTopics).where(eq(roomTopics.roomId, room.id)).orderBy(desc(roomTopics.updatedAt)).limit(200);
  const handleOf = (botId: string | null) => members.find((bot) => bot.id === botId)?.slug ?? null;

  if (op.op === "list") {
    return {
      current: current.id,
      topics: topics.map((topic) => ({
        id: topic.id,
        title: topic.title,
        status: topic.status,
        assignee: handleOf(topic.assigneeBotId),
        parent: topic.parentTopicId,
      })),
    };
  }

  const [{ writes }] = await db
    .select({ writes: count() })
    .from(roomActivity)
    .where(and(eq(roomActivity.runId, run.id), eq(roomActivity.actorBotId, turn.botId)));
  if (writes >= MAX_BOARD_WRITES_PER_RUN) return boardError(`Ya has hecho ${MAX_BOARD_WRITES_PER_RUN} cambios en el tablero en este turno`);

  const target = "topic" in op && op.topic ? topics.find((topic) => topic.id === op.topic) : current;
  if (!target) return boardError("Esa tarea no existe en esta sala");
  const memberByHandle = (handle: string) => members.find((bot) => bot.slug === handle.replace(/^@/, "").toLowerCase());
  const parentOf = (id: string) => topics.find((topic) => topic.id === id)?.parentTopicId;

  /** Un bot no devuelve el trabajo a quien abrió una tarea superior aún abierta: sería un bucle. */
  const delegatesBack = (assigneeId: string, from: Topic): boolean => {
    for (let node: Topic | undefined = from; node; node = topics.find((topic) => topic.id === node!.parentTopicId)) {
      if (!isClosedStatus(node.status) && node.createdByBotId === assigneeId && assigneeId !== turn.botId) return true;
    }
    return false;
  };

  if (op.op === "create_subtask") {
    if (depthOf(current.id, parentOf) + 1 > MAX_SUBTASK_DEPTH) return boardError("No se pueden anidar más subtareas");
    const assignee = op.assignee ? memberByHandle(op.assignee) : null;
    if (op.assignee && !assignee) return boardError(`@${op.assignee} no es un bot de esta sala`);
    if (assignee && delegatesBack(assignee.id, current)) return boardError("No puedes devolver el trabajo a quien abrió esta tarea");
    const created = await createTopic(
      room,
      actor,
      { title: op.title, text: op.description, assigneeBotId: assignee?.id ?? null, parentTopicId: current.id },
      round,
    );
    return created.ok ? { created: created.value.id, title: created.value.title, assignee: assignee?.slug ?? null } : boardError(created.error);
  }

  if (op.op === "set_status") {
    const status = BOT_SETTABLE_STATUSES.find((value) => value === op.status);
    if (!status) return boardError(`Estado no permitido. Usa uno de: ${BOT_SETTABLE_STATUSES.join(", ")}. Cerrar una tarea es cosa de tu operador.`);
    const updated = await updateTopic(room, target, { status }, actor, round);
    return updated.ok ? { topic: target.id, status } : boardError(updated.error);
  }

  if (op.op === "assign") {
    const assignee = memberByHandle(op.assignee);
    if (!assignee) return boardError(`@${op.assignee} no es un bot de esta sala`);
    if (delegatesBack(assignee.id, target)) return boardError("No puedes devolver el trabajo a quien abrió esta tarea");
    const updated = await updateTopic(room, target, { assigneeBotId: assignee.id }, actor, round);
    return updated.ok ? { topic: target.id, assignee: assignee.slug } : boardError(updated.error);
  }

  const blocker = topics.find((topic) => topic.id === op.blockedBy);
  if (!blocker) return boardError("La tarea que bloquea no existe en esta sala");
  const existing = await db.select().from(roomTopicBlockers).where(eq(roomTopicBlockers.topicId, target.id));
  const updated = await updateTopic(room, target, { blockedByIds: [...existing.map((edge) => edge.blockedById), blocker.id] }, actor, round);
  return updated.ok ? { topic: target.id, blockedBy: blocker.id } : boardError(updated.error);
}
