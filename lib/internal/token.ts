import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Credenciales entre el BFF y el sidecar de agentes.
 *
 * - **Petición al sidecar**: `Authorization: Bearer <secreto>` + firma HMAC del
 *   cuerpo con marca de tiempo (caduca a los 60 s en el lado del sidecar).
 * - **Token de run**: lo firma el BFF y lo usa el sidecar para volver a llamar
 *   a `/api/internal/*`. Va atado a un run y a un usuario, y caduca pronto.
 *
 * Los dos usan `NEXUS_AGENT_SECRET`, con formatos de mensaje distintos para que
 * una firma de un tipo no sirva como la del otro.
 */
export const RUN_TOKEN_TTL_MS = 30 * 60 * 1000;

export interface RunTokenClaims {
  runId: string;
  userId: string;
  agentId: string | null;
  /** Epoch ms. */
  exp: number;
}

export function agentSecret(): string {
  const secret = process.env.NEXUS_AGENT_SECRET?.trim();
  if (!secret) {
    throw new Error("NEXUS_AGENT_SECRET no está configurada: el motor de agentes está desactivado");
  }
  return secret;
}

function mac(secret: string, message: string): Buffer {
  return createHmac("sha256", secret).update(message).digest();
}

export function signRunToken(
  claims: Omit<RunTokenClaims, "exp">,
  options: { secret?: string; now?: number; ttlMs?: number } = {},
): string {
  const secret = options.secret ?? agentSecret();
  const payload = Buffer.from(
    JSON.stringify({ ...claims, exp: (options.now ?? Date.now()) + (options.ttlMs ?? RUN_TOKEN_TTL_MS) }),
  ).toString("base64url");
  return `${payload}.${mac(secret, `run-token:${payload}`).toString("base64url")}`;
}

export function verifyRunToken(
  token: string,
  options: { secret?: string; now?: number } = {},
): RunTokenClaims | null {
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length > 0) return null;

  let secret: string;
  try {
    secret = options.secret ?? agentSecret();
  } catch {
    return null;
  }

  const expected = mac(secret, `run-token:${payload}`);
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as RunTokenClaims;
    if (
      typeof claims.runId !== "string" ||
      typeof claims.userId !== "string" ||
      typeof claims.exp !== "number" ||
      claims.exp < (options.now ?? Date.now())
    ) {
      return null;
    }
    return { runId: claims.runId, userId: claims.userId, agentId: claims.agentId ?? null, exp: claims.exp };
  } catch {
    return null;
  }
}

/** Cabeceras que autentican una petición al sidecar (ver `security.py`). */
export function signSidecarRequest(
  body: string,
  options: { secret?: string; now?: number } = {},
): Record<string, string> {
  const secret = options.secret ?? agentSecret();
  const timestamp = String((options.now ?? Date.now()) / 1000);
  return {
    Authorization: `Bearer ${secret}`,
    "X-Nexus-Timestamp": timestamp,
    "X-Nexus-Signature": mac(secret, `${timestamp}.${body}`).toString("hex"),
  };
}
