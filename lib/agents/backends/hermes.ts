import { EventType } from "@ag-ui/core";
import { NEXUS_FOLLOWUPS, NEXUS_SESSION, NEXUS_SOURCES, type AgUiEvent } from "@/lib/agui/events";
import { runHermesTurn } from "@/lib/hermes/runner";
import type { TurnEvent } from "@/lib/hermes/events";
import { buildPrompt } from "@/lib/hermes/prompts";
import { buildSources, parseFollowupsBlock } from "@/lib/sources";
import type { AgentBackend, BackendRunInput, BackendRunResult, EmitEvent } from "../backend";

const MAX_TOOL_OUTPUT = 200_000;

/** Estado mínimo para traducir un turno de Hermes a eventos AG-UI. */
export interface TurnTranslation {
  /** Prefijo de los ids de mensaje de texto (uno por tramo entre herramientas). */
  messageIdBase: string;
  textIndex: number;
  textOpen: boolean;
}

export function newTurnTranslation(messageIdBase: string): TurnTranslation {
  return { messageIdBase, textIndex: 0, textOpen: false };
}

function currentMessageId(ctx: TurnTranslation): string {
  return `${ctx.messageIdBase}-${ctx.textIndex}`;
}

/** Cierra el tramo de texto abierto, si lo hay. */
export function closeText(ctx: TurnTranslation): AgUiEvent[] {
  if (!ctx.textOpen) return [];
  const event = {
    type: EventType.TEXT_MESSAGE_END,
    messageId: currentMessageId(ctx),
  } as AgUiEvent;
  ctx.textOpen = false;
  ctx.textIndex += 1;
  return [event];
}

/**
 * Traduce un evento normalizado de Hermes a eventos AG-UI.
 *
 * Es pura salvo por `ctx`, que solo recuerda si hay un tramo de texto abierto.
 * Las salidas de las herramientas **no** viajan en el evento: pueden pesar
 * cientos de KB y solo sirven para extraer fuentes, que se emiten aparte.
 */
export function turnEventToAgUi(event: TurnEvent, ctx: TurnTranslation): AgUiEvent[] {
  switch (event.kind) {
    case "session":
      return [
        {
          type: EventType.CUSTOM,
          name: NEXUS_SESSION,
          value: { sessionId: event.sessionId },
        } as AgUiEvent,
      ];

    case "text": {
      const out: AgUiEvent[] = [];
      if (!ctx.textOpen) {
        out.push({
          type: EventType.TEXT_MESSAGE_START,
          messageId: currentMessageId(ctx),
          role: "assistant",
        } as AgUiEvent);
        ctx.textOpen = true;
      }
      out.push({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: currentMessageId(ctx),
        delta: event.delta,
      } as AgUiEvent);
      return out;
    }

    case "tool-start":
      return [
        ...closeText(ctx),
        {
          type: EventType.TOOL_CALL_START,
          toolCallId: event.id,
          toolCallName: event.name,
        } as AgUiEvent,
        {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId: event.id,
          delta: JSON.stringify(event.input ?? {}),
        } as AgUiEvent,
        { type: EventType.TOOL_CALL_END, toolCallId: event.id } as AgUiEvent,
      ];

    case "tool-end":
      return [
        {
          type: EventType.TOOL_CALL_RESULT,
          messageId: `${event.id}-result`,
          toolCallId: event.id,
          content: "",
          role: "tool",
          metadata: { isError: event.isError ?? false, durationMs: event.durationMs },
        } as AgUiEvent,
      ];

    case "done":
    case "error":
      // El ciclo de vida (RUN_FINISHED / RUN_ERROR) lo pone el ejecutor.
      return [];
  }
}

export const hermesBackend: AgentBackend = {
  id: "hermes",
  capabilities: {
    appTools: false,
    toolArgStreaming: false,
    interrupts: false,
    preToolPolicy: false,
  },

  async run(input: BackendRunInput, emit: EmitEvent, signal: AbortSignal): Promise<BackendRunResult> {
    const ctx = newTurnTranslation(`msg-${input.runId}`);
    const toolOutputs: string[] = [];

    const prompt = buildPrompt({
      text: input.userText,
      focus: input.focus,
      mode: input.mode,
      attachments: input.attachments,
      openui: input.openui,
      openuiProfile: input.openuiProfile,
      formResult: input.formResult,
      // Una sesión nueva de Hermes no conoce los turnos anteriores del hilo.
      transcript: input.backendSessionId ? undefined : input.history,
      agentInstructions: input.agent?.spec.instructions,
    });

    const result = await runHermesTurn({
      userId: input.userId,
      provider: input.credential.provider,
      model: input.credential.model,
      apiKey: input.credential.apiKey,
      baseUrl: input.credential.baseUrl,
      prompt,
      sessionId: input.backendSessionId,
      ...(input.limits?.maxTurns ? { maxTurns: input.limits.maxTurns } : {}),
      signal,
      onEvent: (event) => {
        if (event.kind === "tool-end" && event.output && event.output.length <= MAX_TOOL_OUTPUT) {
          toolOutputs.push(event.output);
        }
        for (const agUiEvent of turnEventToAgUi(event, ctx)) emit(agUiEvent);
      },
    });

    for (const event of closeText(ctx)) emit(event);

    const sources = buildSources(result.text, toolOutputs);
    emit({
      type: EventType.CUSTOM,
      name: NEXUS_SOURCES,
      value: { sources },
    } as AgUiEvent);

    const followups = parseFollowupsBlock(result.text);
    if (followups.length > 0) {
      emit({
        type: EventType.CUSTOM,
        name: NEXUS_FOLLOWUPS,
        value: { questions: followups },
      } as AgUiEvent);
    }

    return {
      backendSessionId: result.sessionId,
      outcome: "success",
      followups,
      usage: result.usage,
      finalText: result.text,
      sources,
    };
  },
};
