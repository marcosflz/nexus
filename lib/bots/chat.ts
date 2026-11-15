import { hasPermission } from "@/lib/access";
import { getUserAccess } from "@/lib/users";
import { and, eq } from "drizzle-orm";
import type { ConnectorLink, RoomContext } from "@/lib/agents/backend";
import type { AgentSpec } from "@/lib/agents/spec";
import { parseMention } from "@/lib/agents/slug";
import { db } from "@/lib/db";
import { bots } from "@/lib/db/schema";
import { botBusyInRoom, botBusyOutsideRooms } from "@/lib/rooms/engine";
import { botProfile } from "./profile";
import { standardBotConnector } from "./client";

type BotRow = typeof bots.$inferSelect;

export type BotMention =
  | {
      ok: true;
      bot: BotRow;
      botVersionId: string | null;
      /** El mensaje sin la mención. */
      text: string;
      agent: { id: string | null; versionId: string | null };
      spec: AgentSpec;
      link: ConnectorLink | null;
      context: RoomContext;
    }
  | { ok: false; status: number; error: string };

/** Pasos de un bot en un turno de chat. */
export const BOT_CHAT_MAX_TURNS = 20;

/** Un bot llamado desde un chat: su identidad y su entorno, sin sala ni tablero. */
export function botChatContext(bot: BotRow): RoomContext {
  return {
    environment: bot.environmentEnabled,
    handle: bot.slug,
    botName: bot.name,
    botInstructions: bot.instructions,
    roomName: "",
    topicId: "",
    topicTitle: "",
    members: [],
    board: false,
  };
}

/**
 * `@bot …` al principio de un mensaje de chat da ese turno a un NexBot del usuario.
 * Devuelve null si no hay mención o si el nombre es de un agente (que tiene prioridad,
 * como hasta ahora). El turno corre confinado a su contenedor, igual que en una sala.
 */
export async function resolveBotMention(userId: string, text: string, explicitId?: string | null): Promise<BotMention | null> {
  const mention = parseMention(text);
  if (!mention && !explicitId) return null;
  const [bot] = await db.select().from(bots).where(and(eq(bots.ownerId, userId), mention ? eq(bots.slug, mention.slug) : eq(bots.id, explicitId!))).limit(1);
  if (!bot) return explicitId ? { ok: false, status: 404, error: "Nexbot no encontrado" } : null;
  const rest = mention ? mention.rest : text;

  const fail = (status: number, error: string): BotMention => ({ ok: false, status, error });
  if (!rest) return fail(400, `Dile a @${bot.slug} qué quieres que haga`);
  if ((await botBusyInRoom(bot.id)) || (await botBusyOutsideRooms(bot.id))) {
    return fail(409, `@${bot.slug} está ocupado con otra tarea. Espera a que termine o párala.`);
  }
  const profile = await botProfile(bot.id);
  if (!profile.ok) return fail(409, `@${bot.slug} no puede responder: ${profile.error}`);
  const account = await getUserAccess(userId);
  const link = bot.environmentEnabled && bot.status === "running" && account && hasPermission(account, "computer") ? await standardBotConnector(bot.id) : null;
  return { ok: true, bot, botVersionId: profile.botVersionId, text: rest, agent: profile.agent, spec: profile.spec, link, context: botChatContext(bot) };
}

/** Datos para reanudar un turno de chat de un bot con el mismo confinamiento con el que empezó. */
export async function botChatResume(botId: string): Promise<RoomContext | null> {
  const [bot] = await db.select().from(bots).where(eq(bots.id, botId)).limit(1);
  return bot ? botChatContext(bot) : null;
}
