import {
  EventType,
  PLEXO_SOURCES,
  type AgUiEvent,
  type PlexoSourcesPayload,
} from "./events";
import { OPENUI_TOOL_NAME, splitOpenUiBlocks } from "@/lib/openui/blocks";
import type {
  UiInterrupt,
  UiMessage,
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
  agentSessionId: string | null;
  interrupts: UiInterrupt[];
  /** Texto crudo del asistente, con los bloques de UI dentro. */
  rawText: string;
  /** Llamadas a herramientas emitidas por AG-UI (Hermes). */
  toolCalls: UiToolCall[];
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
    agentSessionId: null,
    interrupts: [],
    rawText: "",
    toolCalls: [],
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
 * Recalcula `content` y `tools` a partir del texto crudo y de las herramientas.
 *
 * Los bloques OpenUI se derivan del texto, así que su estado es siempre
 * coherente con lo que se ha recibido: no hay una segunda fuente de verdad que
 * pueda desincronizarse.
 */
function rebuild(state: AgUiState, patch: Partial<UiMessage> = {}): AgUiState {
  const segments = splitOpenUiBlocks(state.rawText);
  const textParts: string[] = [];
  const openui: UiToolCall[] = [];

  for (const segment of segments) {
    if (segment.type === "text") {
      textParts.push(segment.text);
      continue;
    }
    const program = segment.program;
    openui.push({
      id: `openui-${segment.index}`,
      name: OPENUI_TOOL_NAME,
      kind: "openui",
      input: { ui: program },
      argsText: JSON.stringify({ ui: program }),
      status: segment.closed ? "complete" : "running",
    });
  }

  const content = textParts.join("").replace(/\n{3,}/g, "\n\n");

  return {
    ...state,
    message: {
      ...state.message,
      content,
      tools: [...state.toolCalls, ...openui],
      ...patch,
    },
  };
}

function withTool(state: AgUiState, tool: UiToolCall): AgUiState {
  const exists = state.toolCalls.some((item) => item.id === tool.id);
  return {
    ...state,
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
      return rebuild(
        { ...state, runId: event.runId, threadId: event.threadId },
        { runId: event.runId, status: "running" },
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
        })),
      );
    }

    case EventType.CUSTOM: {
      if (event.name !== PLEXO_SOURCES) return state;
      const payload = event.value as PlexoSourcesPayload | undefined;
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
      return rebuild(
        {
          ...state,
          interrupts,
          toolCalls: state.toolCalls.map((tool) =>
            tool.status === "running" ? { ...tool, status: "complete" as const } : tool,
          ),
        },
        {
          status: "complete",
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
