import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, gt, gte, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { adminAudit, skills, bots, connectors, credentials, runs, sessions, threads, users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/crypto";
import { manageError, parseAccess, startOfUtcMonth, type UserAccess, type UserRole } from "@/lib/access";

/** Lo que un admin ve de una cuenta (nunca el hash de la contraseña). */
export interface ManagedUser {
  id: string;
  email: string;
  role: UserRole;
  disabled: boolean;
  disabledAt: string | null;
  disabledReason: string | null;
  adminNote: string | null;
  canUseClaudeCode: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  /** Última actividad en cualquiera de sus sesiones vigentes. */
  lastSeenAt: string | null;
  activeSessions: number;
  access: UserAccess;
  tokensThisMonth: number;
  tokensLast30Days: number;
}

export interface UserSessionView {
  /** Prefijo del hash: basta para revocarla y no sirve para suplantarla. */
  id: string;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
}

export interface AdminAuditEntry {
  id: string;
  actorEmail: string;
  targetEmail: string | null;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface UserDetail {
  user: ManagedUser;
  sessions: UserSessionView[];
  usageByDay: { day: string; tokens: number; runs: number }[];
  counts: { threads: number; skills: number; bots: number; connectors: number };
  providers: string[];
  recentRuns: { id: string; status: string; initiator: string; tokens: number; error: string | null; createdAt: string }[];
  bots: { id: string; name: string; status: string }[];
  audit: AdminAuditEntry[];
}

export interface UserPatch {
  role?: UserRole;
  disabled?: boolean;
  disabledReason?: string | null;
  adminNote?: string | null;
  email?: string;
  canUseClaudeCode?: boolean;
  access?: UserAccess;
  /** Contraseña nueva: cierra todas las sesiones de la cuenta. */
  password?: string;
}

/** Bloqueo para operaciones que dependen de cuántas cuentas o admins hay. */
const USERS_LOCK = 7_316_001;

export function generatePassword(): string {
  return randomBytes(12).toString("base64url");
}

type SessionStats = { active: number; lastSeen: string | null };

function toManaged(
  row: typeof users.$inferSelect,
  usage: { month: number; last30: number } = { month: 0, last30: 0 },
  sessionStats: SessionStats = { active: 0, lastSeen: null },
): ManagedUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    disabled: row.disabledAt !== null,
    disabledAt: row.disabledAt?.toISOString() ?? null,
    disabledReason: row.disabledReason,
    adminNote: row.adminNote,
    canUseClaudeCode: row.canUseClaudeCode,
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    lastSeenAt: sessionStats.lastSeen ? new Date(sessionStats.lastSeen).toISOString() : null,
    activeSessions: sessionStats.active,
    access: parseAccess(row.access),
    tokensThisMonth: usage.month,
    tokensLast30Days: usage.last30,
  };
}

/** Tokens gastados por cada cuenta en el mes en curso y en los últimos 30 días. */
async function usageByUser(now: Date, userId?: string) {
  const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const month = startOfUtcMonth(now);
  const from = since30 < month ? since30 : month;
  const total = sql`coalesce((${runs.usage}->>'total')::bigint, 0)`;
  const rows = await db
    .select({
      userId: runs.userId,
      month: sql<string>`coalesce(sum(${total}) FILTER (WHERE ${runs.createdAt} >= ${month.toISOString()}::timestamptz), 0)`,
      last30: sql<string>`coalesce(sum(${total}) FILTER (WHERE ${runs.createdAt} >= ${since30.toISOString()}::timestamptz), 0)`,
    })
    .from(runs)
    .where(userId ? and(eq(runs.userId, userId), gte(runs.createdAt, from)) : gte(runs.createdAt, from))
    .groupBy(runs.userId);
  return new Map(rows.map((row) => [row.userId, { month: Number(row.month), last30: Number(row.last30) }]));
}

async function sessionStatsByUser(userId?: string): Promise<Map<string, SessionStats>> {
  const alive = gt(sessions.expiresAt, new Date());
  const rows = await db
    .select({
      userId: sessions.userId,
      active: count(),
      lastSeen: sql<string | null>`max(${sessions.lastSeenAt})`,
    })
    .from(sessions)
    .where(userId ? and(alive, eq(sessions.userId, userId)) : alive)
    .groupBy(sessions.userId);
  return new Map(rows.map((row) => [row.userId, { active: row.active, lastSeen: row.lastSeen }]));
}

