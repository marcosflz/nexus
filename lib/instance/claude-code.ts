import { eq } from "drizzle-orm";
import { z } from "zod";
import { resetSidecarCapabilities, sidecarCapabilities, sidecarPost } from "@/lib/agents/backends/nas-adk";
import { clearCredentialKey, getCredentialRow, saveProviderConfig, setCredentialKey, type ModelEntry } from "@/lib/credentials";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { instanceSettings } from "@/lib/db/schema";
import { CLAUDE_CODE_PROVIDER } from "@/lib/providers";

/*
 * Claude Code con suscripción. Cada usuario vincula SU cuenta de Anthropic y sus runs solo
 * usan su token, guardado cifrado en su credencial del proveedor `claude-code`. No existe un
 * token común de la instancia: la suscripción no se comparte entre usuarios. El superadmin
 * solo decide si está activado y con qué límites.
 */

const KEY = "claude_code";

// Versiones anteriores guardaban aquí un `tokenEnc` común; se ignora y desaparece al guardar.
const storedSchema = z.object({
  enabled: z.boolean().default(true),
  maxConcurrency: z.number().int().min(1).max(20).default(2),
  timeoutS: z.number().int().min(30).max(1800).default(300),
});
type Stored = z.infer<typeof storedSchema>;

export interface ClaudeCodeStatus {
  available: boolean;
  reason: string | null;
  /** El CLI del servidor está listo (con independencia de la cuenta del usuario). */
  cliReady: boolean;
}

async function loadStored(): Promise<{ stored: Stored; exists: boolean; legacyToken: boolean }> {
  const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.key, KEY)).limit(1);
  const raw = (row?.value ?? {}) as Record<string, unknown>;
  const parsed = storedSchema.safeParse(raw);
  return {
    stored: parsed.success ? parsed.data : storedSchema.parse({}),
    exists: Boolean(row),
    legacyToken: Boolean(raw.tokenEnc),
  };
}

/** Límites de la instancia para un run con Claude Code. Sin fila guardada, los del sidecar. */
export async function claudeCodeRuntime() {
  const { stored, exists } = await loadStored();
  return {
    enabled: stored.enabled,
    ...(exists ? { timeoutS: stored.timeoutS, maxConcurrency: stored.maxConcurrency } : {}),
  };
}

export type UserClaudeCodeToken =
  | { state: "linked"; token: string }
  | { state: "missing" }
  | { state: "unreadable" };

/** Token de la cuenta de Anthropic que ha vinculado el usuario. Nunca sale del servidor. */
export async function userClaudeCodeToken(userId: string): Promise<UserClaudeCodeToken> {
  const row = await getCredentialRow(userId, CLAUDE_CODE_PROVIDER);
  if (!row?.apiKeyEnc) return { state: "missing" };
  try {
    return { state: "linked", token: decryptSecret(row.apiKeyEnc) };
  } catch {
    return { state: "unreadable" };
  }
}

const DISABLED: ClaudeCodeStatus = {
  available: false,
  reason: "Un superadmin ha desactivado Claude Code.",
  cliReady: false,
};

/** Estado del CLI del servidor, sin mirar ninguna cuenta. */
export async function claudeCodeInstanceStatus(): Promise<ClaudeCodeStatus> {
  const { stored } = await loadStored();
  if (!stored.enabled) return DISABLED;
  return (await sidecarCapabilities({}, null)).claudeCode;
}

/** Estado de Claude Code para un usuario concreto: instancia + su cuenta vinculada. */
export async function claudeCodeStatusFor(userId: string): Promise<ClaudeCodeStatus & { linked: boolean }> {
  const { stored } = await loadStored();
  if (!stored.enabled) return { ...DISABLED, linked: false };
  const account = await userClaudeCodeToken(userId);
  if (account.state === "unreadable") {
    const cli = (await sidecarCapabilities({}, null)).claudeCode;
    return {
      available: false,
      cliReady: cli.cliReady,
      linked: false,
      reason: "No se puede leer tu token guardado (¿cambió APP_ENCRYPTION_KEY?). Vuelve a vincular tu cuenta.",
    };
  }
  const status = (await sidecarCapabilities({}, account.state === "linked" ? account.token : null)).claudeCode;
  return { ...status, linked: account.state === "linked" };
}

/** Vista para el superadmin. No hay credenciales que mostrar: son de cada usuario. */
export async function getClaudeCodeSettings() {
  const { stored, legacyToken } = await loadStored();
  return {
    enabled: stored.enabled,
    maxConcurrency: stored.maxConcurrency,
    timeoutS: stored.timeoutS,
    legacyToken,
    status: await claudeCodeInstanceStatus(),
  };
}

export const claudeCodeUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  maxConcurrency: z.number().int().min(1).max(20).optional(),
  timeoutS: z.number().int().min(30).max(1800).optional(),
});

export async function saveClaudeCodeSettings(update: z.infer<typeof claudeCodeUpdateSchema>, userId: string) {
  const { stored } = await loadStored();
  const defined = Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined));
  // Se reescribe entero: así desaparece el token común que guardaban versiones anteriores.
  const value: Stored = { ...stored, ...defined };
  await db
    .insert(instanceSettings)
    .values({ key: KEY, value, updatedBy: userId })
    .onConflictDoUpdate({ target: instanceSettings.key, set: { value, updatedBy: userId, updatedAt: new Date() } });
  resetSidecarCapabilities();
}

