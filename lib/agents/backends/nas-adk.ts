import { readSse } from "@/lib/agui/client";
import type { AgUiEvent } from "@/lib/agui/events";
import { defaultAgentSpec, toSidecarAgent } from "@/lib/agents/spec";
import { openUiSpec } from "@/lib/openui/profiles";
import { signRunToken, signSidecarRequest } from "@/lib/internal/token";
import type { HermesTokens } from "@/lib/hermes/events";
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
  usage?: HermesTokens;
  sources?: SourceItem[];
  followups?: string[];
  interrupts?: BackendInterrupt[];
  checkpoint?: unknown[];
}

export interface NasAdkDeps {
  fetch?: typeof fetch;
  config?: NasAdkConfig | null;
  now?: () => number;
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
export function contextTokens(env: Record<string, string | undefined> = process.env): number {
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

/** Cuerpo de `POST /v1/runs` (ver `services/agent/nexus_agent/contract.py`). */
export function buildSidecarRequest(input: BackendRunInput, config: NasAdkConfig, runToken: string) {
  const spec = input.agent?.spec ?? defaultAgentSpec();
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
    },
    history: (input.history ?? [])
      .slice(-MAX_HISTORY)
      .map((message) => ({ role: message.role, content: message.content.slice(0, MAX_HISTORY_CHARS) })),
    userText: input.resume?.length ? null : input.userText,
    attachments: input.attachments ?? [],
    focus: input.focus ?? null,
    mode: input.mode ?? null,
    checkpoint: input.checkpoint ?? null,
    resume: input.resume ?? null,
    connectors: input.connectors ?? [],
    ui,
    limits: {
      maxTurns: input.limits?.maxTurns ?? 24,
      maxModelCalls: Math.max(40, (input.limits?.maxTurns ?? 24) * 2),
      timeoutS: 600,
      maxTotalTokens: spec.budgets.maxTokensPerRun || null,
      // Sin la especificación en las instrucciones, `openui_spec` la devuelve como
      // resultado de herramienta y tiene que caber entera (~33k caracteres).
      maxToolResultChars: spec.ui.openui === "off" || ui ? 16_000 : 40_000,
      maxContextTokens: contextTokens(),
    },
    bff: { baseUrl: config.internalUrl, runToken },
  };
}

export function createNasAdkBackend(deps: NasAdkDeps = {}): AgentBackend {
  return {
    id: "nas-adk",
    capabilities: { appTools: true, toolArgStreaming: false, interrupts: true, preToolPolicy: true },

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
      const body = JSON.stringify(buildSidecarRequest(input, config, runToken));

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
        backendSessionId: null,
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
        contentSource: "stream",
      };
    },
  };
}

export const nasAdkBackend = createNasAdkBackend();