export async function listUsers(): Promise<ManagedUser[]> {
  const [rows, usage, stats] = await Promise.all([
    db.select().from(users).orderBy(asc(users.createdAt)),
    usageByUser(new Date()),
    sessionStatsByUser(),
  ]);
  return rows.map((row) => toManaged(row, usage.get(row.id), stats.get(row.id)));
}

type Executor = Pick<typeof db, "insert">;

/** Deja constancia de una acción de administración. `detail` nunca lleva contraseñas ni claves. */
export async function recordAdminAction(
  actor: { id: string; email: string },
  target: { id: string; email: string } | null,
  action: string,
  detail: Record<string, unknown> = {},
  executor: Executor = db,
): Promise<void> {
  await executor.insert(adminAudit).values({
    actorId: actor.id,
    actorEmail: actor.email,
    targetId: target?.id ?? null,
    targetEmail: target?.email ?? null,
    action,
    detail,
  });
}

function toAudit(row: typeof adminAudit.$inferSelect): AdminAuditEntry {
  return {
    id: row.id,
    actorEmail: row.actorEmail,
    targetEmail: row.targetEmail,
    action: row.action,
    detail: row.detail,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Todo lo que un admin puede consultar de una cuenta. Las claves no salen de aquí. */
export async function getUserDetail(userId: string): Promise<UserDetail | null> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) return null;

  const now = new Date();
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const tokens = sql`coalesce((${runs.usage}->>'total')::bigint, 0)`;
  const day = sql<string>`to_char(${runs.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const owned = async (table: typeof threads | typeof connectors, column: typeof threads.userId | typeof connectors.userId) =>
    (await db.select({ total: count() }).from(table).where(eq(column, userId)))[0].total;

  const [usage, stats, sessionRows, daily, threadCount, agentCount, botRows, connectorCount, providerRows, runRows, auditRows] =
    await Promise.all([
      usageByUser(now, userId),
      sessionStatsByUser(userId),
      db
        .select()
        .from(sessions)
        .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, now)))
        .orderBy(desc(sessions.createdAt)),
      db
        .select({ day, tokens: sql<string>`coalesce(sum(${tokens}), 0)`, runs: count() })
        .from(runs)
        .where(and(eq(runs.userId, userId), gte(runs.createdAt, since)))
        .groupBy(day)
        .orderBy(desc(day)),
      owned(threads, threads.userId),
      db.select({ total: count() }).from(skills).where(eq(skills.ownerId, userId)),
      db.select({ id: bots.id, name: bots.name, status: bots.status }).from(bots).where(eq(bots.ownerId, userId)),
      owned(connectors, connectors.userId),
      db.select({ provider: credentials.provider }).from(credentials).where(eq(credentials.userId, userId)),
      db
        .select({
          id: runs.id,
          status: runs.status,
          initiator: runs.initiator,
          usage: runs.usage,
          error: runs.error,
          createdAt: runs.createdAt,
        })
        .from(runs)
        .where(eq(runs.userId, userId))
        .orderBy(desc(runs.createdAt))
        .limit(15),
      db
        .select()
        .from(adminAudit)
        .where(or(eq(adminAudit.targetId, userId), eq(adminAudit.actorId, userId)))
        .orderBy(desc(adminAudit.createdAt))
        .limit(50),
    ]);

  return {
    user: toManaged(row, usage.get(userId), stats.get(userId)),
    sessions: sessionRows.map((session) => ({
      id: session.tokenHash.slice(0, 16),
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt?.toISOString() ?? null,
      expiresAt: session.expiresAt.toISOString(),
      ip: session.ip,
      userAgent: session.userAgent,
    })),
    usageByDay: daily.map((entry) => ({ day: entry.day, tokens: Number(entry.tokens), runs: entry.runs })),
    counts: { threads: threadCount, skills: agentCount[0].total, bots: botRows.length, connectors: connectorCount },
    providers: providerRows.map((entry) => entry.provider),
    recentRuns: runRows.map((run) => ({
      id: run.id,
      status: run.status,
      initiator: run.initiator,
      tokens: Number((run.usage as { total?: number } | null)?.total ?? 0),
      error: run.error?.slice(0, 300) ?? null,
      createdAt: run.createdAt.toISOString(),
    })),
    bots: botRows,
    audit: auditRows.map(toAudit),
  };
}

/** Tokens gastados por una cuenta en el mes natural en curso. */
export async function tokensThisMonth(userId: string, now: Date = new Date()): Promise<number> {
  return (await usageByUser(now, userId)).get(userId)?.month ?? 0;
}

/** El registro solo está abierto para crear la primera cuenta de la instancia. */
export async function registrationOpen(): Promise<boolean> {
  const [row] = await db.select({ total: count() }).from(users);
  return row.total === 0;
}

/** Crea la primera cuenta como superadmin; null si ya existe alguna. */
export async function createFirstAdmin(email: string, password: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${USERS_LOCK})`);
    const [existing] = await tx.select({ total: count() }).from(users);
    if (existing.total > 0) return null;
    const [user] = await tx
      .insert(users)
      .values({ email, passwordHash: hashPassword(password), role: "superadmin" })
      .returning({ id: users.id, email: users.email });
    return user;
  });
}