/** Formato de los tokens de `claude setup-token`. */
export const claudeCodeTokenSchema = z
  .string()
  .trim()
  .regex(/^sk-ant-oat\d{2}-[A-Za-z0-9_-]{20,500}$/, "No parece un token de «claude setup-token» (sk-ant-oat01-…)");

/** Comprueba el token con el CLI del servidor y, si vale, lo guarda cifrado en la cuenta del usuario. */
export async function linkClaudeCodeAccount(
  userId: string,
  token: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  resetSidecarCapabilities(token);
  const status = (await sidecarCapabilities({}, token)).claudeCode;
  if (!status.available) {
    return { ok: false, status: 400, error: status.reason ?? "Anthropic no ha aceptado ese token." };
  }
  await setCredentialKey({
    userId,
    provider: CLAUDE_CODE_PROVIDER,
    apiKeyEnc: encryptSecret(token),
    defaultModel: "default",
  });
  // Primera vinculación: se activan todos los modelos de la suscripción.
  const row = await getCredentialRow(userId, CLAUDE_CODE_PROVIDER);
  if (row && (!Array.isArray(row.models) || row.models.length <= 1)) {
    const models = await listClaudeCodeModels(userId);
    const advertised = models.ok ? models.models.filter((m) => !m.hint).map(({ id, label }) => ({ id, label })) : [];
    if (advertised.length > 0) {
      await saveProviderConfig({ userId, provider: CLAUDE_CODE_PROVIDER, models: advertised });
    }
  }
  return { ok: true };
}

/** Modelos de la suscripción del usuario, según el propio CLI (sin inferencia). */
export async function listClaudeCodeModels(
  userId: string,
): Promise<{ ok: true; models: ModelEntry[] } | { ok: false; status: number; error: string }> {
  const account = await userClaudeCodeToken(userId);
  if (account.state !== "linked") return { ok: false, status: 400, error: "Primero vincula tu cuenta de Anthropic." };
  const { status, data } = await sidecarPost<{ models: Array<{ id: string; label: string; source?: string }> }>(
    "/v1/claude-code/models",
    { token: account.token },
    { timeoutMs: 70_000 },
  );
  if (status !== 200 || !("models" in data)) {
    return { ok: false, status: status === 200 ? 502 : status, error: ("error" in data && data.error) || "No se pudieron consultar los modelos." };
  }
  return {
    ok: true,
    models: data.models.map(({ id, label, source }) =>
      // «known»: versión conocida del CLI que el token de setup-token no anuncia (la acepta igual).
      source === "known" ? { id, label, hint: "Versión conocida: tu token no la anuncia y puede no estar en tu plan" } : { id, label },
    ),
  };
}

export async function unlinkClaudeCodeAccount(userId: string): Promise<void> {
  const account = await userClaudeCodeToken(userId);
  await clearCredentialKey(userId, CLAUDE_CODE_PROVIDER);
  if (account.state === "linked") resetSidecarCapabilities(account.token);
}

/** Inicia `claude setup-token` en el sidecar para este usuario. Devuelve la URL de Anthropic. */
export async function startClaudeCodeLogin(userId: string) {
  return sidecarPost<{ loginId: string; url: string }>(
    "/v1/claude-code/login/start",
    { owner: userId },
    { timeoutMs: 60_000 },
  );
}

/** Termina la vinculación con el código de Anthropic y guarda el token. El token no sale del servidor. */
export async function finishClaudeCodeLogin(
  userId: string,
  loginId: string,
  code: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { status, data } = await sidecarPost<{ token: string }>(
    "/v1/claude-code/login/finish",
    { owner: userId, loginId, code },
    { timeoutMs: 120_000 },
  );
  if (status !== 200 || !("token" in data) || typeof data.token !== "string") {
    const error = "error" in data && data.error ? data.error : "No se pudo vincular la cuenta.";
    return { ok: false, status: status === 200 ? 502 : status, error };
  }
  return linkClaudeCodeAccount(userId, data.token);
}

export async function cancelClaudeCodeLogin(userId: string, loginId: string): Promise<void> {
  await sidecarPost("/v1/claude-code/login/cancel", { owner: userId, loginId }, { timeoutMs: 15_000 });
}

/** Llamada real y mínima con la cuenta del usuario: `claude auth status` no comprueba que el token siga valiendo. */
export async function testClaudeCode(userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const runtime = await claudeCodeRuntime();
  if (!runtime.enabled) return { ok: false, error: "Claude Code está desactivado." };
  const account = await userClaudeCodeToken(userId);
  if (account.state !== "linked") return { ok: false, error: "Primero vincula tu cuenta de Anthropic." };

  const { status, data } = await sidecarPost<{ error?: string }>(
    "/v1/complete",
    {
      model: {
        provider: CLAUDE_CODE_PROVIDER,
        model: "default",
        apiKey: account.token,
        baseUrl: null,
        timeoutS: Math.min(runtime.timeoutS ?? 120, 120),
        maxConcurrency: runtime.maxConcurrency,
      },
      system: "Responde únicamente con la palabra: ok",
      user: "ok",
      maxTokens: 16,
      temperature: 0,
    },
    { timeoutMs: 130_000 },
  );
  if (status === 200) return { ok: true };
  return { ok: false, error: ("error" in data && data.error) || `El motor respondió ${status}` };
}
