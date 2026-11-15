import { describe, expect, it } from "vitest";
import { domainOf, shortDomain, stripFollowupsBlock } from "./sources";

describe("domainOf", () => {
  it("extrae el dominio sin www", () => {
    expect(domainOf("https://www.example.com/a/b?c=1")).toBe("example.com");
    expect(domainOf("no-url")).toBe("");
  });
});

describe("stripFollowupsBlock", () => {
  it("quita el bloque heredado pero conserva las fuentes", () => {
    const text = "Respuesta [1].\n\n## Sources\n[1] A — https://a.test\n\n## Follow-ups\n- ¿Cuánto cuesta?";
    const stripped = stripFollowupsBlock(text);
    expect(stripped).toContain("## Sources");
    expect(stripped).not.toContain("¿Cuánto cuesta?");
    expect(stripFollowupsBlock("nada que quitar")).toBe("nada que quitar");
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
