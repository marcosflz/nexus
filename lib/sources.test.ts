import { describe, expect, it } from "vitest";
import {
  buildSources,
  domainOf,
  shortDomain,
  extractUrlsFromToolOutput,
  parseFollowupsBlock,
  parseSourcesBlock,
  stripFollowupsBlock,
} from "./sources";

describe("domainOf", () => {
  it("extrae el dominio sin www", () => {
    expect(domainOf("https://www.example.com/a/b?c=1")).toBe("example.com");
    expect(domainOf("no-url")).toBe("");
  });
});

describe("parseSourcesBlock", () => {
  it("parsea un bloque ## Sources con títulos", () => {
    const text = [
      "Ice floats.[1][2]",
      "",
      "## Sources",
      "[1] Ice density — https://example.com/ice",
      "[2] https://www.nature.com/articles/x",
    ].join("\n");

    const sources = parseSourcesBlock(text);
    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({
      id: 1,
      url: "https://example.com/ice",
      title: "Ice density",
      domain: "example.com",
    });
    expect(sources[1]).toMatchObject({ id: 2, domain: "nature.com" });
  });

  it("soporta la variante `Sources:`", () => {
    const sources = parseSourcesBlock("Respuesta.\n\nSources:\n[1] https://a.dev");
    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBe("https://a.dev");
  });

  it("devuelve vacío si no hay bloque", () => {
    expect(parseSourcesBlock("solo texto")).toEqual([]);
  });
});

describe("extractUrlsFromToolOutput", () => {
  it("extrae urls y títulos de JSON anidado", () => {
    const output = JSON.stringify({
      success: true,
      results: [
        { url: "https://example.com/a", title: "A" },
        { url: "https://example.com/b", name: "B" },
      ],
    });
    const found = extractUrlsFromToolOutput(output);
    expect(found).toEqual([
      { url: "https://example.com/a", title: "A" },
      { url: "https://example.com/b", title: "B" },
    ]);
  });

  it("deduplica y cae a regex si no hay JSON", () => {
    const found = extractUrlsFromToolOutput(
      "ver https://example.com/a y https://example.com/a y https://b.dev",
    );
    expect(found.map((item) => item.url)).toEqual([
      "https://example.com/a",
      "https://b.dev",
    ]);
  });
});

describe("buildSources", () => {
  it("fusiona el bloque Sources con los outputs sin duplicar", () => {
    const text = "Hola.[1]\n\n## Sources\n[1] A — https://example.com/a";
    const toolOutput = JSON.stringify({
      results: [
        { url: "https://example.com/a", title: "A" },
        { url: "https://example.com/c", title: "C" },
      ],
    });

    const sources = buildSources(text, [toolOutput]);
    expect(sources.map((source) => source.url)).toEqual([
      "https://example.com/a",
      "https://example.com/c",
    ]);
    expect(sources[0].id).toBe(1);
    expect(sources[1].id).toBe(2);
  });
});

describe("follow-ups", () => {
  const text = [
    "Respuesta [1].",
    "",
    "## Sources",
    "[1] A — https://a.test",
    "",
    "## Follow-ups",
    "- ¿Cuánto cuesta?",
    "- **¿Y en España?**",
    "2. ¿Qué alternativas hay?",
    "",
    "Texto suelto que ya no es de la lista",
  ].join("\n");

  it("extrae las preguntas de la lista", () => {
    expect(parseFollowupsBlock(text)).toEqual([
      "¿Cuánto cuesta?",
      "¿Y en España?",
      "¿Qué alternativas hay?",
    ]);
  });

  it("limita a cinco y tolera variantes del encabezado", () => {
    const many = `x\n\n### Follow ups\n${Array.from({ length: 8 }, (_, i) => `- q${i}`).join("\n")}`;
    expect(parseFollowupsBlock(many)).toHaveLength(5);
    expect(parseFollowupsBlock("x\n\n## Followups\n- uno")).toEqual(["uno"]);
    expect(parseFollowupsBlock("sin bloque")).toEqual([]);
  });

  it("quita el bloque pero conserva las fuentes", () => {
    const stripped = stripFollowupsBlock(text);
    expect(stripped).toContain("## Sources");
    expect(stripped).not.toContain("Follow-ups");
    expect(stripped).not.toContain("¿Cuánto cuesta?");
    expect(stripFollowupsBlock("nada que quitar")).toBe("nada que quitar");
  });

  it("las fuentes se siguen leyendo con el bloque de follow-ups detrás", () => {
    expect(parseSourcesBlock(text).map((s) => s.url)).toEqual(["https://a.test"]);
  });
});

describe("shortDomain", () => {
  it("devuelve el nombre corto del dominio", () => {
    expect(shortDomain("https://es.wikipedia.org/x")).toBe("wikipedia");
    expect(shortDomain("https://www.reuters.com")).toBe("reuters");
    expect(shortDomain("https://bbc.co.uk/news")).toBe("bbc");
    expect(shortDomain("https://localhost:3000")).toBe("localhost");
    expect(shortDomain("no es url")).toBe("");
  });
});
