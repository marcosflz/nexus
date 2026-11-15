import { describe, expect, it } from "vitest";
import { citationIdOf, citationNodes, remarkCitations, stripSourcesBlock } from "./citations";

describe("citationNodes", () => {
  it("convierte [n] en enlaces conservando el texto alrededor", () => {
    const nodes = citationNodes("Bun es rápido[1] y simple.")!;
    expect(nodes).toEqual([
      { type: "text", value: "Bun es rápido" },
      { type: "link", url: "#cite-1", children: [{ type: "text", value: "1" }] },
      { type: "text", value: " y simple." },
    ]);
  });

  it("expande varias citas juntas", () => {
    const links = citationNodes("Dato [1, 3] y otro [2][4]")!.filter((n) => n.type === "link");
    expect(links.map((n) => n.url)).toEqual(["#cite-1", "#cite-3", "#cite-2", "#cite-4"]);
  });

  it("devuelve null si no hay citas ni se confunde con otros corchetes", () => {
    expect(citationNodes("sin citas")).toBeNull();
    expect(citationNodes("array[i] y [texto] y [1a]")).toBeNull();
    expect(citationNodes("[12345]")).toBeNull();
  });
});

describe("remarkCitations", () => {
  const tree = () => ({
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [
          { type: "text", value: "Cita[1]" },
          { type: "inlineCode", value: "a[2]" },
          { type: "link", url: "http://x", children: [{ type: "text", value: "[3]" }] },
        ],
      },
      { type: "code", value: "x[4]" },
    ],
  });

  it("no toca código ni enlaces existentes", () => {
    const t = tree();
    remarkCitations()(t);
    const paragraph = t.children[0] as { children: { type: string; value?: string; url?: string }[] };

    expect(paragraph.children.map((c) => c.type)).toEqual(["text", "link", "inlineCode", "link"]);
    expect(paragraph.children[1].url).toBe("#cite-1");
    expect(paragraph.children[2].value).toBe("a[2]");
    expect(paragraph.children[3].url).toBe("http://x"); // el enlace propio queda intacto
    expect((t.children[1] as { value: string }).value).toBe("x[4]");
  });
});

describe("citationIdOf / stripSourcesBlock", () => {
  it("lee el número de fuente", () => {
    expect(citationIdOf("#cite-7")).toBe(7);
    expect(citationIdOf("#cite-0")).toBeNull();
    expect(citationIdOf("https://a.test")).toBeNull();
    expect(citationIdOf(undefined)).toBeNull();
  });

  it("quita el bloque final de fuentes pero deja el resto", () => {
    const text = "Respuesta [1].\n\n## Sources\n[1] A — https://a.test\n[2] B — https://b.test\n";
    expect(stripSourcesBlock(text)).toBe("Respuesta [1].");
    expect(stripSourcesBlock("Sin bloque.")).toBe("Sin bloque.");
    expect(stripSourcesBlock("Fuentes:\n- una\n")).toBe("Fuentes:\n- una\n".trimEnd());
  });
});

describe("citas agrupadas", () => {
  it("une citas consecutivas en un solo enlace y conserva las separadas", async () => {
    const { citationIdsOf } = await import("./citations");
    const t = { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: "A [1, 3] [3][2]. B [4]" }] }] };
    remarkCitations()(t);
    const children = (t.children[0] as { children: { type: string; url?: string; value?: string }[] }).children;
    const links = children.filter((c) => c.type === "link");
    expect(links.map((l) => l.url)).toEqual(["#cite-1,3,2", "#cite-4"]);
    expect(children.map((c) => c.value ?? "").join("")).toBe("A . B ");
    expect(citationIdsOf("#cite-1,3,2")).toEqual([1, 3, 2]);
    expect(citationIdOf("#cite-5,6")).toBe(5);
    expect(citationIdsOf("#cite-1,x")).toEqual([]);
  });
});
