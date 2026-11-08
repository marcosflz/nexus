import {
  EventType,
  LEGACY_SOURCES,
  NEXUS_FOLLOWUPS,
  NEXUS_SOURCES,
  type AgUiEvent,
  type NexusFollowupsPayload,
  type NexusSourcesPayload,
} from "./events";
import type {
  UiInterrupt,
  UiMessage,
  UiPart,
  UiSubagent,
  UiToolCall,
  UiUsage,
} from "@/components/chat/types";

/**
 * Estado de un turno mientras llega el stream de AG-UI.
 *
 * Es un reductor puro: no toca React, red ni base de datos, de modo que el
 * mismo código sirve para el streaming en vivo, para reconstruir un turno
 * desde `run_events` al recargar, y para los tests.
 */
export interface AgUiState {
  message: UiMessage;
  runId: string | null;
  threadId: string | null;
  interrupts: UiInterrupt[];
  /** Texto crudo del asistente tal y como llega en streaming. */
  rawText: string;
  /** Llamadas a herramientas emitidas por AG-UI. */
  toolCalls: UiToolCall[];
  /** Posición de `rawText` en la que arrancó cada herramienta (para ordenar `parts`). */
  toolOffsets: Record<string, number>;
}

export function initialAgUiState(
  messageId: string,
  createdAt: string = new Date().toISOString(),
): AgUiState {
  return {
    message: {
      id: messageId,
      role: "assistant",
      content: "",
      tools: [],
      sources: [],
      attachments: [],
      status: "running",
      createdAt,
    },
    runId: null,
    threadId: null,
    interrupts: [],
    rawText: "",
    toolCalls: [],
    toolOffsets: {},
  };
}

function uiUsageFromTokenUsage(
  usage: unknown,
): UiUsage | undefined {
  if (!Array.isArray(usage) || usage.length === 0) return undefined;
  const totals = usage.reduce(
    (acc, entry) => {
      const item = entry as Record<string, number | undefined>;
      acc.input += item.inputTokens ?? 0;
      acc.output += item.outputTokens ?? 0;
      acc.total += item.totalTokens ?? 0;
      acc.cache_read += item.cachedInputTokens ?? 0;
      acc.cache_write += item.cacheWriteInputTokens ?? 0;
      return acc;
    },
    { input: 0, output: 0, total: 0, cache_read: 0, cache_write: 0 },
  );
  if (totals.input === 0 && totals.output === 0 && totals.total === 0) return undefined;
  return {
    input: totals.input,
    output: totals.output,
    total: totals.total || totals.input + totals.output,
    cache_read: totals.cache_read,
    cache_write: totals.cache_write,
  };
}

function parseArgsBestEffort(argsText: string): unknown {
  if (!argsText.trim()) return undefined;
  try {
    return JSON.parse(argsText);
  } catch {
    return undefined;
  }
}

/**
 * Recalcula `content`, `tools` y `parts` a partir del texto crudo y de las
 * herramientas. El texto se parte en cada herramienta (según el punto del texto
 * en que arrancó) para conservar el orden real texto → pasos → texto. La UI
 * generativa llega como llamadas a herramienta (`present_openui`), no en el texto.
 */
function rebuild(state: AgUiState, patch: Partial<UiMessage> = {}): AgUiState {
  const parts: UiPart[] = [];

  const pushChunk = (chunk: string) => {
    const text = chunk.replace(/\n{3,}/g, "\n\n");
    if (text) parts.push({ type: "text", text });
  };

  let cursor = 0;
  for (const tool of state.toolCalls) {
    const offset = Math.min(
      Math.max(state.toolOffsets[tool.id] ?? state.rawText.length, cursor),
      state.rawText.length,
    );
    pushChunk(state.rawText.slice(cursor, offset));
    parts.push({ type: "tool", toolId: tool.id });
    cursor = offset;
  }
  pushChunk(state.rawText.slice(cursor));

  const content = parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .replace(/\n{3,}/g, "\n\n");

  return {
    ...state,
    message: {
      ...state.message,
      content,
      tools: state.toolCalls,
      parts,
      ...patch,
    },
  };
}

function withTool(state: AgUiState, tool: UiToolCall): AgUiState {
  const exists = state.toolCalls.some((item) => item.id === tool.id);
  return {
    ...state,
    toolOffsets: exists
      ? state.toolOffsets
      : { ...state.toolOffsets, [tool.id]: state.rawText.length },
    toolCalls: exists
      ? state.toolCalls.map((item) => (item.id === tool.id ? { ...item, ...tool } : item))
      : [...state.toolCalls, tool],
  };
}

function patchTool(
  state: AgUiState,
  id: string,
  patch: (tool: UiToolCall) => UiToolCall,
): AgUiState {
  return { ...state, toolCalls: state.toolCalls.map((tool) => (tool.id === id ? patch(tool) : tool)) };
}

