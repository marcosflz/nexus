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
        name: "nexus.sources",
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

  it("la UI generativa llega como herramienta y un bloque cercado en el texto es solo texto", () => {
    const events = [
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "Antes.\n```openui\nroot = Card([])\n```\n" },
      { type: EventType.TOOL_CALL_START, toolCallId: "c1", toolCallName: "present_openui" },
      { type: EventType.TOOL_CALL_ARGS, toolCallId: "c1", delta: '{"ui":"root = Card([])"}' },
      { type: EventType.TOOL_CALL_END, toolCallId: "c1" },
    ] as unknown as AgUiEvent[];

    const { message } = reduceAgUiAll(events, "m1");

    expect(message.tools).toHaveLength(1);
    expect(message.tools[0]).toMatchObject({ id: "c1", name: "present_openui", input: { ui: "root = Card([])" } });
    expect(message.content).toContain("```openui");
    expect(message.parts?.map((part) => part.type)).toEqual(["text", "tool"]);
  });

  it("conserva el orden real de texto y herramientas en parts", () => {
    const events = [
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "Busco. " },
      { type: EventType.TOOL_CALL_START, toolCallId: "c1", toolCallName: "web_search" },
      { type: EventType.TOOL_CALL_END, toolCallId: "c1" },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "Leo. " },
      { type: EventType.TOOL_CALL_START, toolCallId: "c2", toolCallName: "web_extract" },
      { type: EventType.TOOL_CALL_END, toolCallId: "c2" },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "Listo." },
    ] as unknown as AgUiEvent[];

    const { message } = reduceAgUiAll(events, "m1");

    expect(message.parts).toEqual([
      { type: "text", text: "Busco. " },
      { type: "tool", toolId: "c1" },
      { type: "text", text: "Leo. " },
      { type: "tool", toolId: "c2" },
      { type: "text", text: "Listo." },
    ]);
    expect(message.content).toBe("Busco. Leo. Listo.");
  });

  it("sigue entendiendo los eventos plexo.sources ya guardados en run_events", () => {
    const state = reduceAgUi(initialAgUiState("m1"), {
      type: EventType.CUSTOM,
      name: "plexo.sources",
      value: { sources: [{ id: 1, url: "https://viejo.test", domain: "viejo.test" }] },
    } as unknown as AgUiEvent);

    expect(state.message.sources).toHaveLength(1);
    expect(state.message.sources[0]?.domain).toBe("viejo.test");
  });

  it("marca error cuando el run falla", () => {
    const state = reduceAgUi(initialAgUiState("m1"), {
      type: EventType.RUN_ERROR,
      message: "sin credenciales",
    } as AgUiEvent);

    expect(state.message.status).toBe("error");
    expect(state.message.error).toBe("sin credenciales");
  });

  it("recoge las preguntas de seguimiento", () => {
    const { message } = reduceAgUiAll(
      [
        {
          type: EventType.CUSTOM,
          name: "nexus.followups",
          value: { questions: ["¿Y en 2025?", "  ", "¿Cuánto cuesta?"] },
        },
      ] as unknown as AgUiEvent[],
      "m1",
    );
    expect(message.followups).toEqual(["¿Y en 2025?", "¿Cuánto cuesta?"]);
  });

  it("una pausa mantiene pendiente la herramienta que espera y la reanudación la libera", () => {
    const paused = reduceAgUiAll(
      [
        { type: EventType.RUN_STARTED, threadId: "t", runId: "r" },
        { type: EventType.TOOL_CALL_START, toolCallId: "c1", toolCallName: "prompt_openui" },
        { type: EventType.TOOL_CALL_START, toolCallId: "c2", toolCallName: "web_search" },
        {
          type: EventType.RUN_FINISHED,
          threadId: "t",
          runId: "r",
          outcome: {
            type: "interrupt",
            interrupts: [{ id: "i1", reason: "openui_form", toolCallId: "c1" }],
          },
        },
      ] as unknown as AgUiEvent[],
      "m1",
    );

    const byId = Object.fromEntries(paused.message.tools.map((tool) => [tool.id, tool.status]));
    expect(byId).toEqual({ c1: "running", c2: "complete" });
    expect(paused.message.status).toBe("running"); // el mensaje sigue vivo
    expect(paused.message.interrupts).toHaveLength(1);

    const resumed = reduceAgUi(
      reduceAgUi(paused, { type: EventType.RUN_STARTED, threadId: "t", runId: "r" } as AgUiEvent),
      {
        type: EventType.TOOL_CALL_RESULT,
        messageId: "x",
        toolCallId: "c1",
        content: "{}",
        role: "tool",
      } as unknown as AgUiEvent,
    );
    expect(resumed.message.interrupts).toEqual([]);
    expect(resumed.message.tools.find((tool) => tool.id === "c1")?.status).toBe("complete");
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
