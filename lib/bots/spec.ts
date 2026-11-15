import { z } from "zod";
import { runtimeSettingsSchema } from "@/lib/runtime/spec";

/** Márgenes de lo configurable; sandboxd vuelve a validarlos por su cuenta. */
export const BOT_LIMITS = {
  memoryMb: { min: 512, max: 4096 },
  cpus: { min: 0.25, max: 2 },
  diskMb: { min: 64, max: 20480 },
  taskTimeoutS: { min: 10, max: 7200 },
} as const;

const configFields = {
  network: z.enum(["restricted", "none"]),
  persistBrowser: z.boolean(),
  desktop: z.boolean(),
  memoryMb: z.number().int().min(BOT_LIMITS.memoryMb.min).max(BOT_LIMITS.memoryMb.max),
  cpus: z.number().min(BOT_LIMITS.cpus.min).max(BOT_LIMITS.cpus.max),
  diskMb: z.number().int().min(BOT_LIMITS.diskMb.min).max(BOT_LIMITS.diskMb.max),
  taskTimeoutS: z.number().int().min(BOT_LIMITS.taskTimeoutS.min).max(BOT_LIMITS.taskTimeoutS.max),
};

export const botConfigSchema = z.object({
  /** `restricted`: internet por el proxy, sin red privada. `none`: sin ninguna salida. */
  network: configFields.network.default("restricted"),
  /** Guardar cookies y localStorage en el volumen. Es una autorización explícita. */
  persistBrowser: configFields.persistBrowser.default(false),
  /** Escritorio virtual: permite ver lo que hace el bot. Consume algo más de memoria. */
  desktop: configFields.desktop.default(true),
  memoryMb: configFields.memoryMb.default(2048),
  cpus: configFields.cpus.default(1),
  diskMb: configFields.diskMb.default(2048),
  taskTimeoutS: configFields.taskTimeoutS.default(600),
});
export type BotConfig = z.infer<typeof botConfigSchema>;

const profileFields = {
  name: z.string().trim().min(1).max(60),
  avatar: z.string().trim().max(8),
  description: z.string().trim().max(500),
  instructions: z.string().trim().max(8000),
  role: z.string().trim().max(200),
  execution: runtimeSettingsSchema,
  environmentEnabled: z.boolean(),
  skillIds: z.array(z.string().uuid()).max(100),
};

export const botInputSchema = z.object({
  name: profileFields.name,
  avatar: profileFields.avatar.default(""),
  description: profileFields.description.default(""),
  instructions: profileFields.instructions.default(""),
  config: botConfigSchema.prefault({}),
  role: profileFields.role.default(""),
  execution: profileFields.execution.prefault({}),
  environmentEnabled: profileFields.environmentEnabled.default(false),
  skillIds: profileFields.skillIds.default([]),
});
export type BotInput = z.infer<typeof botInputSchema>;

/**
 * Sin valores por defecto: en zod 4 un `.default()` también se aplica dentro de un
 * campo opcional, y un cambio parcial reiniciaría lo que no se ha enviado.
 */
export const botPatchSchema = z
  .object({ ...profileFields, execution: z.record(z.string(), z.unknown()), config: z.object(configFields).partial() })
  .partial();
export type BotPatch = z.infer<typeof botPatchSchema>;

/** Forma general; el catálogo cerrado de pasos lo valida el runtime del bot. */
const stepSchema = z.object({ action: z.string().min(1).max(40) }).catchall(z.unknown());

export const planTaskSchema = z.object({
  kind: z.literal("plan"),
  steps: z.array(stepSchema).min(1).max(200),
  timeoutS: z.number().int().min(1).max(7200).optional(),
  trace: z.boolean().default(false),
});

export const agentTaskSchema = z.object({
  kind: z.literal("agent"),
  prompt: z.string().trim().min(1).max(20_000),
});

export const computerTaskSchema = z.object({
  kind: z.literal("computer"),
  prompt: z.string().trim().min(1).max(20_000),
  /** Cada paso envía una captura al modelo: es lo que más consume. */
  maxSteps: z.number().int().min(1).max(60).default(30),
});

export const botTaskSchema = z.discriminatedUnion("kind", [planTaskSchema, agentTaskSchema, computerTaskSchema]);
export type BotTaskInput = z.infer<typeof botTaskSchema>;

export const TERMINAL_TASK_STATUSES = new Set([
  "succeeded",
  "failed",
  "timeout",
  "cancelled",
  "denied",
  "interrupted",
]);
export const isTerminalTask = (status: string) => TERMINAL_TASK_STATUSES.has(status);

/** Quita los valores marcados como secretos antes de guardar nada en la base de datos. */
export function sanitizeSteps(steps: Record<string, unknown>[]): Record<string, unknown>[] {
  return steps.map((step) => {
    if (step.secret !== true) return step;
    return {
      ...step,
      ...("value" in step ? { value: "***" } : {}),
      ...("text" in step ? { text: "***" } : {}),
    };
  });
}

export function botSlug(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "bot";
}

/** Lo que devuelve sandboxd sobre el contenedor. */
export interface BotRuntimeReport {
  state: "running" | "stopped" | "absent";
  exitCode?: number | null;
  oomKilled?: boolean;
  restarts?: number;
  error?: string | null;
  runtime?: Record<string, unknown> | null;
  /** Configuración con la que se creó el contenedor. */
  options?: unknown;
}

/** Si lo guardado difiere de lo que tiene el contenedor. Sin dato, no se afirma que difiera. */
export function isConfigPending(saved: BotConfig, applied: unknown): boolean {
  const parsed = botConfigSchema.safeParse(applied);
  if (!parsed.success || applied === undefined || applied === null) return false;
  return (Object.keys(saved) as (keyof BotConfig)[]).some((key) => saved[key] !== parsed.data[key]);
}

/** Traduce el estado del contenedor al del bot. Un cierre anómalo es un error visible. */
export function statusFromReport(report: BotRuntimeReport): { status: "running" | "stopped" | "error"; error: string | null } {
  if (report.state === "running") return { status: "running", error: null };
  if (report.state === "absent") return { status: "stopped", error: null };
  if (report.oomKilled) return { status: "error", error: "El bot se quedó sin memoria y el sistema lo cerró" };
  if (report.error) return { status: "error", error: report.error };
  if (report.exitCode) return { status: "error", error: `El contenedor terminó con código ${report.exitCode}` };
  return { status: "stopped", error: null };
}

/** Estado equivalente de una tarea llevada por un run del motor de agentes. */
export function taskStatusFromRun(status: string): string {
  switch (status) {
    case "completed":
      return "succeeded";
    case "error":
      return "failed";
    case "awaiting_input":
      return "awaiting_approval";
    default:
      return status;
  }
}
