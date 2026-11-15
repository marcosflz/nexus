import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { sidecarPost } from "@/lib/agents/backends/nas-adk";
import { clearCredentialKey, enabledModels, getCredentialRow, saveProviderConfig, type ModelEntry } from "@/lib/credentials";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { credentials, instanceSettings } from "@/lib/db/schema";
import { CHATGPT_PROVIDER } from "@/lib/providers";

/*
 * Plan de ChatGPT de cada usuario («Sign in with ChatGPT»). Las credenciales (client_id emitido,
 * token de acceso de 1 h y token de refresco que rota en cada uso) se guardan cifradas en SU
 * credencial del proveedor `chatgpt`. Nunca se comparten ni salen del servidor.
 */

const credsSchema = z.object({
  clientId: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number(),
  account: z.string().nullable().optional(),
});
export type ChatGptCredentials = z.infer<typeof credsSchema>;

/** Margen antes de que caduque el token de acceso para renovarlo. */
const REFRESH_MARGIN_S = 300;

/** Identificador opaco de esta instalación para OpenAI (`ext_agent_host_id`): uno por instancia. */
export async function chatgptHostId(): Promise<string> {
  const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.key, "chatgpt")).limit(1);
  const current = (row?.value as { hostId?: unknown } | undefined)?.hostId;
  if (typeof current === "string" && current) return current;
  const hostId = `urn:uuid:${randomUUID()}`;
  await db
    .insert(instanceSettings)
    .values({ key: "chatgpt", value: { hostId } })
    .onConflictDoNothing({ target: instanceSettings.key });
  const [saved] = await db.select().from(instanceSettings).where(eq(instanceSettings.key, "chatgpt")).limit(1);
  return ((saved?.value as { hostId?: string } | undefined)?.hostId ?? hostId) as string;
}

