import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { approvals, messages, threads } from "@/lib/db/schema";
import { getCredentialRow } from "@/lib/credentials";
import { getUserAccess } from "@/lib/users";
import { decryptSecret } from "@/lib/crypto";
import type { AgUiEvent } from "@/lib/agui/events";
import type { BackendCredential, HistoryMessage, ResumeItem } from "@/lib/agents/backend";
import { defaultAgentSpec } from "@/lib/agents/spec";
import { loadAgentVersion } from "@/lib/agents/store";
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
 * Credencial del usuario con la clave ya descifrada. Sin `provider`, la
 * predeterminada; con él, la de ese proveedor (un agente puede fijar uno).
 */
export async function loadCredential(userId: string, provider?: string | null): Promise<Launch<BackendCredential>> {
  // También cubre rutinas y webhooks, que se ejecutan sin una sesión de por medio.
  const access = await getUserAccess(userId);
  if (!access || access.disabled) return fail(403, "Esta cuenta está desactivada", "account_disabled");

  const row = await getCredentialRow(userId, provider);
  if (!row) {
    return provider
      ? fail(400, `No has configurado el proveedor ${provider}. Añádelo en Ajustes.`, "no_credential")
      : fail(400, "Configura tu proveedor de modelos en Ajustes", "no_credential");
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
    value: { provider: row.provider, model: row.model, apiKey, baseUrl: row.baseUrl },
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
  const spec = agent?.spec ?? defaultAgentSpec();

  const credential = await loadCredential(userId, spec.model.provider);
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

  const existing = await getEventsAfter(runId, 0);
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
      credential: { ...credential.value, model: spec.model.model || credential.value.model },
      userText: "",
      agent: { id: agent?.agent.id ?? null, versionId: agent?.versionId ?? null, spec },
      history: await buildHistory(run.threadId),
      connectors: (await connectorsForRun(userId, agent?.agent.id ?? null, spec)).links,
      checkpoint,
      resume,
    },
    undefined,
    { events: existing.map((row) => row.payload as AgUiEvent), lastSeq: existing.at(-1)?.seq ?? 0 },
  );

  return { ok: true, value: { runId, lastSeq: existing.at(-1)?.seq ?? 0 } };
}
