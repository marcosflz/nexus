import { signSidecarRequest } from "@/lib/internal/token";
import { nasAdkConfig } from "./backends/nas-adk";
import { AGENT_TOOL_IDS, agentSpecSchema, type AgentSpec } from "./spec";
import type { BackendCredential } from "./backend";

const SYSTEM = `Eres un diseñador de agentes de IA. A partir de la descripción de una persona, redactas la
configuración de un agente. Responde SOLO con un objeto JSON (sin texto antes ni después, sin bloques de
código) con estos campos:

{
  "name": "nombre corto (máx. 80 caracteres)",
  "role": "una línea que resume su papel",
  "instructions": "instrucciones detalladas en segunda persona: objetivo, tono, formato de respuesta, qué hacer y qué no",
  "avatar": "un emoji",
  "starters": ["hasta 4 preguntas de ejemplo con las que empezar"],
  "tools": ["web_search", "web_fetch", "present_openui", "prompt_openui", "suggest_followups"],
  "followups": true
}

Reglas: usa solo las herramientas de esa lista y solo las que el agente necesite; escribe en el idioma de la
descripción; no inventes datos personales ni claves.`;

/** Primer objeto JSON del texto, tolerando bloques ```json y texto alrededor. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("La respuesta no contiene un objeto JSON");
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Un borrador generado por un modelo no debe activar capacidades por su cuenta:
 * se descartan conectores, ordenador y políticas, y se limitan las herramientas
 * a las conocidas. La persona los activa después, a conciencia.
 */
export function sanitizeDraft(spec: AgentSpec): AgentSpec {
  const known = new Set<string>(AGENT_TOOL_IDS);
  return agentSpecSchema.parse({
    ...spec,
    tools: spec.tools.filter((tool) => known.has(tool)),
    connectors: [],
    computer: { enabled: false },
    policy: { allowHosts: [], askTools: [], allowTools: [] },
    model: {},
    knowledge: { enabled: false, topK: 6 },
    memory: { enabled: false, scope: "agent" },
    budgets: {
      maxRunsPerDay: 0,
      maxTokensPerRun: spec.budgets.maxTokensPerRun,
      maxTokensPerDay: 0,
      maxToolCalls: 0,
    },
  });
}

export type DraftResult = { ok: true; spec: AgentSpec } | { ok: false; error: string };

export interface DraftDeps {
  fetch?: typeof fetch;
  now?: () => number;
}

export async function draftAgentSpec(
  description: string,
  credential: BackendCredential,
  deps: DraftDeps = {},
): Promise<DraftResult> {
  const config = nasAdkConfig();
  if (!config) return { ok: false, error: "El motor nas-adk no está configurado" };

  const body = JSON.stringify({
    model: {
      provider: credential.provider,
      model: credential.model,
      apiKey: credential.apiKey,
      baseUrl: credential.baseUrl,
    },
    system: SYSTEM,
    user: `Descripción del agente:\n${description.slice(0, 4000)}`,
    maxTokens: 1500,
    temperature: 0.4,
  });

  let text: string;
  try {
    const response = await (deps.fetch ?? fetch)(`${config.url}/v1/complete`, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json", ...signSidecarRequest(body, { now: deps.now?.() }) },
    });
    const data = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
    if (!response.ok) return { ok: false, error: data.error ?? `El motor respondió ${response.status}` };
    text = data.text ?? "";
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo contactar con el motor" };
  }

  try {
    const parsed = agentSpecSchema.safeParse(extractJson(text));
    if (!parsed.success) {
      return { ok: false, error: `El borrador no es válido: ${parsed.error.issues[0]?.message ?? "formato"}` };
    }
    return { ok: true, spec: sanitizeDraft(parsed.data) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo interpretar el borrador" };
  }
}
