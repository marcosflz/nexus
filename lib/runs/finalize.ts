import type { PersistedPart, PersistedTool } from "@/lib/db/schema";
import type { AgUiState } from "@/lib/agui/reducer";
import type { UiToolCall } from "@/components/chat/types";

export interface FinalizedMessage {
  content: string;
  tools: PersistedTool[];
  /** Orden real texto/herramientas, o null si no se puede garantizar. */
  parts: PersistedPart[] | null;
  reasoning: string | null;
}

function persistedTool(tool: UiToolCall): PersistedTool {
  return {
    id: tool.id,
    name: tool.name,
    kind: tool.kind,
    input: tool.input,
    argsText: tool.argsText,
    status: tool.status === "running" ? "complete" : tool.status,
    durationMs: tool.durationMs,
    ...(tool.result ? { result: tool.result } : {}),
  };
}

/**
 * Compone lo que se guarda en `messages` al terminar un run: exactamente lo que
 * vio la persona en streaming (texto, herramientas y su orden). El motor emite
 * la UI generativa como llamadas reales a herramienta, así que no hay nada que
 * re-parsear. Si no llegó texto en streaming, se usa el texto final del motor.
 */
export function finalizeAssistantMessage(state: AgUiState, finalText: string): FinalizedMessage {
  const streamed = state.message.content;
  if (!streamed.trim() && finalText.trim()) {
    return {
      content: finalText,
      tools: state.message.tools.map(persistedTool),
      parts: null,
      reasoning: state.message.reasoning || null,
    };
  }
  return {
    content: streamed,
    tools: state.message.tools.map(persistedTool),
    parts: state.message.parts ?? null,
    reasoning: state.message.reasoning || null,
  };
}
