import { randomBytes } from "node:crypto";
import { and, asc, count, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/crypto";

export type UserRole = "admin" | "user";

/** Lo que un admin ve de una cuenta (nunca el hash de la contraseña). */
export interface ManagedUser {
  id: string;
  email: string;
  role: UserRole;
  disabled: boolean;
  canUseClaudeCode: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface UserPatch {
  role?: UserRole;
  disabled?: boolean;
  canUseClaudeCode?: boolean;
  /** Contraseña nueva: cierra todas las sesiones de la cuenta. */
  password?: string;
}

/** Bloqueo para operaciones que dependen de cuántas cuentas o admins hay. */
const USERS_LOCK = 7_316_001;

export function generatePassword(): string {
  return randomBytes(12).toString("base64url");
}

/**
 * Por qué no se permite un cambio sobre una cuenta, o null si se permite. Evita
 * que la instancia se quede sin nadie que pueda administrarla.
 */
export function adminChangeError(input: {
  actorId: string;
  target: { id: string; role: UserRole; disabled: boolean };
  change: { role?: UserRole; disabled?: boolean; delete?: boolean };
  otherActiveAdmins: number;
}): string | null {
  const { actorId, target, change, otherActiveAdmins } = input;
  const losesAdmin = change.role === "user" || change.disabled === true || change.delete === true;
  if (!losesAdmin) return null;
  if (target.id === actorId) {
    return change.delete ? "No puedes borrar tu propia cuenta" : "No puedes quitarte el acceso de administrador a ti mismo";
  }
  if (target.role === "admin" && !target.disabled && otherActiveAdmins === 0) {
    return "Debe quedar al menos un administrador activo";
  }
  return null;
}

function toManaged(row: typeof users.$inferSelect): ManagedUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    disabled: row.disabledAt !== null,
    canUseClaudeCode: row.canUseClaudeCode,
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  };
}

export async function listUsers(): Promise<ManagedUser[]> {
  const rows = await db.select().from(users).orderBy(asc(users.createdAt));
  return rows.map(toManaged);
}

/** El registro solo está abierto para crear la primera cuenta de la instancia. */
export async function registrationOpen(): Promise<boolean> {
  const [row] = await db.select({ total: count() }).from(users);
  return row.total === 0;
}

/** Crea la primera cuenta como admin; null si ya existe alguna. */
export async function createFirstAdmin(email: string, password: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${USERS_LOCK})`);
    const [existing] = await tx.select({ total: count() }).from(users);
    if (existing.total > 0) return null;
    const [user] = await tx
      .insert(users)
      .values({ email, passwordHash: hashPassword(password), role: "admin" })
      .returning({ id: users.id, email: users.email });
    return user;
  });
}

export type UserResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

export async function createUser(input: {
  email: string;
  password: string;
  role: UserRole;
  canUseClaudeCode: boolean;
}): Promise<UserResult<ManagedUser>> {
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
  return { ok: true, value: toManaged(row) };
}

async function otherActiveAdmins(tx: Pick<typeof db, "select">, userId: string): Promise<number> {
  const [row] = await tx
    .select({ total: count() })
    .from(users)
    .where(and(eq(users.role, "admin"), isNull(users.disabledAt), ne(users.id, userId)));
  return row.total;
}

export async function updateUser(
  actorId: string,
  userId: string,
  patch: UserPatch,
): Promise<UserResult<ManagedUser>> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${USERS_LOCK})`);
    const [target] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!target) return { ok: false, status: 404, error: "Usuario no encontrado" };

    const blocked = adminChangeError({
      actorId,
      target: { id: target.id, role: target.role, disabled: target.disabledAt !== null },
      change: patch,
      otherActiveAdmins: await otherActiveAdmins(tx, userId),
    });
    if (blocked) return { ok: false, status: 409, error: blocked };

    const [row] = await tx
      .update(users)
      .set({
        ...(patch.role ? { role: patch.role } : {}),
        ...(patch.disabled === undefined
          ? {}
          : { disabledAt: patch.disabled ? (target.disabledAt ?? new Date()) : null }),
        ...(patch.canUseClaudeCode === undefined ? {} : { canUseClaudeCode: patch.canUseClaudeCode }),
        ...(patch.password ? { passwordHash: hashPassword(patch.password) } : {}),
      })
      .where(eq(users.id, userId))
      .returning();

    // Desactivar o cambiar la contraseña expulsa a quien tuviera la sesión abierta.
    if (patch.disabled === true || patch.password) {
      await tx.delete(sessions).where(eq(sessions.userId, userId));
    }
    return { ok: true, value: toManaged(row) };
  });
}

export async function deleteUser(actorId: string, userId: string): Promise<UserResult<null>> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${USERS_LOCK})`);
    const [target] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!target) return { ok: false, status: 404, error: "Usuario no encontrado" };

    const blocked = adminChangeError({
      actorId,
      target: { id: target.id, role: target.role, disabled: target.disabledAt !== null },
      change: { delete: true },
      otherActiveAdmins: await otherActiveAdmins(tx, userId),
    });
    if (blocked) return { ok: false, status: 409, error: blocked };

    await tx.delete(users).where(eq(users.id, userId));
    return { ok: true, value: null };
  });
}

/** Permisos vigentes de una cuenta, leídos en cada run por si han cambiado. */
export async function getUserAccess(userId: string) {
  const [row] = await db
    .select({ role: users.role, disabledAt: users.disabledAt, canUseClaudeCode: users.canUseClaudeCode })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;
  return {
    disabled: row.disabledAt !== null,
    canUseClaudeCode: row.role === "admin" || row.canUseClaudeCode,
  };
}