export type UserResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

export async function createUser(
  actor: UserActor,
  input: {
    email: string;
    password: string;
    role: UserRole;
    canUseClaudeCode: boolean;
  },
): Promise<UserResult<ManagedUser>> {
  const [row] = await db
    .insert(users)
    .values({
      email: input.email,
      passwordHash: hashPassword(input.password),
      role: input.role,
      canUseClaudeCode: input.canUseClaudeCode,
    })
    .onConflictDoNothing({ target: users.email })
    .returning();
  if (!row) return { ok: false, status: 409, error: "Ya existe una cuenta con ese email" };
  await recordAdminAction(actor, row, "user.create", { role: row.role });
  return { ok: true, value: toManaged(row) };
}

async function otherActiveSuperadmins(tx: Pick<typeof db, "select">, userId: string): Promise<number> {
  const [row] = await tx
    .select({ total: count() })
    .from(users)
    .where(and(eq(users.role, "superadmin"), isNull(users.disabledAt), ne(users.id, userId)));
  return row.total;
}

export interface UserActor {
  id: string;
  email: string;
  role: UserRole;
}

/** Qué cambia de verdad, para el registro. Sin valores sensibles. */
function describeChanges(target: typeof users.$inferSelect, patch: UserPatch): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  if (patch.role && patch.role !== target.role) changes.role = { from: target.role, to: patch.role };
  if (patch.email && patch.email !== target.email) changes.email = { from: target.email, to: patch.email };
  if (patch.disabled !== undefined && patch.disabled !== (target.disabledAt !== null)) {
    changes.disabled = patch.disabled;
    if (patch.disabled && patch.disabledReason) changes.reason = patch.disabledReason;
  }
  if (patch.canUseClaudeCode !== undefined && patch.canUseClaudeCode !== target.canUseClaudeCode) {
    changes.claudeCode = patch.canUseClaudeCode;
  }
  if (patch.access) changes.access = true;
  if (patch.adminNote !== undefined && patch.adminNote !== target.adminNote) changes.note = true;
  if (patch.password) changes.password = true;
  return changes;
}

