import { resolveTurnModel } from "@/lib/models/choice";
import { resolveBotMention } from "@/lib/bots/chat";
import { botMessageDeps } from "@/lib/rooms/engine";
import { NextRequest } from "next/server";
import { and, eq, gte, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { messages, threads, type MessageAttachmentMeta } from "@/lib/db/schema";
import { getCurrentUser, permissionDenied } from "@/lib/auth";
import { hasPermission } from "@/lib/access";
import { BACKEND_UNAVAILABLE, getBackend, isBackendAvailable } from "@/lib/agents/registry";
import { checkBotBudget } from "@/lib/agents/budget";
import { connectorsForRun } from "@/lib/connectors/store";
import { defaultAgentSpec } from "@/lib/agents/spec";
import { openuiToolsEnabled, profileFor } from "@/lib/openui/prompt";
import { assistantSettings } from "@/lib/instance/assistant";
import { buildHistory, launchResume, loadCredential, resumeEntrySchema } from "@/lib/runs/launch";
import { createRun } from "@/lib/runs/store";
import { sseResponse } from "@/lib/runs/sse";
import { startRun } from "@/lib/runs/start";

export const runtime = "nodejs";
export const maxDuration = 900;

const attachmentSchema = z.object({
  name: z.string().min(1).max(200),
  mime: z.string().max(120).optional(),
  size: z.number().int().nonnegative().optional(),
  text: z.string().max(120_000),
});

const turnSchema = z.object({
  threadId: z.string().uuid(),
  text: z.string().min(1).max(8000),
  focus: z.enum(["web", "academic", "reddit", "finance", "news"]).optional(),
  mode: z.enum(["search", "research"]).optional(),
  attachments: z.array(attachmentSchema).max(5).optional(),
  /** El usuario ha pedido expresamente una respuesta con interfaz. */
  ui: z.boolean().optional(),
  /** Agente que atiende este turno (se recuerda en el hilo). También vale `@slug` al inicio. */
  botId: z.string().uuid().nullable().optional(),
  explicitSkills: z.array(z.string().max(200)).max(20).optional(),
  /** Editar o regenerar: el mensaje de usuario que se reemplaza (y todo lo posterior). */
  replace: z.object({ messageId: z.string().uuid() }).optional(),
  /** Modelo elegido en el selector del chat. Solo se usa si el agente no fija uno. */
  model: z.object({ provider: z.string().min(1).max(60), model: z.string().min(1).max(200) }).optional(),
});

/** Respuesta a un run en pausa (formulario o aprobación). */
const resumeSchema = z.object({
  resume: z.object({
    runId: z.string().uuid(),
    entries: z.array(resumeEntrySchema).min(1).max(20),
  }),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });

  const raw = await req.json().catch(() => null);

  const resume = resumeSchema.safeParse(raw);
  if (resume.success) {
    const launched = await launchResume({
      userId: user.id,
      runId: resume.data.resume.runId,
      entries: resume.data.resume.entries,
    });
    if (!launched.ok) {
      return Response.json({ error: launched.error, code: launched.code }, { status: launched.status });
    }
    return sseResponse(launched.value.runId, user.id, launched.value.lastSeq, req.signal);
  }

  const parsed = turnSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Petición no válida" }, { status: 400 });
  }
  const { threadId, text, focus, mode, attachments = [], ui, replace, botId, explicitSkills, model: chosenModel } = parsed.data;

  const denied =
    (mode === "research" ? permissionDenied(user, "research") : null) ??
    (ui === true ? permissionDenied(user, "generativeUi") : null) ??
    (attachments.length > 0 ? permissionDenied(user, "attachments") : null);
  if (denied) return denied;

  const [thread] = await db
    .select()
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userId, user.id)))
    .limit(1);
  if (!thread) {
    return Response.json({ error: "Hilo no encontrado" }, { status: 404 });
  }
  // Un hilo de sala solo se mueve por su sala: aquí correría sin confinar al bot.
  if (thread.origin === "room" || thread.origin === "skill_creator") {
    return Response.json({ error: "Este hilo pertenece a una sala de NexBots" }, { status: 400 });
  }

  // `@bot …` da este turno a un NexBot del usuario, confinado a su contenedor.
  const botTurn = await resolveBotMention(user.id, text, botId === undefined ? thread.botId : botId);
  if (botTurn) {
    const botDenied = permissionDenied(user, "bots");
    if (botDenied) return botDenied;
    if (!botTurn.ok) return Response.json({ error: botTurn.error, code: "bot_unavailable" }, { status: botTurn.status });
  }
  const bot = botTurn?.ok ? botTurn : null;

  const turnText = bot?.text ?? text;
  const spec = bot?.spec ?? defaultAgentSpec();
  const runAgent = { id: null, versionId: null };

  if (!isBackendAvailable()) {
    return Response.json({ error: BACKEND_UNAVAILABLE, code: "backend_unavailable" }, { status: 503 });
  }

  if (bot) {
    const budget = await checkBotBudget(bot.bot.id, spec, user.id);
    if (!budget.ok) {
      return Response.json({ error: budget.reason, code: "budget_exceeded" }, { status: 429 });
    }
  }

  const turnModel = resolveTurnModel(spec.model, bot ? null : chosenModel);
  const credential = await loadCredential(user.id, turnModel.provider, turnModel.model);
  if (!credential.ok) {
    return Response.json({ error: credential.error, code: credential.code }, { status: credential.status });
  }

  // Editar o regenerar: el mensaje y todo lo posterior se marca como reemplazado
  // (sigue guardado, pero deja de formar parte de la conversación).
  if (replace) {
    const [target] = await db
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(
        and(
          eq(messages.id, replace.messageId),
          eq(messages.threadId, threadId),
          eq(messages.role, "user"),
          isNull(messages.supersededAt),
        ),
      )
      .limit(1);
    if (!target) return Response.json({ error: "Mensaje no encontrado" }, { status: 404 });

    await db
      .update(messages)
      .set({ supersededAt: new Date() })
      .where(
        and(
          eq(messages.threadId, threadId),
          isNull(messages.supersededAt),
          gte(messages.createdAt, target.createdAt),
        ),
      );
  }

  const attachmentMeta: MessageAttachmentMeta[] = attachments.map(
    ({ name, mime, size }) => ({ name, mime, size }),
  );
  const [userMessage] = await db
    .insert(messages)
    .values({
      threadId,
      role: "user",
      content: text,
      attachments: attachmentMeta.length > 0 ? attachmentMeta : null,
    })
    .returning({ id: messages.id });
  await db
    .update(threads)
    .set({
      ...(thread.title === "Nuevo chat" ? { title: text.slice(0, 60) } : {}),
      ...(thread.backend !== "nas-adk" ? { backend: "nas-adk" } : {}),
      botId: bot?.bot.id ?? null,
      updatedAt: new Date(),
    })
    .where(eq(threads.id, threadId));

  const backend = getBackend();
  const run = await createRun(threadId, user.id, turnText, {
    initiator: "user",
    backend: backend.id,
    agentId: runAgent.id,
    agentVersionId: runAgent.versionId,
    botId: bot?.bot.id ?? null,
  });
  const wantsUi = ui === true;

  const assistant = await assistantSettings();
  // En modo auto la UI se ofrece siempre (si la cuenta puede usarla) y el prompt dice cuándo usarla.
  const autoUi = assistant.ui.mode === "auto" && hasPermission(user, "generativeUi");
  const openuiContext = {
    focus,
    mode,
    userToggle: wantsUi,
    auto: autoUi,
    autoProfile: autoUi && mode !== "research" ? assistant.ui.profile : null,
  };

  // El run vive por su cuenta: cerrar la pestaña no lo aborta y se puede
  // volver a seguir con GET /api/runs/:id/events?after=<seq>.
  void startRun(backend, {
    runId: run.id,
    threadId,
    userId: user.id,
    initiator: "user",
    credential: credential.value,
    userText: turnText,
    attachments: attachments.map(({ name, text: content }) => ({ name, text: content })),
    focus,
    mode,
    openui: openuiToolsEnabled(openuiContext),
    openuiProfile: profileFor(openuiContext),
    openuiRequested: wantsUi,
    limits: { maxTurns: mode === "research" ? assistant.limits.researchMaxTurns : assistant.limits.maxTurns },
    agent: { ...runAgent, spec },
    botVersionId: bot?.botVersionId,
    connectors: [...(await connectorsForRun(user.id, null, spec)).links, ...(bot?.link ? [bot.link] : [])],
    explicitSkills,
    // El motor no guarda sesión: cada turno recibe el historial del hilo.
    history: await buildHistory(threadId, userMessage.id),
  }, bot ? botMessageDeps(bot.bot.id) : undefined);

  // El cliente necesita el id del mensaje guardado para poder editarlo o regenerarlo.
  return sseResponse(run.id, user.id, 0, req.signal, { "X-Nexus-User-Message": userMessage.id });
}