export function reduceAgUi(state: AgUiState, event: AgUiEvent): AgUiState {
  switch (event.type) {
    case EventType.RUN_STARTED:
      // También se emite al reanudar un run en pausa: la pausa ya no está vigente.
      return rebuild(
        { ...state, runId: event.runId, threadId: event.threadId, interrupts: [] },
        { runId: event.runId, status: "running", interrupts: [] },
      );

    case EventType.TEXT_MESSAGE_CONTENT:
      return rebuild({ ...state, rawText: state.rawText + event.delta });

    case EventType.TEXT_MESSAGE_START:
    case EventType.TEXT_MESSAGE_END:
      return state;

    case EventType.TOOL_CALL_START:
      return rebuild(
        withTool(state, {
          id: event.toolCallId,
          name: event.toolCallName,
          argsText: "",
          status: "running",
        }),
      );

    case EventType.TOOL_CALL_ARGS: {
      const next = patchTool(state, event.toolCallId, (tool) => {
        const argsText = (tool.argsText ?? "") + event.delta;
        return { ...tool, argsText, input: parseArgsBestEffort(argsText) ?? tool.input };
      });
      return rebuild(next);
    }

    case EventType.TOOL_CALL_END:
      return rebuild(
        patchTool(state, event.toolCallId, (tool) => ({
          ...tool,
          input: tool.input ?? parseArgsBestEffort(tool.argsText ?? ""),
        })),
      );

    case EventType.TOOL_CALL_RESULT: {
      const metadata = (event.metadata ?? {}) as Record<string, unknown>;
      const isError = metadata.isError === true;
      const durationMs =
        typeof metadata.durationMs === "number" ? metadata.durationMs : undefined;
      return rebuild(
        patchTool(state, event.toolCallId, (tool) => ({
          ...tool,
          status: isError ? "error" : "complete",
          durationMs,
          ...(typeof event.content === "string" && event.content ? { result: event.content } : {}),
        })),
      );
    }

    case EventType.CUSTOM: {
      if (event.name === NEXUS_FOLLOWUPS) {
        const payload = event.value as NexusFollowupsPayload | undefined;
        const questions = (payload?.questions ?? []).filter((q) => typeof q === "string" && q.trim());
        return rebuild(state, { followups: questions });
      }
      if (event.name !== NEXUS_SOURCES && event.name !== LEGACY_SOURCES) return state;
      const payload = event.value as NexusSourcesPayload | undefined;
      return rebuild(state, { sources: payload?.sources ?? [] });
    }

    case EventType.SUBAGENT_STARTED: {
      const subagent: UiSubagent = {
        id: event.subagentRunId,
        name: event.name,
        description: event.description,
        parentToolCallId: event.parentToolCallId,
        status: "running",
      };
      return rebuild(state, {
        subagents: [...(state.message.subagents ?? []), subagent],
      });
    }

    case EventType.SUBAGENT_FINISHED:
    case EventType.SUBAGENT_ERROR: {
      const status = event.type === EventType.SUBAGENT_ERROR ? "error" : "complete";
      return rebuild(state, {
        subagents: (state.message.subagents ?? []).map((item) =>
          item.id === event.subagentRunId ? { ...item, status } : item,
        ),
      });
    }

    case EventType.RUN_FINISHED: {
      const outcome = event.outcome;
      const interrupted = outcome?.type === "interrupt";
      const interrupts: UiInterrupt[] = interrupted
        ? (outcome as { interrupts?: UiInterrupt[] }).interrupts ?? []
        : [];
      const usage = uiUsageFromTokenUsage(event.usage);
      // Una llamada que espera a la persona (formulario, aprobación) sigue pendiente.
      const waiting = new Set(interrupts.map((item) => item.toolCallId).filter(Boolean));
      return rebuild(
        {
          ...state,
          interrupts,
          toolCalls: state.toolCalls.map((tool) =>
            tool.status === "running" && !waiting.has(tool.id)
              ? { ...tool, status: "complete" as const }
              : tool,
          ),
        },
        {
          // En pausa el mensaje no está terminado: la UI debe seguir mostrándolo vivo.
          status: interrupted ? "running" : "complete",
          interrupts,
          ...(usage ? { usage } : {}),
        },
      );
    }

    case EventType.RUN_ERROR:
      return rebuild(state, { status: "error", error: event.message });

    default:
      return state;
  }
}

/** Aplica una secuencia completa de eventos (replay desde `run_events`). */
export function reduceAgUiAll(
  events: AgUiEvent[],
  messageId: string,
  createdAt?: string,
): AgUiState {
  return events.reduce<AgUiState>(
    (state, event) => reduceAgUi(state, event),
    initialAgUiState(messageId, createdAt),
  );
}
