import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { hashToken } from "@/lib/crypto";

export const SESSION_COOKIE = "nexus_session";
/** Cookie de cuando el proyecto se llamaba Plexo. Solo se lee, nunca se escribe. */
export const LEGACY_SESSION_COOKIE = "plexo_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
  role: "admin" | "user";
  canUseClaudeCode: boolean;
}

// La cookie solo lleva `Secure` si la petición llega por HTTPS. Con
// NODE_ENV=production y HTTP plano (self-hosted/LAN) el navegador la
// descartaría y el login entraría en bucle.
export function sessionCookieOptions(req: NextRequest, expires?: Date) {
  const forwarded = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const secure = forwarded
    ? forwarded === "https"
    : new URL(req.url).protocol === "https:";

  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    ...(expires ? { expires } : {}),
  };
}

export async function createSession(userId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt,
  });
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** Token de sesión de la petición: la cookie nueva o, en su defecto, la heredada. */
export function readSessionToken(store: {
  get(name: string): { value: string } | undefined;
}): string | undefined {
  return store.get(SESSION_COOKIE)?.value ?? store.get(LEGACY_SESSION_COOKIE)?.value;
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = readSessionToken(store);
  if (!token) return null;

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      canUseClaudeCode: users.canUseClaudeCode,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
        isNull(users.disabledAt),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/** Usuario admin de la petición, o la respuesta de error que hay que devolver. */
export async function requireAdmin(): Promise<{ user: SessionUser } | { response: Response }> {
  const user = await getCurrentUser();
  if (!user) return { response: Response.json({ error: "No autenticado" }, { status: 401 }) };
  if (user.role !== "admin") {
    return { response: Response.json({ error: "Solo para administradores" }, { status: 403 }) };
  }
  return { user };
}
