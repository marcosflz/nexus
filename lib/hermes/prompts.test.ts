import { describe, expect, it } from "vitest";
import { buildPrompt } from "./prompts";

describe("buildPrompt", () => {
  it("el camino clásico (sin transcript) es solo el texto del usuario", () => {
    expect(buildPrompt({ text: "hola" })).toBe("hola");
  });

  it("incluye la conversación previa antes de la pregunta, en orden", () => {
    const prompt = buildPrompt({
      text: "¿y ahora?",
      transcript: [
        { role: "user", content: "primera" },
        { role: "assistant", content: "respuesta" },
      ],
    });

    expect(prompt.indexOf("[Usuario] primera")).toBeLessThan(prompt.indexOf("[Asistente] respuesta"));
    expect(prompt.endsWith("¿y ahora?")).toBe(true);
    expect(prompt).toContain("solo contexto");
  });

  it("recorta lo más antiguo cuando la conversación es larga, y conserva lo reciente", () => {
    const transcript = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 ? "assistant" : "user") as "user" | "assistant",
      content: `mensaje-${i} ${"x".repeat(2500)}`,
    }));
    const prompt = buildPrompt({ text: "q", transcript });

    expect(prompt).toContain("mensaje-29");
    expect(prompt).not.toContain("mensaje-0 ");
    expect(prompt.length).toBeLessThan(14_000);
  });
});
