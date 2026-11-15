import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { approvals, messages, threads } from "@/lib/db/schema";
import { enabledModels, getCredentialRow, listCredentials } from "@/lib/credentials";
import { mayUseClaudeCode, modelAllowed, remainingTokens } from "@/lib/access";
import { ensureChatGptToken } from "@/lib/instance/chatgpt";
import { claudeCodeRuntime } from "@/lib/instance/claude-code";
import { getProvider } from "@/lib/providers";
import { getUserAccess, tokensThisMonth } from "@/lib/users";
import { decryptSecret } from "@/lib/crypto";
import type { AgUiEvent } from "@/lib/agui/events";
import type { BackendCredential, HistoryMessage, ResumeItem } from "@/lib/agents/backend";
import { defaultAgentSpec } from "@/lib/agents/spec";
import { loadAgentVersion } from "@/lib/agents/store";
import { botConnector, standardBotConnector } from "@/lib/bots/client";
import { connectorsForRun } from "@/lib/connectors/store";
import { getBackend } from "@/lib/agents/registry";
import { getEventsAfter, getRunCheckpoint, getRunMeta, reopenRun } from "./store";
import { startRun } from "./start";

export type Launch<T> = { ok: true; value: T } | { ok: false; status: number; error: string; code?: string };

const fail = (status: number, error: string, code?: string): Launch<never> => ({
  ok: false,
  status,
  error,
  code,
});

/**
 * Credencial lista para un turno, tras comprobar todo lo que un admin puede
 * limitar. Es el punto común del chat, las reanudaciones y las rutinas (que corren
 * sin sesión). Sin `provider`, la predeterminada; con él, la de ese proveedor.
 * `model` es el que fija el agente, si lo fija: lo que se comprueba es el modelo real.
 */
export async function loadCredential(
  userId: string,
  provider?: string | null,
  model?: string | null,
): Promise<Launch<BackendCredential>> {
  const account = await getUserAccess(userId);
  if (!account || account.disabled) return fail(403, "Esta cuenta está desactivada", "account_disabled");

  // Sin proveedor: el predeterminado, o el primero activo si el predeterminado está apagado.
  const row = provider
    ? await getCredentialRow(userId, provider)
    : ((await listCredentials(userId)).find((item) => item.enabled) ?? null);
  if (!row) {
    return provider
      ? fail(400, `No has configurado el proveedor ${provider}. Añádelo en Ajustes.`, "no_credential")
      : fail(400, "Configura tu proveedor de modelos en Ajustes", "no_credential");
  }
  if (!row.enabled) {
    return fail(400, `Has desactivado ${getProvider(row.provider)?.label ?? row.provider}. Actívalo en Ajustes.`, "no_credential");
  }

  const info = getProvider(row.provider);
  if (info?.requires && !mayUseClaudeCode(account)) {
    return fail(403, `No tienes permiso para usar ${info.label}. Elige otro proveedor en Ajustes.`, "model_not_allowed");
  }
  const isClaudeCode = info?.requires === "claudeCode";
  const effectiveModel = model || row.model || enabledModels(row)[0]?.id || "";
  if (!effectiveModel) {
    return fail(400, `Elige qué modelos de ${info?.label ?? row.provider} quieres usar en Ajustes.`, "no_credential");
  }
  if (!modelAllowed(account, row.provider, effectiveModel)) {
    return fail(403, `Tu cuenta no tiene acceso al modelo ${effectiveModel}. Elige otro en Ajustes.`, "model_not_allowed");
  }

  const remaining = remainingTokens(account, await tokensThisMonth(userId));
  if (remaining === 0) {
    return fail(429, "Has agotado tu cupo mensual de tokens. Habla con un administrador.", "token_limit");
  }

  if (isClaudeCode) {
    const runtime = await claudeCodeRuntime();
    if (!runtime.enabled) return fail(503, "Un superadmin ha desactivado Claude Code.", "model_not_allowed");
    // Solo la cuenta de Anthropic que ha vinculado este usuario: nunca una común.
    let token: string | null = null;
    if (row.apiKeyEnc) {
      try {
        token = decryptSecret(row.apiKeyEnc);
      } catch {
        token = null;
      }
    }
    if (!token) {
      return fail(400, "Vincula tu cuenta de Claude en Ajustes → Suscripciones.", "no_credential");
    }
    return {
      ok: true,
      value: {
        provider: row.provider,
        model: effectiveModel,
        apiKey: token,
        baseUrl: null,
        remainingTokens: remaining,
        timeoutS: runtime.timeoutS,
        maxConcurrency: runtime.maxConcurrency,
      },
    };
  }

  if (info?.requires === "chatgpt") {
    // Token de acceso vigente del plan del usuario (se renueva solo, bajo bloqueo).
    const token = await ensureChatGptToken(userId);
    if (!token.ok) return fail(token.status === 401 ? 400 : token.status, token.error, "no_credential");
    return {
      ok: true,
      value: { provider: row.provider, model: effectiveModel, apiKey: token.accessToken, baseUrl: null, remainingTokens: remaining },
    };
  }

  let apiKey: string | null = null;
  if (row.apiKeyEnc) {
    try {
      apiKey = decryptSecret(row.apiKeyEnc);
    } catch {
      return fail(500, "No se pudo descifrar la API key (¿cambió APP_ENCRYPTION_KEY?)");
    }
  }
  return {
    ok: true,
    value: { provider: row.provider, model: effectiveModel, apiKey, baseUrl: row.baseUrl, remainingTokens: remaining },
  };
}

