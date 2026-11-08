export interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
  pinnedAt: string | null;
  projectId: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
}

/**
 * Una llamada a herramienta tal y como la ve la UI.
 *
 * `argsText` existe porque los argumentos pueden llegar (y llegarán, cuando
 * Hermes los emita en fragmentos) sin ser JSON válido todavía; los renderers
 * que pintan UI generativa necesitan el texto crudo además del objeto.
 */
export interface UiToolCall {
  id: string;
  name: string;
  input?: unknown;
  argsText?: string;
  /** `openui` = bloque de UI generativa extraído del texto del asistente. */
  kind?: "tool" | "openui";
  /** El programa OpenUI no pasó la validación del servidor. */
  invalid?: boolean;
  status: "running" | "complete" | "error";
  durationMs?: number;
  /** Resultado de la herramienta (acotado). Lo necesitan las de entrada humana. */
  result?: string;
}

export interface UiSource {
  id: number;
  url: string;
  title?: string;
  domain: string;
}

export interface UiAttachment {
  name: string;
  mime?: string;
  size?: number;
}

export interface PendingAttachment extends UiAttachment {
  text: string;
  truncated: boolean;
}

export interface UiUsage {
  input?: number;
  output?: number;
  total?: number;
  cache_read?: number;
  cache_write?: number;
}

/** Petición de decisión humana: aprobación de acción o aclaración del agente. */
export interface UiInterrupt {
  id: string;
  reason: string;
  message?: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  /** Datos extra del motor (p. ej. regla y motivo de una aprobación). */
  payload?: Record<string, unknown>;
}

/** Subagente delegado por el agente principal. */
export interface UiSubagent {
  id: string;
  name: string;
  description?: string;
  parentToolCallId?: string;
  status: "running" | "complete" | "error";
}

/**
 * Parte ordenada de un mensaje del asistente: o un tramo de texto o una
 * referencia a una herramienta de `UiMessage.tools` (incluidos los bloques
 * OpenUI, que son herramientas con `kind: "openui"`).
 */
export type UiPart = { type: "text"; text: string } | { type: "tool"; toolId: string };

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools: UiToolCall[];
  sources: UiSource[];
  attachments: UiAttachment[];
  usage?: UiUsage | null;
  status: "running" | "complete" | "error";
  error?: string;
  createdAt: string;
  /** Id del mensaje en la base de datos (el `id` local es la clave de React). */
  serverId?: string;
  /** Valoración del usuario a esta respuesta. */
  rating?: 1 | -1 | null;
  /** Run que produjo el mensaje. Permite reanudar/reconciliar al recargar. */
  runId?: string;
  /** Orden real de texto y herramientas. Ausente en mensajes anteriores a la v2. */
  parts?: UiPart[];
  /** Preguntas de seguimiento propuestas por el agente. */
  followups?: string[];
  subagents?: UiSubagent[];
  interrupts?: UiInterrupt[];
}
