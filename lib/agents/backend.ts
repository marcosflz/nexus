import type { AgUiEvent } from "@/lib/agui/events";
import type { AgentSpec } from "@/lib/agents/spec";
import type { TokenUsage } from "@/lib/agents/usage";
import type { OpenUiProfile } from "@/lib/openui/profiles";
import type { RunInitiator } from "@/lib/runs/types";
import type { SourceItem } from "@/lib/sources";

/**
 * Contrato entre el BFF y el motor de agentes (el sidecar nas-adk).
 *
 * El backend recibe lo que necesita para un turno y emite eventos AG-UI; no
 * toca la base de datos ni conoce HTTP. Las pruebas lo sustituyen por uno falso.
 */

/** Documento adjunto, ya extraído a texto. */
export interface PromptAttachment {
  name: string;
  text: string;
}

export interface BackendCredential {
  provider: string;
  model: string;
  apiKey: string | null;
  baseUrl: string | null;
}

export interface RunLimits {
  /** Pasos máximos del agente (Research sube este límite). */
  maxTurns?: number;
}

/** Mensaje previo del hilo, en texto, para motores sin sesión propia. */
export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/** Respuesta de una persona a una llamada pausada (formulario, aprobación). */
export interface ResumeItem {
  callId: string;
  status: "resolved" | "approved" | "denied";
  payload?: unknown;
  reason?: string;
}

/** Conector MCP ya resuelto (secretos descifrados) para un run. */
export interface ConnectorLink {
  id: string;
  name: string;
  url: string;
  transport: "streamable-http" | "sse";
  headers: Record<string, string>;
  allowTools?: string[];
}

export interface BackendRunInput {
  runId: string;
  threadId: string;
  userId: string;
  initiator: RunInitiator;
  credential: BackendCredential;
  userText: string;
  attachments?: PromptAttachment[];
  focus?: string | null;
  mode?: string | null;
  /** Incluir la librería de UI generativa. Lo decide `openuiToolsEnabled()`. */
  openui?: boolean;
  /** Subconjunto de componentes OpenUI a anunciar (ver `profileFor`). */
  openuiProfile?: OpenUiProfile;
  /** El usuario ha pedido expresamente una respuesta con interfaz (interruptor «UI»). */
  openuiRequested?: boolean;
  limits?: RunLimits;
  /** Agente que atiende el turno. Sin él, el integrado de Nexus. */
  agent?: { id: string | null; versionId: string | null; spec: AgentSpec };
  history?: HistoryMessage[];
  /** Reanudación de un run en pausa: sesión guardada + respuestas de la persona. */
  checkpoint?: unknown[] | null;
  resume?: ResumeItem[];
  connectors?: ConnectorLink[];
}

export interface BackendInterrupt {
  id: string;
  reason: string;
  message?: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  payload?: Record<string, unknown>;
}

export interface BackendRunResult {
  /** `interrupt` deja el run en pausa (`awaiting_input`) hasta un `resume`. */
  outcome: "success" | "interrupt";
  interrupts?: BackendInterrupt[];
  usage?: TokenUsage;
  /** Texto final del asistente, tal y como lo devuelve el motor. */
  finalText: string;
  sources: SourceItem[];
  /** Preguntas de seguimiento propuestas por el agente. */
  followups?: string[];
  /** Sesión del motor para reanudar un run pausado (solo con `outcome: "interrupt"`). */
  checkpoint?: unknown[];
}

export type EmitEvent = (event: AgUiEvent) => void;

export interface AgentBackend {
  id: "nas-adk";
  /**
   * Ejecuta un turno. Emite eventos de contenido (texto, herramientas, `CUSTOM`);
   * el ejecutor añade el ciclo de vida del run y guarda lo que se vio en streaming.
   * Debe lanzar si `signal` se aborta o el motor falla.
   */
  run(input: BackendRunInput, emit: EmitEvent, signal: AbortSignal): Promise<BackendRunResult>;
}
