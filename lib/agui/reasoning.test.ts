import { describe, expect, it } from "vitest";
import { finalizeAssistantMessage } from "@/lib/runs/finalize";
import { EventType, NEXUS_REASONING, type AgUiEvent } from "./events";
import { initialAgUiState, MAX_REASONING_CHARS, reduceAgUi } from "./reducer";

const custom = (delta: unknown) => ({ type: EventType.CUSTOM, name: NEXUS_REASONING, value: { delta } }) as unknown as AgUiEvent;
const text = (delta: string) => ({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m", delta }) as unknown as AgUiEvent;

describe("razonamiento del modelo", () => {
  it("se acumula aparte de la respuesta", () => {
    let state = initialAgUiState("m");
    for (const event of [custom("pienso "), text("hola"), custom("más")]) state = reduceAgUi(state, event);
    expect(state.message.reasoning).toBe("pienso más");
    expect(state.message.content).toBe("hola");
  });

  it("ignora fragmentos que no son texto y tiene un tope", () => {
    let state = reduceAgUi(initialAgUiState("m"), custom({ no: "texto" }));
    expect(state.message.reasoning).toBeUndefined();
    for (let index = 0; index < 5; index += 1) state = reduceAgUi(state, custom("x".repeat(10_000)));
    expect(state.message.reasoning).toHaveLength(MAX_REASONING_CHARS);
  });

  it("se guarda con el mensaje, y null si no hubo", () => {
    const state = reduceAgUi(reduceAgUi(initialAgUiState("m"), custom("pienso")), text("hola"));
    expect(finalizeAssistantMessage(state, "hola")).toMatchObject({ content: "hola", reasoning: "pienso" });
    expect(finalizeAssistantMessage(reduceAgUi(initialAgUiState("m"), text("hola")), "hola").reasoning).toBeNull();
  });
});