function readCreds(apiKeyEnc: string | null | undefined): ChatGptCredentials | null {
  if (!apiKeyEnc) return null;
  try {
    const parsed = credsSchema.safeParse(JSON.parse(decryptSecret(apiKeyEnc)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type ChatGptAccount =
  | { state: "linked"; account: string | null }
  | { state: "missing" }
  | { state: "unreadable" };

export async function chatgptAccount(userId: string): Promise<ChatGptAccount> {
  const row = await getCredentialRow(userId, CHATGPT_PROVIDER);
  if (!row?.apiKeyEnc) return { state: "missing" };
  const creds = readCreds(row.apiKeyEnc);
  return creds ? { state: "linked", account: creds.account ?? null } : { state: "unreadable" };
}

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; status: number; error: string };

function failure(status: number, data: unknown, fallback: string): { ok: false; status: number; error: string } {
  const error = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : "";
  return { ok: false, status: status === 200 ? 502 : status, error: error && error !== "relink" ? error : fallback };
}

export async function startChatGptLogin(userId: string): Promise<Result<{ loginId: string; url: string }>> {
  // Si OpenAI ya emitió un client_id a este usuario, se reutiliza (no se registra de nuevo).
  const row = await getCredentialRow(userId, CHATGPT_PROVIDER);
  const previous = readCreds(row?.apiKeyEnc);
  const { status, data } = await sidecarPost<{ loginId: string; url: string }>(
    "/v1/chatgpt/login/start",
    { owner: userId, hostId: await chatgptHostId(), clientId: previous?.clientId ?? null },
    { timeoutMs: 20_000 },
  );
  if (status !== 200 || !("url" in data) || !data.url.startsWith("https://auth.openai.com/")) {
    return failure(status, data, "No se pudo iniciar sesión con ChatGPT.");
  }
  return { ok: true, loginId: data.loginId, url: data.url };
}

export async function cancelChatGptLogin(userId: string, loginId: string): Promise<void> {
  await sidecarPost("/v1/chatgpt/login/cancel", { owner: userId, loginId }, { timeoutMs: 10_000 });
}

async function storeCreds(userId: string, creds: ChatGptCredentials): Promise<void> {
  await saveProviderConfig({ userId, provider: CHATGPT_PROVIDER, apiKeyEnc: encryptSecret(JSON.stringify(creds)) });
}

/** Completa el inicio de sesión con la dirección pegada y activa todos los modelos del plan. */
export async function finishChatGptLogin(userId: string, loginId: string, redirectUrl: string): Promise<Result> {
  const { status, data } = await sidecarPost<{ credentials: unknown }>(
    "/v1/chatgpt/login/finish",
    { owner: userId, loginId, redirectUrl },
    { timeoutMs: 40_000 },
  );
  const parsed = status === 200 && "credentials" in data ? credsSchema.safeParse(data.credentials) : null;
  if (!parsed?.success) return failure(status, data, "No se pudo vincular la cuenta de ChatGPT.");
  await storeCreds(userId, parsed.data);
  const row = await getCredentialRow(userId, CHATGPT_PROVIDER);
  if (row && (!Array.isArray(row.models) || row.models.length === 0 || !row.model)) {
    const models = await listChatGptModels(userId);
    if (models.ok && models.models.length > 0) {
      await saveProviderConfig({ userId, provider: CHATGPT_PROVIDER, models: models.models, model: models.models[0]!.id });
    }
  }
  return { ok: true };
}

/**
 * Token de acceso vigente del usuario. Si caduca pronto se renueva, bajo un bloqueo por
 * usuario: el token de refresco rota y usarlo dos veces invalidaría la sesión.
 */
export async function ensureChatGptToken(userId: string): Promise<Result<{ accessToken: string }>> {
  const quick = readCreds((await getCredentialRow(userId, CHATGPT_PROVIDER))?.apiKeyEnc);
  if (!quick) return { ok: false, status: 400, error: "Vincula tu cuenta de ChatGPT en Ajustes → Suscripciones." };
  if (quick.expiresAt - Date.now() / 1000 > REFRESH_MARGIN_S) return { ok: true, accessToken: quick.accessToken };

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`nexus:chatgpt:${userId}`}))`);
    const [row] = await tx
      .select({ apiKeyEnc: credentials.apiKeyEnc })
      .from(credentials)
      .where(and(eq(credentials.userId, userId), eq(credentials.provider, CHATGPT_PROVIDER)))
      .limit(1);
    const creds = readCreds(row?.apiKeyEnc);
    if (!creds) return { ok: false as const, status: 400, error: "Vincula tu cuenta de ChatGPT en Ajustes → Suscripciones." };
    // Otro proceso pudo renovarlo mientras esperábamos el bloqueo.
    if (creds.expiresAt - Date.now() / 1000 > REFRESH_MARGIN_S) return { ok: true as const, accessToken: creds.accessToken };

    const { status, data } = await sidecarPost<{ credentials: unknown }>(
      "/v1/chatgpt/refresh",
      { credentials: creds },
      { timeoutMs: 30_000 },
    );
    if (status === 401) {
      await tx
        .update(credentials)
        .set({ apiKeyEnc: null, updatedAt: new Date() })
        .where(and(eq(credentials.userId, userId), eq(credentials.provider, CHATGPT_PROVIDER)));
      return { ok: false as const, status: 401, error: "Tu sesión de ChatGPT ha caducado. Vuelve a vincular la cuenta en Ajustes → Suscripciones." };
    }
    const parsed = status === 200 && "credentials" in data ? credsSchema.safeParse(data.credentials) : null;
    if (!parsed?.success) return failure(status, data, "No se pudo renovar la sesión de ChatGPT.");
    await tx
      .update(credentials)
      .set({ apiKeyEnc: encryptSecret(JSON.stringify(parsed.data)), updatedAt: new Date() })
      .where(and(eq(credentials.userId, userId), eq(credentials.provider, CHATGPT_PROVIDER)));
    return { ok: true as const, accessToken: parsed.data.accessToken };
  });
}

export async function listChatGptModels(userId: string): Promise<Result<{ models: ModelEntry[] }>> {
  const token = await ensureChatGptToken(userId);
  if (!token.ok) return token;
  const { status, data } = await sidecarPost<{ models: ModelEntry[] }>(
    "/v1/chatgpt/models",
    { accessToken: token.accessToken },
    { timeoutMs: 25_000 },
  );
  if (status !== 200 || !("models" in data)) return failure(status, data, "No se pudieron consultar los modelos de ChatGPT.");
  return { ok: true, models: data.models };
}

export async function unlinkChatGpt(userId: string): Promise<void> {
  await clearCredentialKey(userId, CHATGPT_PROVIDER);
}

/** Llamada real y mínima con el plan del usuario. */
export async function testChatGpt(userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await getCredentialRow(userId, CHATGPT_PROVIDER);
  const model = row ? (row.model || enabledModels(row)[0]?.id) : undefined;
  if (!model) return { ok: false, error: "Activa al menos un modelo de ChatGPT." };
  const token = await ensureChatGptToken(userId);
  if (!token.ok) return { ok: false, error: token.error };
  const { status, data } = await sidecarPost<{ error?: string }>(
    "/v1/complete",
    {
      model: { provider: CHATGPT_PROVIDER, model, apiKey: token.accessToken, baseUrl: null },
      system: "Responde únicamente con la palabra: ok",
      user: "ok",
      maxTokens: 16,
      temperature: 0,
    },
    { timeoutMs: 90_000 },
  );
  if (status === 200) return { ok: true };
  return { ok: false, error: ("error" in data && data.error) || `El motor respondió ${status}` };
}
