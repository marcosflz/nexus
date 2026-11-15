import { z } from "zod";
import { OPENUI_PROFILES } from "@/lib/openui/profiles";

/** Resolved harness configuration, pinned in a run snapshot and Nexbot versions.
 * Skills are independent packages and never carry model credentials or tool grants.
 */
export const BUILTIN_TOOL_IDS = [
  "web_search",
  "web_fetch",
  "present_openui",
  "prompt_openui",
  "suggest_followups",
] as const;

export const runtimeSpecSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  name: z.string().trim().min(1).max(80),
  role: z.string().trim().max(200).default(""),
  instructions: z.string().max(8000).default(""),
  /** Emoji o iniciales para el avatar. */
  avatar: z.string().max(8).default(""),
  /** Sugerencias de arranque que se muestran en un hilo nuevo. */
  starters: z.array(z.string().trim().min(1).max(200)).max(6).default([]),
  /** Único motor. Las versiones antiguas guardadas con "hermes" se leen como nas-adk. */
  backend: z.literal("nas-adk").default("nas-adk").catch("nas-adk"),
  /** Si falta, se usa el proveedor y modelo de la credencial del usuario. */
  model: z
    .object({
      provider: z.string().max(60).optional(),
      model: z.string().max(200).optional(),
    })
    .prefault({}),
  tools: z.array(z.string().max(60)).max(40).default([...BUILTIN_TOOL_IDS]),
  connectors: z
    .array(
      z.object({
        connectorId: z.string().uuid(),
        allowTools: z.array(z.string().max(120)).max(100).optional(),
      }),
    )
    .max(10)
    .default([]),
  knowledge: z
    .object({
      enabled: z.boolean().default(false),
      topK: z.number().int().min(1).max(12).default(6),
    })
    .prefault({}),
  memory: z
    .object({
      enabled: z.boolean().default(false),
      scope: z.enum(["bot", "user", "agent"]).default("bot").transform((scope) => scope === "agent" ? "bot" : scope),
    })
    .prefault({}),
  ui: z
    .object({
      openui: z.enum(["off", "auto", "always"]).default("auto"),
      profiles: z.array(z.enum(OPENUI_PROFILES)).min(1).default(["minimal"]),
    })
    .prefault({}),
  followups: z.boolean().default(true),
  computer: z.object({ enabled: z.boolean().default(false) }).prefault({}),
  /** 0 = sin límite. */
  budgets: z
    .object({
      maxRunsPerDay: z.number().int().min(0).max(10_000).default(0),
      maxTokensPerRun: z.number().int().min(0).max(5_000_000).default(0),
      maxTokensPerDay: z.number().int().min(0).max(100_000_000).default(0),
      maxToolCalls: z.number().int().min(0).max(500).default(0),
    })
    .prefault({}),
  policy: z
    .object({
      allowHosts: z.array(z.string().max(253)).max(100).default([]),
      askTools: z.array(z.string().max(120)).max(100).default([]),
      allowTools: z.array(z.string().max(120)).max(100).default([]),
    })
    .prefault({}),
});

export type RuntimeSpec = z.infer<typeof runtimeSpecSchema>;
export type RuntimeSpecInput = z.input<typeof runtimeSpecSchema>;

/** Agente integrado que atiende el chat cuando no hay un agente elegido. */
export function defaultRuntimeSpec(overrides: Partial<RuntimeSpecInput> = {}): RuntimeSpec {
  return runtimeSpecSchema.parse({ name: "Nexus", ...overrides });
}

/** Lo que el sidecar necesita de un agente (ver `services/agent/nexus_agent/contract.py`). */
export function toSidecarRuntime(spec: RuntimeSpec) {
  return {
    name: spec.name,
    role: spec.role,
    instructions: spec.instructions,
    tools: spec.tools,
    ui: { openui: spec.ui.openui, profiles: spec.ui.profiles },
    followups: spec.followups,
    knowledgeEnabled: spec.knowledge.enabled,
    knowledgeTopK: spec.knowledge.topK,
    memoryEnabled: spec.memory.enabled,
  };
}

/** JSON Schema del spec; el sidecar y el builder de la UI lo usan como contrato. */
export function runtimeSpecJsonSchema() {
  return z.toJSONSchema(runtimeSpecSchema, { io: "input" });
}

/** Identity belongs to Nexus or a Nexbot; these are its configurable harness settings. */
export const runtimeSettingsSchema = runtimeSpecSchema.omit({
  name: true, role: true, instructions: true, avatar: true, computer: true, backend: true,
});
export type RuntimeSettings = z.infer<typeof runtimeSettingsSchema>;

export function resolveRuntime(identity: { name: string; role?: string; instructions?: string; avatar?: string }, settings: unknown): RuntimeSpec {
  return runtimeSpecSchema.parse({ ...runtimeSettingsSchema.parse(settings ?? {}), ...identity });
}
