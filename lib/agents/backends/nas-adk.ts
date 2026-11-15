import { createHash } from "node:crypto";
import { readSse } from "@/lib/agui/client";
import type { AgUiEvent } from "@/lib/agui/events";
import { defaultAgentSpec, toSidecarAgent } from "@/lib/agents/spec";
import { openUiSpec } from "@/lib/openui/profiles";
import { focusInstruction, researchInstruction } from "@/lib/focus";
import { signRunToken, signSidecarRequest } from "@/lib/internal/token";
import type { TokenUsage } from "@/lib/agents/usage";
import type { AssistantSettings } from "@/lib/instance/assistant";
import type { SourceItem } from "@/lib/sources";
import type {
  AgentBackend,
  BackendInterrupt,
  BackendRunInput,
  BackendRunResult,
  EmitEvent,
} from "../backend";

export const NEXUS_RESULT = "nexus.result";

export interface NasAdkConfig {
  /** URL base del sidecar (red interna). */
  url: string;
  /** URL con la que el sidecar llama de vuelta al BFF. */
  internalUrl: string;
}

/** Configuración del sidecar, o null si no está configurado (motor desactivado). */
export function nasAdkConfig(env: Record<string, string | undefined> = process.env): NasAdkConfig | null {
  const url = env.NEXUS_AGENT_URL?.trim();
  if (!url || !env.NEXUS_AGENT_SECRET?.trim()) return null;
  return {
    url: url.replace(/\/$/, ""),
    internalUrl: (env.NEXUS_INTERNAL_URL?.trim() || "http://127.0.0.1:3000").replace(/\/$/, ""),
  };
}

/** Resultado que el sidecar envía como último evento `CUSTOM nexus.result`. */
interface SidecarResult {
  outcome: "success" | "interrupt" | "error";
  message?: string;
  finalText?: string;
  usage?: TokenUsage;
  sources?: SourceItem[];
  followups?: string[];
  interrupts?: BackendInterrupt[];
  checkpoint?: unknown[] | Record<string, unknown>;
}

export interface SidecarSearchConfig {
  providers: { id: string; apiKey: string | null; baseUrl: string | null }[];
  minResults: number;
}

export interface NasAdkDeps {
  fetch?: typeof fetch;
  config?: NasAdkConfig | null;
  now?: () => number;
  /** Motores de búsqueda de la instancia; `null`, el SearXNG del entorno del sidecar. */
  search?: () => Promise<SidecarSearchConfig | null>;
  /** Prompt y parámetros del modelo de la instancia; `null`, los del sidecar. */
  assistant?: () => Promise<AssistantSettings | null>;
}

async function instanceAssistant(): Promise<AssistantSettings | null> {
  const { assistantSettings } = await import("@/lib/instance/assistant");
  return assistantSettings();
}

/** Se importa aquí para que este módulo no arrastre la base de datos a sus pruebas. */
async function instanceSearch(): Promise<SidecarSearchConfig | null> {
  const { searchRuntime } = await import("@/lib/instance/search");
  return searchRuntime();
}

const MAX_HISTORY = 24;
const MAX_HISTORY_CHARS = 6000;

/**
 * Interfaz generativa para este turno. Si está activa (por foco, modo o a petición
 * del usuario) se manda la especificación del perfil: los modelos pequeños rara vez
 * llaman a `openui_spec` por su cuenta y, sin ella, nunca escriben la interfaz.
 */
function sidecarUi(input: BackendRunInput, openuiOff: boolean) {
  if (openuiOff || !input.openui) return null;
  const profile = input.openuiProfile ?? "minimal";
  return { requested: input.openuiRequested === true, profile, spec: openUiSpec(profile) };
}

/**
 * Contexto máximo por llamada al modelo. El de nas.adk por defecto (16k tokens)
 * se agota con dos páginas leídas y la especificación de OpenUI.
 */
export function contextTokens(
  env: Record<string, string | undefined> = process.env,
  configured: number | null = null,
): number {
  if (configured !== null) return configured;
  const value = Number(env.NEXUS_AGENT_CONTEXT_TOKENS);
  return Number.isInteger(value) && value >= 8000 ? Math.min(value, 1_000_000) : 64_000;
}

/** Mensaje comprensible para los errores de presupuesto del motor. */
export function friendlyAgentError(message: string): string {
  if (/context budget/i.test(message)) {
    return "La respuesta no cabía en el contexto del modelo (demasiadas páginas leídas). Prueba de nuevo o sube NEXUS_AGENT_CONTEXT_TOKENS.";
  }
  if (/model-call budget|turn budget/i.test(message)) {
    return "El agente agotó los pasos permitidos para este turno.";
  }
  if (/token budget/i.test(message)) return "El agente agotó el presupuesto de tokens de este turno.";
  if (/deadline exceeded/i.test(message)) return "El agente tardó demasiado y se detuvo.";
  return message;
}

