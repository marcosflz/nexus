import { describe, expect, it } from "vitest";
import { chunkText } from "./chunk";
import { buildOrQuery } from "./query";

describe("chunkText", () => {
  it("un texto corto es un solo fragmento", () => {
    expect(chunkText("Hola mundo.\n\nSegundo párrafo.")).toEqual(["Hola mundo.\n\nSegundo párrafo."]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("corta por párrafos y respeta el tamaño objetivo", () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) => `Párrafo ${i} ${"palabra ".repeat(60)}`.trim());
    const chunks = chunkText(paragraphs.join("\n\n"), { targetChars: 1500, overlapChars: 200 });

    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(1500 + 200 + 10);
    // Ningún párrafo se pierde.
    const all = chunks.join("\n");
    for (let i = 0; i < 20; i += 1) expect(all).toContain(`Párrafo ${i} `);
  });

  it("solapa fragmentos consecutivos", () => {
    const text = Array.from({ length: 12 }, (_, i) => `frase-${i} ${"x".repeat(150)}`).join("\n\n");
    const [first, second] = chunkText(text, { targetChars: 600, overlapChars: 120 });
    const tailWord = first.slice(-60).split(" ").at(-1)!;
    expect(second.startsWith(first.slice(-120).slice(first.slice(-120).indexOf(" ") + 1))).toBe(true);
    expect(second).toContain(tailWord);
  });

  it("parte un párrafo gigante sin dejar fragmentos enormes", () => {
    const giant = Array.from({ length: 400 }, (_, i) => `Frase número ${i}.`).join(" ");
    const chunks = chunkText(giant, { targetChars: 800, overlapChars: 100 });

    expect(chunks.length).toBeGreaterThan(5);
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(1000);
    // Los cortes caen preferentemente al final de una frase.
    expect(chunks.slice(0, -1).filter((c) => c.trimEnd().endsWith(".")).length).toBeGreaterThan(chunks.length / 2);
  });
});

describe("buildOrQuery", () => {
  it("quita palabras vacías y une con OR con prefijo", () => {
    expect(buildOrQuery("¿Cuál es el plazo de entrega?")).toBe("plazo:* | entrega:*");
  });

  it("neutraliza operadores de tsquery", () => {
    const query = buildOrQuery("foo & bar | !baz ' ; drop table")!;
    expect(query).not.toMatch(/[&!';(]/);
    expect(query.split(" | ")).toEqual(["foo:*", "bar:*", "baz:*", "drop:*", "table:*"]);
  });

  it("devuelve null si no queda nada útil y limita los términos", () => {
    expect(buildOrQuery("¿Qué es el la de?")).toBeNull();
    expect(buildOrQuery("")).toBeNull();
    expect(buildOrQuery(Array.from({ length: 30 }, (_, i) => `termino${i}`).join(" "))!.split(" | ")).toHaveLength(12);
  });

  it("admite acentos y números", () => {
    expect(buildOrQuery("garantía 2025 años")).toBe("garantía:* | 2025:* | años:*");
  });
});
