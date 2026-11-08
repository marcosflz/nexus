import { z } from "zod";
import { OPENUI_PROFILES } from "@/lib/openui/profiles";

/**
 * Especificación de un agente. Se guarda versionada e inmutable
 * (`agent_versions.spec`): un run fija la versión con la que arrancó, así que
 * una ejecución programada de hace un mes se puede reproducir tal cual.
 *
 * `schemaVersion` permite migrar specs antiguas sin romper las versiones ya
 * guardadas.
 */
export const AGENT_TOOL_IDS = [
  "web_search",
  "web_fetch",
  "present_openui",
  "prompt_openui",
  "suggest_followups",
] as const;

export const agentSpecSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  name: z.string().trim().min(1).max(80),
  role: z.string().trim().max(200).default(""),
  instructions: z.string().max(8000).default(""),
  /** Emoji o iniciales para el avatar. */
  avatar: z.string().max(8).default(""),
  /** Sugerencias de arranque que se muestran en un hilo nuevo. */
  starters: z.array(z.string().trim().min(1).max(200)).max(6).default([]),
  backend: z.enum(["hermes", "nas-adk"]).default("nas-adk"),
  /** Si falta, se usa el proveedor y modelo de la credencial del usuario. */
  model: z
    .object({
      provider: z.string().max(60).optional(),
      model: z.string().max(200).optional(),
    })
    .prefault({}),
  tools: z.array(z.string().max(60)).max(40).default([...AGENT_TOOL_IDS]),
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
      scope: z.enum(["agent", "user"]).default("agent"),
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

export type AgentSpec = z.infer<typeof agentSpecSchema>;
export type AgentSpecInput = z.input<typeof agentSpecSchema>;

/** Agente integrado que atiende el chat cuando no hay un agente elegido. */
export function defaultAgentSpec(overrides: Partial<AgentSpecInput> = {}): AgentSpec {
  return agentSpecSchema.parse({ name: "Nexus", ...overrides });
}

/** Lo que el sidecar necesita de un agente (ver `services/agent/nexus_agent/contract.py`). */
export function toSidecarAgent(spec: AgentSpec) {
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
export function agentSpecJsonSchema() {
  return z.toJSONSchema(agentSpecSchema, { io: "input" });
}