/** El tope más estricto entre el del agente (0 = sin límite) y lo que le queda a la cuenta. */
function tokenCap(agentLimit: number, remaining: number | null | undefined): number | null {
  const caps = [agentLimit || null, remaining ?? null].filter((cap): cap is number => cap !== null);
  return caps.length > 0 ? Math.min(...caps) : null;
}

/** Instrucciones del foco (académico, Reddit…) y del modo Research para este turno. */
export function turnInstructions(input: Pick<BackendRunInput, "focus" | "mode">): string | null {
  const blocks: string[] = [];
  if (input.mode === "research") blocks.push(researchInstruction());
  const focus = input.focus ? focusInstruction(input.focus) : null;
  if (focus) blocks.push(focus);
  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

/** Cuerpo de `POST /v1/runs` (ver `services/agent/nexus_agent/contract.py`). */
export function buildSidecarRequest(
  input: BackendRunInput,
  config: NasAdkConfig,
  runToken: string,
  search: SidecarSearchConfig | null = null,
  assistant: AssistantSettings | null = null,
) {
  const spec = input.agent?.spec ?? defaultAgentSpec();
  const maxTurns = input.limits?.maxTurns ?? assistant?.limits.maxTurns ?? 24;
  const ui = sidecarUi(input, spec.ui.openui === "off");
  return {
    runId: input.runId,
    threadId: input.threadId,
    userId: input.userId,
    initiator: input.initiator,
    agent: toSidecarAgent(spec),
    model: {
      provider: input.credential.provider,
      model: input.credential.model,
      apiKey: input.credential.apiKey,
      baseUrl: input.credential.baseUrl,
      timeoutS: input.credential.timeoutS,
      maxConcurrency: input.credential.maxConcurrency,
    },
    history: (input.history ?? [])
      .slice(-MAX_HISTORY)
      .map((message) => ({ role: message.role, content: message.content.slice(0, MAX_HISTORY_CHARS) })),
    userText: input.resume?.length ? null : input.userText,
    attachments: input.attachments ?? [],
    focus: input.focus ?? null,
    mode: input.mode ?? null,
    turnInstructions: turnInstructions(input),
    checkpoint: input.checkpoint ?? null,
    skills: input.skillRefs ?? [],
    explicitSkills: input.explicitSkills ?? [],
    skillScripts: input.skillScripts === true,
    skillCreator: Boolean(input.creatorDraftId),
    resume: input.resume ?? null,
    connectors: input.connectors ?? [],
    search,
    computer: input.computer === true,
    room: input.room ?? null,
    ui,
    prompts: assistant?.prompts ?? null,
    generation: assistant?.generation ?? null,
    limits: {
      maxTurns,
      maxModelCalls: Math.max(40, maxTurns * 2),
      timeoutS: 600,
      maxTotalTokens: tokenCap(spec.budgets.maxTokensPerRun, input.credential.remainingTokens),
      // Sin la especificación en las instrucciones, `openui_spec` la devuelve como
      // resultado de herramienta y tiene que caber entera (~33k caracteres).
      maxToolResultChars: spec.ui.openui === "off" || ui ? 16_000 : 40_000,
      maxContextTokens: contextTokens(process.env, assistant?.limits.contextTokens ?? null),
    },
    bff: { baseUrl: config.internalUrl, runToken },
  };
}

export interface ClaudeCodeCapability {
  /** Listo para usarse con la cuenta consultada. */
  available: boolean;
  reason: string | null;
  /** El CLI del sidecar está instalado y es compatible (independiente de la cuenta). */
  cliReady: boolean;
}

export interface SidecarCapabilities {
  claudeCode: ClaudeCodeCapability;
}

const CAPABILITIES_TTL_MS = 30_000;
const CAPABILITIES_MAX_ENTRIES = 200;
// Una entrada por cuenta (hash del token, nunca el token en claro) y otra sin cuenta.
const capabilitiesCache = new Map<string, { value: SidecarCapabilities; expires: number }>();

function capabilitiesKey(token: string | null): string {
  return token ? createHash("sha256").update(token).digest("hex") : "";
}

/** Olvida el estado cacheado (de una cuenta, o de todas sin argumento). */
export function resetSidecarCapabilities(claudeCodeToken?: string | null): void {
  if (claudeCodeToken === undefined) capabilitiesCache.clear();
  else capabilitiesCache.delete(capabilitiesKey(claudeCodeToken));
}

/**
 * Lo que depende del contenedor del sidecar. `claudeCodeToken` es el de la cuenta de
 * Anthropic que ha vinculado el usuario; sin él solo se comprueba el CLI. Si no responde,
 * nada está disponible.
 */
export async function sidecarCapabilities(
  deps: NasAdkDeps = {},
  claudeCodeToken: string | null = null,
): Promise<SidecarCapabilities> {
  const now = deps.now?.() ?? Date.now();
  const key = capabilitiesKey(claudeCodeToken);
  const hit = capabilitiesCache.get(key);
  if (!deps.fetch && hit && now < hit.expires) return hit.value;

  const config = deps.config === undefined ? nasAdkConfig() : deps.config;
  const down = (reason: string): SidecarCapabilities => ({
    claudeCode: { available: false, reason, cliReady: false },
  });
  if (!config) return down("El motor de agentes no está configurado.");

  try {
    const body = JSON.stringify({ claudeCodeToken });
    const response = await (deps.fetch ?? fetch)(`${config.url}/v1/capabilities`, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json", ...signSidecarRequest(body, { now }) },
      // Puede arrancar el CLI varias veces si la caché del sidecar ha caducado.
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!response.ok) return down(`El motor de agentes respondió ${response.status}.`);
    const value = (await response.json()) as SidecarCapabilities;
    if (!deps.fetch) {
      for (const [k, entry] of capabilitiesCache) if (now >= entry.expires) capabilitiesCache.delete(k);
      if (capabilitiesCache.size >= CAPABILITIES_MAX_ENTRIES) capabilitiesCache.clear();
      capabilitiesCache.set(key, { value, expires: now + CAPABILITIES_TTL_MS });
    }
    return value;
  } catch {
    return down("El motor de agentes no responde.");
  }
}

/**
 * POST firmado a un endpoint del sidecar. Devuelve el estado y el JSON, o un error legible
 * si el sidecar no está configurado o no responde.
 */
export async function sidecarPost<T>(
  path: string,
  payload: unknown,
  options: { timeoutMs?: number; deps?: NasAdkDeps } = {},
): Promise<{ status: number; data: T | { error?: string } }> {
  const deps = options.deps ?? {};
  const config = deps.config === undefined ? nasAdkConfig() : deps.config;
  if (!config) return { status: 503, data: { error: "El motor de agentes no está configurado." } };
  const body = JSON.stringify(payload);
  try {
    const response = await (deps.fetch ?? fetch)(`${config.url}${path}`, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json", ...signSidecarRequest(body, { now: deps.now?.() }) },
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as T | { error?: string };
    return { status: response.status, data };
  } catch {
    return { status: 503, data: { error: "El motor de agentes no responde." } };
  }
}

export function createNasAdkBackend(deps: NasAdkDeps = {}): AgentBackend {
  return {
    id: "nas-adk",

    async run(input: BackendRunInput, emit: EmitEvent, signal: AbortSignal): Promise<BackendRunResult> {
      const config = deps.config === undefined ? nasAdkConfig() : deps.config;
      if (!config) {
        throw new Error("El motor nas-adk no está configurado (NEXUS_AGENT_URL / NEXUS_AGENT_SECRET)");
      }
      const doFetch = deps.fetch ?? fetch;
      const now = deps.now?.() ?? Date.now();

      const runToken = signRunToken(
        { runId: input.runId, userId: input.userId, agentId: input.agent?.id ?? null },
        { now },
      );
      const search = await (deps.search ?? (deps.fetch ? async () => null : instanceSearch))();
      const assistant = await (deps.assistant ?? (deps.fetch ? async () => null : instanceAssistant))().catch(
        () => null,
      );
      const body = JSON.stringify(buildSidecarRequest(input, config, runToken, search, assistant));

      const response = await doFetch(`${config.url}/v1/runs`, {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json", ...signSidecarRequest(body, { now }) },
        signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`El motor de agentes respondió ${response.status}`);
      }

      let result: SidecarResult | null = null;
      for await (const frame of readSse(response.body)) {
        const event = frame.event as AgUiEvent & { name?: string; value?: unknown };
        if (event.type === "CUSTOM" && event.name === NEXUS_RESULT) {
          result = event.value as SidecarResult;
          continue;
        }
        emit(frame.event);
      }

      if (!result) throw new Error("El motor de agentes terminó sin devolver un resultado");
      if (result.outcome === "error") {
        throw new Error(friendlyAgentError(result.message || "Error del motor de agentes"));
      }

      const base = {
        usage: result.usage,
        sources: result.sources ?? [],
        followups: result.followups ?? [],
      };
      if (result.outcome === "interrupt") {
        return {
          ...base,
          outcome: "interrupt",
          interrupts: result.interrupts ?? [],
          checkpoint: result.checkpoint ?? [],
          finalText: "",
        };
      }
      return {
        ...base,
        outcome: "success",
        finalText: result.finalText ?? "",
      };
    },
  };
}

export const nasAdkBackend = createNasAdkBackend();
