import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { hashToken } from "@/lib/crypto";
import { hasPermission, isAdminRole, parseAccess, type Permission, type UserAccess, type UserRole } from "@/lib/access";

export const SESSION_COOKIE = "nexus_session";
/** Cookie de cuando el proyecto se llamaba Plexo. Solo se lee, nunca se escribe. */
export const LEGACY_SESSION_COOKIE = "plexo_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** La última actividad se guarda con esta resolución, para no escribir en cada petición. */
const LAST_SEEN_RESOLUTION_MS = 5 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
  canUseClaudeCode: boolean;
  access: UserAccess;
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

/** Origen de la petición, para que un admin reconozca cada sesión. */
export function clientMeta(req: NextRequest): { ip: string | null; userAgent: string | null } {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip: forwarded || req.headers.get("x-real-ip") || null,
    userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
  };
}

export async function createSession(
  userId: string,
  meta: { ip: string | null; userAgent: string | null } = { ip: null, userAgent: null },
): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt,
    ip: meta.ip,
    userAgent: meta.userAgent,
    lastSeenAt: new Date(),
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
      access: users.access,
      lastSeenAt: sessions.lastSeenAt,
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

  const row = rows[0];
  if (!row) return null;
  if (!row.lastSeenAt || Date.now() - row.lastSeenAt.getTime() > LAST_SEEN_RESOLUTION_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.tokenHash, hashToken(token)))
      .catch(() => undefined); // No saber la última actividad no debe impedir entrar.
  }
  const { lastSeenAt: _seen, ...user } = row;
  return { ...user, access: parseAccess(row.access) };
}

/** Usuario admin de la petición, o la respuesta de error que hay que devolver. */
export async function requireAdmin(): Promise<{ user: SessionUser } | { response: Response }> {
  const user = await getCurrentUser();
  if (!user) return { response: Response.json({ error: "No autenticado" }, { status: 401 }) };
  if (!isAdminRole(user.role)) {
    return { response: Response.json({ error: "Solo para administradores" }, { status: 403 }) };
  }
  return { user };
}

/** Usuario superadmin de la petición, o la respuesta de error que hay que devolver. */
export async function requireSuperadmin(): Promise<{ user: SessionUser } | { response: Response }> {
  const user = await getCurrentUser();
  if (!user) return { response: Response.json({ error: "No autenticado" }, { status: 401 }) };
  if (user.role !== "superadmin") {
    return { response: Response.json({ error: "Solo para superadmins" }, { status: 403 }) };
  }
  return { user };
}

/** Respuesta 403 si la cuenta no tiene ese permiso; null si lo tiene. */
export function permissionDenied(user: SessionUser, permission: Permission): Response | null {
  if (hasPermission(user, permission)) return null;
  return Response.json(
    { error: "Tu cuenta no tiene permiso para esta función. Habla con un administrador.", code: "permission_denied" },
    { status: 403 },
  );
}
