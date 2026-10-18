import { describe, expect, it } from "vitest";
import {
  buildSources,
  domainOf,
  extractUrlsFromToolOutput,
  parseSourcesBlock,
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