/** Últimos mensajes del hilo en texto, para motores sin sesión propia. */
export async function buildHistory(threadId: string, excludeMessageId?: string): Promise<HistoryMessage[]> {
  const rows = await db
    .select({ id: messages.id, role: messages.role, content: messages.content })
    .from(messages)
    .where(and(eq(messages.threadId, threadId), isNull(messages.supersededAt)))
    .orderBy(asc(messages.createdAt));
  return rows
    .filter((row) => row.id !== excludeMessageId && row.content.trim() !== "")
    .map((row) => ({
      role: row.role === "user" ? ("user" as const) : ("assistant" as const),
      content: row.content,
    }));
}

export const resumeEntrySchema = z.object({
  callId: z.string().min(1).max(200),
  status: z.enum(["resolved", "approved", "denied"]),
  payload: z.unknown().optional(),
  reason: z.string().max(500).optional(),
  /** Fila de `approvals` que esta respuesta decide, si la pausa era una aprobación. */
  approvalId: z.string().uuid().optional(),
});
export type ResumeEntryInput = z.infer<typeof resumeEntrySchema>;

/**
 * Reanuda un run que espera a una persona.
 *
 * Es la misma fila y el mismo log: el run vuelve a `running` en una transición
 * atómica (si dos pestañas responden a la vez, solo una gana) y continúa
 * numerando eventos donde se quedó.
 */
export async function launchResume(params: {
  userId: string;
  runId: string;
  entries: ResumeEntryInput[];
}): Promise<Launch<{ runId: string; lastSeq: number }>> {
  const { userId, runId, entries } = params;
  const run = await getRunMeta(runId, userId);
  if (!run) return fail(404, "Run no encontrado");
  if (run.status !== "awaiting_input") return fail(409, "El run no está esperando una respuesta");

  const [thread] = await db
    .select()
    .from(threads)
    .where(and(eq(threads.id, run.threadId), eq(threads.userId, userId)))
    .limit(1);
  if (!thread) return fail(404, "Hilo no encontrado");

  // El agente y la versión con los que arrancó el run (no la vigente hoy).
  const agent = run.agentId && run.agentVersionId ? await loadAgentVersion(run.agentId, run.agentVersionId) : null;
  const spec = run.runtimeSnapshot?.spec ?? agent?.spec ?? defaultAgentSpec();
  if (run.agentId && !agent && !run.runtimeSnapshot) return fail(409, "El perfil de Agente se ha retirado");

  const credential = await loadCredential(userId, spec.model.provider, spec.model.model);
  if (!credential.ok) return credential;

  const checkpoint = await getRunCheckpoint(runId);
  if (!checkpoint) return fail(409, "El run no guardó un punto de reanudación");

  if (!(await reopenRun(runId))) return fail(409, "El run ya se reanudó desde otra pestaña");

  const now = new Date();
  for (const entry of entries) {
    if (!entry.approvalId || entry.status === "resolved") continue;
    await db
      .update(approvals)
      .set({ status: entry.status === "approved" ? "approved" : "denied", decidedAt: now })
      .where(
        and(
          eq(approvals.id, entry.approvalId),
          eq(approvals.runId, runId),
          eq(approvals.userId, userId),
          eq(approvals.status, "pending"),
        ),
      );
  }

  // Un run confinado a su bot (computer use o turno de sala) se reanuda igual de confinado.
  const room = run.initiator === "room" ? await (await import("@/lib/rooms/engine")).roomResume(run) : null;
  if (run.initiator === "room" && !room) return fail(409, "El turno de la sala ya no existe");
  // Un bot llamado desde un chat: run de una persona, con bot y sin ser computer use.
  const botChat = run.botId && run.initiator === "user" && !run.computer;
  const chatContext = null;
  const chatDeps = botChat ? (await import("@/lib/rooms/engine")).botMessageDeps(run.botId!) : undefined;
  const confined = run.computer || run.initiator === "room";

  const existing = await getEventsAfter(runId, 0);
  // Si el bot ya no está en marcha, el run continúa sin sus herramientas y lo dirá el modelo.
  const botLink = run.botId ? await (confined ? botConnector(run.botId) : standardBotConnector(run.botId)) : null;
  const resume: ResumeItem[] = entries.map(({ callId, status, payload, reason }) => ({
    callId,
    status,
    payload,
    reason,
  }));

  void startRun(
    getBackend(),
    {
      runId,
      threadId: run.threadId,
      userId,
      initiator: run.initiator,
      credential: credential.value,
      userText: "",
      agent: { id: agent?.agent.id ?? null, versionId: agent?.versionId ?? null, spec },
      history: await buildHistory(run.threadId),
      connectors: [
        ...(confined ? [] : (await connectorsForRun(userId, agent?.agent.id ?? null, spec)).links),
        ...(botLink ? [botLink] : []),
      ],
      computer: run.computer,
      room: run.runtimeSnapshot?.room ?? room?.room ?? undefined,
      checkpoint,
      resume,
    },
    room?.deps ?? chatDeps,
    { events: existing.map((row) => row.payload as AgUiEvent), lastSeq: existing.at(-1)?.seq ?? 0 },
  );

  return { ok: true, value: { runId, lastSeq: existing.at(-1)?.seq ?? 0 } };
}
