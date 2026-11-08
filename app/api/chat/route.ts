import { NextRequest } from "next/server";
import { and, eq, gte, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { messages, threads, type MessageAttachmentMeta } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { defaultBackendId, getBackend, isBackendAvailable, isBackendId } from "@/lib/agents/registry";
import { checkAgentBudget } from "@/lib/agents/budget";
import { selectAgent } from "@/lib/agents/select";
import { connectorsForRun } from "@/lib/connectors/store";
import { defaultAgentSpec } from "@/lib/agents/spec";
import { openuiToolsEnabled, profileFor } from "@/lib/openui/prompt";
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

/** Resultado de un formulario OpenUI que el usuario acaba de enviar. */
const formResultSchema = z.object({
  formName: z.string().max(200).optional(),
  message: z.string().max(2000),
  params: z.record(z.string(), z.unknown()),
  formState: z.record(z.string(), z.unknown()).optional(),
});

const turnSchema = z.object({
  threadId: z.string().uuid(),
  text: z.string().min(1).max(8000),
  focus: z.enum(["web", "academic", "reddit", "finance", "news"]).optional(),
  mode: z.enum(["search", "research"]).optional(),
  attachments: z.array(attachmentSchema).max(5).optional(),
  /** El usuario ha pedido expresamente una respuesta con interfaz. */
  ui: z.boolean().optional(),
  formResult: formResultSchema.optional(),
  /** Motor para este hilo (se recuerda en el hilo). */
  backend: z.string().max(20).optional(),
  /** Agente que atiende este turno (se recuerda en el hilo). También vale `@slug` al inicio. */
  agentId: z.string().uuid().optional(),
  /** Editar o regenerar: el mensaje de usuario que se reemplaza (y todo lo posterior). */
  replace: z.object({ messageId: z.string().uuid() }).optional(),
});

/** Respuesta a un run en pausa (formulario o aprobación). */
const resumeSchema = z.object({
  resume: z.object({
    runId: z.string().uuid(),
    entries: z.array(resumeEntrySchema).min(1).max(20),
  }),
});

const RESEARCH_MAX_TURNS = 40;

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
  const { threadId, text, focus, mode, attachments = [], ui, formResult, backend: requested, replace, agentId } =
    parsed.data;

  const [thread] = await db
    .select()
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userId, user.id)))
    .limit(1);
  if (!thread) {
    return Response.json({ error: "Hilo no encontrado" }, { status: 404 });
  }

  const selection = await selectAgent(user.id, {
    text,
    explicitId: agentId,
    threadAgentId: thread.agentId,
  });
  if (!selection.ok) return Response.json({ error: selection.error }, { status: selection.status });
  const agent = selection.agent;
  const turnText = selection.text;
  const spec = agent?.spec ?? defaultAgentSpec();

  // Un agente trae su propio motor; sin agente manda la elección del usuario.
  const backendId = agent ? spec.backend : (requested ?? thread.backend ?? defaultBackendId());
  if (!isBackendId(backendId)) {
    return Response.json({ error: "Motor de agente desconocido" }, { status: 400 });
  }
  if (!isBackendAvailable(backendId)) {
    return Response.json(
      { error: "El motor nas-adk no está configurado en esta instalación", code: "backend_unavailable" },
      { status: 400 },
    );
  }

  if (agent) {
    const budget = await checkAgentBudget(agent.agent.id, spec, user.id);
    if (!budget.ok) {
      return Response.json({ error: budget.reason, code: "budget_exceeded" }, { status: 429 });
    }
  }

  const credential = await loadCredential(user.id, spec.model.provider);
  if (!credential.ok) {
    return Response.json({ error: credential.error, code: credential.code }, { status: credential.status });
  }

  // Editar o regenerar: el mensaje y todo lo posterior se marca como reemplazado
  // (sigue guardado, pero deja de formar parte de la conversación).
  let backendSessionId = thread.hermesSessionId;
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
    // La sesión de Hermes aún contiene los turnos retirados: se empieza otra.
    backendSessionId = null;
    await db.update(threads).set({ hermesSessionId: null }).where(eq(threads.id, threadId));
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
      ...(thread.backend !== backendId ? { backend: backendId } : {}),
      ...(selection.explicit && agent && thread.agentId !== agent.agent.id ? { agentId: agent.agent.id } : {}),
      updatedAt: new Date(),
    })
    .where(eq(threads.id, threadId));

  const backend = getBackend(backendId);
  const run = await createRun(threadId, user.id, turnText, {
    initiator: "user",
    backend: backend.id,
    agentId: agent?.agent.id ?? null,
    agentVersionId: agent?.versionId ?? null,
  });
  const wantsUi = ui === true;

  // El run vive por su cuenta: cerrar la pestaña no lo aborta y se puede
  // volver a seguir con GET /api/runs/:id/events?after=<seq>.
  void startRun(backend, {
    runId: run.id,
    threadId,
    userId: user.id,
    initiator: "user",
    credential: { ...credential.value, model: spec.model.model || credential.value.model },
    userText: turnText,
    attachments: attachments.map(({ name, text: content }) => ({ name, text: content })),
    focus,
    mode,
    openui: openuiToolsEnabled({ focus, mode, userToggle: wantsUi }),
    openuiProfile: profileFor({ focus, mode, userToggle: wantsUi }),
    openuiRequested: wantsUi,
    formResult: formResult ?? null,
    backendSessionId,
    limits: mode === "research" ? { maxTurns: RESEARCH_MAX_TURNS } : undefined,
    agent: { id: agent?.agent.id ?? null, versionId: agent?.versionId ?? null, spec },
    connectors: backendId === "nas-adk" ? (await connectorsForRun(user.id, agent?.agent.id ?? null, spec)).links : undefined,
    // nas-adk no tiene sesión propia; Hermes la tiene salvo que acabe de reiniciarse.
    history:
      backendId === "nas-adk" || !backendSessionId
        ? await buildHistory(threadId, userMessage.id)
        : undefined,
  });

  // El cliente necesita el id del mensaje guardado para poder editarlo o regenerarlo.
  return sseResponse(run.id, user.id, 0, req.signal, { "X-Nexus-User-Message": userMessage.id });
}
