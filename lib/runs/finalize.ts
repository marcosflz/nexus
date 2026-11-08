import type { PersistedPart, PersistedTool } from "@/lib/db/schema";
import type { AgUiState } from "@/lib/agui/reducer";
import type { UiToolCall } from "@/components/chat/types";
import { OPENUI_TOOL_NAME, splitOpenUiBlocks } from "@/lib/openui/blocks";
import { validateOpenUiProgram } from "@/lib/openui/validate";
import { stripFollowupsBlock } from "@/lib/sources";

/**
 * Convierte el texto final del asistente en prosa + entradas de tool.
 *
 * Los bloques OpenUI cerrados y válidos se guardan como tool parts para que el
 * renderer los pinte sin re-parsear nada al recargar. Un bloque inválido no se
 * descarta: se devuelve a la prosa como código, que es mejor que un hueco.
 */
export function splitOpenUiResult(text: string): { content: string; tools: PersistedTool[] } {
  const prose: string[] = [];
  const tools: PersistedTool[] = [];

  for (const segment of splitOpenUiBlocks(text)) {
    if (segment.type === "text") {
      prose.push(segment.text);
      continue;
    }
    if (!segment.closed) {
      prose.push(`\`\`\`openui\n${segment.program}\n\`\`\`\n`);
      continue;
    }
    const validation = validateOpenUiProgram(segment.program);
    if (validation.ok) {
      tools.push({
        id: `openui-${segment.index}`,
        name: OPENUI_TOOL_NAME,
        kind: "openui",
        input: { ui: segment.program },
        argsText: JSON.stringify({ ui: segment.program }),
        status: "complete",
      });
    } else {
      console.warn("[nexus] bloque OpenUI descartado:", validation.error);
      prose.push(`\`\`\`openui\n${segment.program}\n\`\`\`\n`);
    }
  }

  return { content: stripFollowupsBlock(prose.join("").replace(/\n{3,}/g, "\n\n")), tools };
}

export interface FinalizedMessage {
  content: string;
  tools: PersistedTool[];
  /** Orden real texto/herramientas, o null si no se puede garantizar. */
  parts: PersistedPart[] | null;
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

export type ContentSource = "final" | "stream";

/**
 * Compone lo que se guarda en `messages` al terminar un run.
 *
 * - `final` (Hermes): `content` y los bloques OpenUI salen de `finalText`, el
 *   texto final que devuelve el motor. `parts` se toma del reducer solo si el
 *   texto en streaming coincide con él; si no, queda a null.
 * - `stream` (nas-adk): el motor emite herramientas propias y su `finalText` es
 *   solo el último mensaje, así que se guarda exactamente lo que vio la persona.
 */
export function finalizeAssistantMessage(
  state: AgUiState,
  finalText: string,
  source: ContentSource = "final",
): FinalizedMessage {
  if (source === "stream") {
    return {
      content: state.message.content,
      tools: state.message.tools.map(persistedTool),
      parts: state.message.parts ?? null,
    };
  }

  const { content, tools: openuiTools } = splitOpenUiResult(finalText);
  const agentTools = state.toolCalls.map(persistedTool);

  let parts: PersistedPart[] | null = null;
  if (state.rawText === finalText && state.message.parts) {
    const validOpenUi = new Set(openuiTools.map((tool) => tool.id));
    parts = state.message.parts.map((part): PersistedPart => {
      if (part.type !== "tool" || !part.toolId.startsWith("openui-")) return part;
      if (validOpenUi.has(part.toolId)) return part;
      // Bloque inválido: vuelve a la prosa como código.
      const program = state.message.tools.find((tool) => tool.id === part.toolId);
      const source = String((program?.input as { ui?: string } | undefined)?.ui ?? "");
      return { type: "text", text: `\`\`\`openui\n${source}\n\`\`\`\n` };
    });
  }

  return { content, tools: [...agentTools, ...openuiTools], parts };
}
