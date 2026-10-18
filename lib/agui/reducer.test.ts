import { describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/core";
import type { AgUiEvent } from "./events";
import { initialAgUiState, reduceAgUi, reduceAgUiAll } from "./reducer";

describe("reduceAgUi", () => {
  it("ensambla texto, herramientas, fuentes y uso de un turno completo", () => {
    const events = [
      { type: EventType.RUN_STARTED, threadId: "t1", runId: "r1" },
      { type: EventType.TEXT_MESSAGE_START, messageId: "m1", role: "assistant" },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "Hola " },
      { type: EventType.TOOL_CALL_START, toolCallId: "c1", toolCallName: "web_search" },
      {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: "c1",
        delta: '{"query":"clima madrid"}',
      },
      { type: EventType.TOOL_CALL_END, toolCallId: "c1" },
      {
        type: EventType.TOOL_CALL_RESULT,
        messageId: "m1",
        toolCallId: "c1",
        content: "21 grados",
        role: "tool",
        metadata: { durationMs: 420, isError: false },
      },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "mundo" },
      {
        type: EventType.CUSTOM,
        name: "plexo.sources",
        value: { sources: [{ id: 1, url: "https://a.test", domain: "a.test" }] },
      },
      {
        type: EventType.RUN_FINISHED,
        threadId: "t1",
        runId: "r1",
        outcome: { type: "success" },
        usage: [{ inputTokens: 10, outputTokens: 5, totalTokens: 15 }],
      },
    ] as unknown as AgUiEvent[];

    const state = reduceAgUiAll(events, "m1");

    expect(state.runId).toBe("r1");
    expect(state.message.content).toBe("Hola mundo");
    expect(state.message.status).toBe("complete");
    expect(state.message.sources).toHaveLength(1);
    expect(state.message.usage).toMatchObject({ input: 10, output: 5, total: 15 });

    const tool = state.message.tools.find((item) => item.id === "c1");
    expect(tool?.name).toBe("web_search");
    expect(tool?.status).toBe("complete");
    expect(tool?.durationMs).toBe(420);
    expect(tool?.input).toEqual({ query: "clima madrid" });
  });

  it("extrae un bloque openui del texto y lo deja fuera de la prosa", () => {
    const intro = "Mira este resumen.\n\n";
    const program = 'root = Card([t])\nt = TextContent("Hola")';
    const events = [
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: intro },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "```openui\n" },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: `${program}\n` },
    ] as unknown as AgUiEvent[];

    // A mitad del bloque: existe, pero sigue en curso. El salto de párrafo que
    // precedía al bloque se conserva: quitarlo rompería el texto al llegar en
    // fragmentos.
    const partial = reduceAgUiAll(events, "m1");
    expect(partial.message.content).toBe("Mira este resumen.\n\n");
    const running = partial.message.tools.find((item) => item.kind === "openui");
    expect(running?.status).toBe("running");
    expect(running?.name).toBe("present_openui");

    // Cerrado: programa completo y listo para persistir.
    const closed = reduceAgUi(partial, {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "m1",
      delta: "```\n",
    } as AgUiEvent);

    const done = closed.message.tools.find((item) => item.kind === "openui");
    expect(done?.status).toBe("complete");
    expect(done?.input).toEqual({ ui: program });
  });

  it("marca error cuando el run falla", () => {
    const state = reduceAgUi(initialAgUiState("m1"), {
      type: EventType.RUN_ERROR,
      message: "sin credenciales",
    } as AgUiEvent);

    expect(state.message.status).toBe("error");
    expect(state.message.error).toBe("sin credenciales");
  });

  it("expone los interrupts de una aprobación pendiente", () => {
    const state = reduceAgUi(initialAgUiState("m1"), {
      type: EventType.RUN_FINISHED,
      threadId: "t1",
      runId: "r1",
      outcome: {
        type: "interrupt",
        interrupts: [{ id: "i1", reason: "aprobar browser_click" }],
      },
    } as unknown as AgUiEvent);

    expect(state.interrupts).toHaveLength(1);
    expect(state.message.interrupts?.[0]?.id).toBe("i1");
  });
});
