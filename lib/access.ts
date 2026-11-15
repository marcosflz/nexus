import { z } from "zod";

/**
 * Control de acceso por cuenta. Solo funciones puras y tipos: lo usan tanto el
 * servidor (donde se aplica de verdad) como la interfaz (para no ofrecer lo que
 * luego se rechazaría).
 */
export type UserRole = "superadmin" | "admin" | "user";

export const PERMISSIONS = [
  { id: "research", label: "Modo Research", description: "Informes a fondo, que consumen muchos más tokens." },
  { id: "generativeUi", label: "Interfaz generativa", description: "Tablas, gráficos y formularios en las respuestas." },
  { id: "attachments", label: "Adjuntar archivos", description: "Subir documentos al chat." },
  { id: "share", label: "Compartir conversaciones", description: "Crear enlaces públicos." },
  { id: "skills", label: "Skills", description: "Importar, crear y usar skills reutilizables." },
  { id: "routines", label: "Rutinas", description: "Disparadores y ejecuciones sin nadie delante." },
  { id: "connectors", label: "Conectores", description: "Añadir y usar servidores MCP." },
  { id: "computer", label: "Ordenador", description: "Usar entornos aislados, navegador y scripts de skills." },
  { id: "bots", label: "NexBots", description: "Crear y ejecutar bots con su propio entorno." },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["id"];

const PERMISSION_IDS = PERMISSIONS.map((item) => item.id) as [Permission, ...Permission[]];

export const accessSchema = z.object({
  /** Solo se guardan las excepciones: lo que no aparece está permitido. */
  permissions: z.partialRecord(z.enum(PERMISSION_IDS), z.boolean()).default({}),
  /**
   * `null`: cualquier modelo. Si no, por proveedor: `"*"` todos los suyos o una
   * lista concreta. Un proveedor que no aparece está bloqueado.
   */
  modelAccess: z
    .record(
      z.string().max(60),
      z.union([z.literal("*"), z.array(z.string().trim().min(1).max(200)).min(1).max(100)]),
    )
    .nullable()
    .default(null),
  /** Tokens por mes natural (UTC). `null`: sin límite. */
  monthlyTokenLimit: z.number().int().min(0).max(1_000_000_000_000).nullable().default(null),
});

export type UserAccess = z.infer<typeof accessSchema>;

/** Sin nada que limitar por defecto. */
export const OPEN_ACCESS: UserAccess = { permissions: {}, modelAccess: null, monthlyTokenLimit: null };

const CLOSED_ACCESS: UserAccess = {
  permissions: Object.fromEntries(PERMISSION_IDS.map((id) => [id, false])),
  modelAccess: {},
  monthlyTokenLimit: 0,
};

/** Lee el valor guardado. Si estuviera corrupto, la cuenta no recibe más acceso del debido. */
export function parseAccess(raw: unknown): UserAccess {
  const parsed = accessSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : CLOSED_ACCESS;
}

export interface AccessSubject {
  role: UserRole;
  access: UserAccess;
}

export const isAdminRole = (role: UserRole) => role === "admin" || role === "superadmin";

/** Un superadmin no tiene restricciones; el resto, las que le hayan puesto. */
export function hasPermission(subject: AccessSubject, permission: Permission): boolean {
  return subject.role === "superadmin" || subject.access.permissions[permission] !== false;
}

export function resolvePermissions(subject: AccessSubject): Record<Permission, boolean> {
  return Object.fromEntries(PERMISSION_IDS.map((id) => [id, hasPermission(subject, id)])) as Record<Permission, boolean>;
}

export function mayUseClaudeCode(subject: { role: UserRole; canUseClaudeCode: boolean }): boolean {
  return subject.role === "superadmin" || subject.canUseClaudeCode;
}

export function providerAllowed(subject: AccessSubject, provider: string): boolean {
  if (subject.role === "superadmin" || subject.access.modelAccess === null) return true;
  return subject.access.modelAccess[provider] !== undefined;
}

export function modelAllowed(subject: AccessSubject, provider: string, model: string): boolean {
  if (subject.role === "superadmin" || subject.access.modelAccess === null) return true;
  const rule = subject.access.modelAccess[provider];
  if (rule === undefined) return false;
  return rule === "*" || rule.includes(model);
}

/** Lista cerrada de modelos del proveedor, o null si no hay lista. */
export function allowedModelList(subject: AccessSubject, provider: string): string[] | null {
  if (subject.role === "superadmin" || subject.access.modelAccess === null) return null;
  const rule = subject.access.modelAccess[provider];
  return Array.isArray(rule) ? rule : null;
}

/** Tokens que le quedan este mes (0 si los agotó), o null si no tiene límite o no le aplica. */
export function remainingTokens(subject: AccessSubject, used: number): number | null {
  const limit = subject.access.monthlyTokenLimit;
  if (subject.role === "superadmin" || limit === null) return null;
  return Math.max(limit - used, 0);
}

export function startOfUtcMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface ManageChange {
  role?: UserRole;
  disabled?: boolean;
  delete?: boolean;
  /** El cambio toca permisos, modelos o cupo. */
  access?: boolean;
}

/**
 * Por qué `actor` no puede hacer ese cambio sobre `target`, o null si puede.
 * Un admin solo gestiona cuentas normales; a los admins los gestiona un
 * superadmin, y siempre debe quedar al menos un superadmin activo.
 */
export function manageError(input: {
  actor: { id: string; role: UserRole };
  target: { id: string; role: UserRole; disabled: boolean };
  change: ManageChange;
  otherActiveSuperadmins: number;
}): string | null {
  const { actor, target, change, otherActiveSuperadmins } = input;
  const isSelf = actor.id === target.id;
  const isSuper = actor.role === "superadmin";

  if (!isSuper && !isAdminRole(actor.role)) return "Solo para administradores";
  if (!isSuper && !isSelf && target.role !== "user") return "Solo un superadmin puede gestionar a otros administradores";
  if (!isSuper && change.role && change.role !== "user") return "Solo un superadmin puede nombrar administradores";

  const changesRole = change.role !== undefined && change.role !== target.role;
  if (isSelf) {
    if (change.delete) return "No puedes borrar tu propia cuenta";
    if (changesRole || change.disabled === true) return "No puedes cambiar tu propio rol ni desactivarte";
    if (!isSuper && change.access) return "No puedes cambiar tus propios permisos";
  }

  const losesSuperadmin = change.delete === true || change.disabled === true || (changesRole && change.role !== "superadmin");
  if (losesSuperadmin && target.role === "superadmin" && !target.disabled && otherActiveSuperadmins === 0) {
    return "Debe quedar al menos un superadmin activo";
  }
  return null;
}
