import { eq } from "drizzle-orm";
import { z } from "zod";
import { nasAdkConfig } from "@/lib/agents/backends/nas-adk";
import { db } from "@/lib/db";
import { instanceSettings } from "@/lib/db/schema";
import { signSidecarRequest } from "@/lib/internal/token";
import { OPENUI_PROFILES } from "@/lib/openui/profiles";

/**
 * Comportamiento del asistente en toda la instancia: textos del prompt del sistema,
 * cuándo se ofrece la UI generativa y parámetros del modelo. Lo edita un superadmin.
 *
 * Los textos se guardan solo si se han cambiado (null = el texto por defecto del
 * sidecar, que es quien los conoce; ver `POST /v1/prompts`).
 */
const KEY = "assistant";

const promptText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .default(null)
    .transform((value) => (value && value.trim() ? value : null));

export const assistantSettingsSchema = z.object({
  prompts: z
    .object({
      core: promptText(20_000),
      ui: promptText(20_000),
      followups: promptText(4_000),
    })
    .prefault({}),
  ui: z
    .object({
      /** auto: el modelo decide en cada turno; request: solo con el botón «UI», el foco o Research. */
      mode: z.enum(["auto", "request"]).default("auto"),
      /** Componentes que se ofrecen en modo auto. Más componentes, más tokens de prompt. */
      profile: z.enum(OPENUI_PROFILES).default("data"),
    })
    .prefault({}),
  generation: z
    .object({
      temperature: z.number().min(0).max(2).nullable().default(null),
      maxTokens: z.number().int().min(256).max(128_000).nullable().default(null),
      reasoningEffort: z.enum(["low", "medium", "high"]).nullable().default(null),
    })
    .prefault({}),
  limits: z
    .object({
      maxTurns: z.number().int().min(4).max(80).default(24),
      researchMaxTurns: z.number().int().min(8).max(120).default(40),
      /** null = NEXUS_AGENT_CONTEXT_TOKENS (o 64k). */
      contextTokens: z.number().int().min(8000).max(1_000_000).nullable().default(null),
    })
    .prefault({}),
});

export type AssistantSettings = z.infer<typeof assistantSettingsSchema>;
export type AssistantPrompts = AssistantSettings["prompts"];

export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = assistantSettingsSchema.parse({});

/** Configuración guardada; si no hay o no es válida, la de por defecto. */
export async function assistantSettings(): Promise<AssistantSettings> {
  const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.key, KEY)).limit(1);
  const parsed = assistantSettingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : DEFAULT_ASSISTANT_SETTINGS;
}

export async function saveAssistantSettings(value: AssistantSettings, userId: string): Promise<void> {
  await db
    .insert(instanceSettings)
    .values({ key: KEY, value, updatedBy: userId })
    .onConflictDoUpdate({ target: instanceSettings.key, set: { value, updatedBy: userId, updatedAt: new Date() } });
}

export type DefaultPrompts = { [K in keyof AssistantPrompts]: string };

/** Textos por defecto del prompt, tal y como los usa el sidecar. null si no responde. */
export async function defaultPrompts(): Promise<DefaultPrompts | null> {
  const config = nasAdkConfig();
  if (!config) return null;
  const body = "{}";
  try {
    const response = await fetch(`${config.url}/v1/prompts`, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json", ...signSidecarRequest(body) },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as DefaultPrompts;
  } catch {
    return null;
  }
}
