export interface ThreadSummary {
  id: string;
  title: string;
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
  args?: unknown;
}

/** Subagente delegado por el agente principal. */
export interface UiSubagent {
  id: string;
  name: string;
  description?: string;
  parentToolCallId?: string;
  status: "running" | "complete" | "error";
}

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
  /** Run que produjo el mensaje. Permite reanudar/reconciliar al recargar. */
  runId?: string;
  subagents?: UiSubagent[];
  interrupts?: UiInterrupt[];
}