export async function updateUser(
  actor: UserActor,
  userId: string,
  patch: UserPatch,
): Promise<UserResult<ManagedUser>> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${USERS_LOCK})`);
    const [target] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!target) return { ok: false, status: 404, error: "Usuario no encontrado" };

    const blocked = manageError({
      actor,
      target: { id: target.id, role: target.role, disabled: target.disabledAt !== null },
      change: {
        role: patch.role,
        disabled: patch.disabled,
        // La nota y el correo se gestionan con las mismas reglas que los permisos.
        access:
          patch.access !== undefined ||
          patch.canUseClaudeCode !== undefined ||
          patch.adminNote !== undefined ||
          patch.email !== undefined,
      },
      otherActiveSuperadmins: await otherActiveSuperadmins(tx, userId),
    });
    if (blocked) return { ok: false, status: 409, error: blocked };

    if (patch.email && patch.email !== target.email) {
      const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, patch.email)).limit(1);
      if (taken) return { ok: false, status: 409, error: "Ya existe una cuenta con ese email" };
    }

    const [row] = await tx
      .update(users)
      .set({
        ...(patch.role ? { role: patch.role } : {}),
        ...(patch.disabled === undefined
          ? {}
          : {
              disabledAt: patch.disabled ? (target.disabledAt ?? new Date()) : null,
              disabledReason: patch.disabled ? (patch.disabledReason ?? target.disabledReason) : null,
            }),
        ...(patch.email ? { email: patch.email } : {}),
        ...(patch.adminNote === undefined ? {} : { adminNote: patch.adminNote }),
        ...(patch.canUseClaudeCode === undefined ? {} : { canUseClaudeCode: patch.canUseClaudeCode }),
        ...(patch.access ? { access: patch.access } : {}),
        ...(patch.password ? { passwordHash: hashPassword(patch.password) } : {}),
      })
      .where(eq(users.id, userId))
      .returning();

    // Desactivar o cambiar la contraseña expulsa a quien tuviera la sesión abierta.
    if (patch.disabled === true || patch.password) {
      await tx.delete(sessions).where(eq(sessions.userId, userId));
    }
    const changes = describeChanges(target, patch);
    if (Object.keys(changes).length > 0) await recordAdminAction(actor, row, "user.update", changes, tx);
    const usage = (await usageByUser(new Date(), userId)).get(userId);
    return { ok: true, value: toManaged(row, usage, (await sessionStatsByUser(userId)).get(userId)) };
  });
}

/** Cierra una sesión concreta de la cuenta o, sin `sessionId`, todas. */
export async function revokeSessions(
  actor: UserActor,
  userId: string,
  sessionId: string | null,
): Promise<UserResult<{ revoked: number }>> {
  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) return { ok: false, status: 404, error: "Usuario no encontrado" };
  const blocked = manageError({
    actor,
    target: { id: target.id, role: target.role, disabled: target.disabledAt !== null },
    change: { access: true },
    otherActiveSuperadmins: 1, // Cerrar sesiones no retira a nadie su rol.
  });
  if (blocked) return { ok: false, status: 409, error: blocked };

  const deleted = await db
    .delete(sessions)
    .where(
      sessionId
        ? and(eq(sessions.userId, userId), sql`left(${sessions.tokenHash}, 16) = ${sessionId}`)
        : eq(sessions.userId, userId),
    )
    .returning({ tokenHash: sessions.tokenHash });
  if (deleted.length > 0) {
    await recordAdminAction(actor, target, "user.sessions_revoked", { count: deleted.length, all: sessionId === null });
  }
  return { ok: true, value: { revoked: deleted.length } };
}

export async function deleteUser(actor: UserActor, userId: string): Promise<UserResult<null>> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${USERS_LOCK})`);
    const [target] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!target) return { ok: false, status: 404, error: "Usuario no encontrado" };

    const blocked = manageError({
      actor,
      target: { id: target.id, role: target.role, disabled: target.disabledAt !== null },
      change: { delete: true },
      otherActiveSuperadmins: await otherActiveSuperadmins(tx, userId),
    });
    if (blocked) return { ok: false, status: 409, error: blocked };

    // Antes de borrar: el registro conserva el correo aunque la cuenta desaparezca.
    await recordAdminAction(actor, target, "user.delete", { role: target.role }, tx);
    await tx.delete(users).where(eq(users.id, userId));
    return { ok: true, value: null };
  });
}

/** Permisos vigentes de una cuenta, leídos en cada run por si han cambiado. */
export async function getUserAccess(userId: string) {
  const [row] = await db
    .select({
      role: users.role,
      disabledAt: users.disabledAt,
      canUseClaudeCode: users.canUseClaudeCode,
      access: users.access,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;
  return {
    role: row.role,
    access: parseAccess(row.access),
    disabled: row.disabledAt !== null,
    canUseClaudeCode: row.canUseClaudeCode,
  };
}
