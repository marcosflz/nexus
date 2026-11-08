import { describe, expect, it } from "vitest";
import { proseOf, splitOpenUiBlocks } from "./blocks";

describe("splitOpenUiBlocks", () => {
  it("deja el texto normal intacto", () => {
    const segments = splitOpenUiBlocks("Solo prosa.\n");
    expect(segments).toEqual([{ type: "text", text: "Solo prosa.\n" }]);
  });

  it("separa prosa y bloque cerrado", () => {
    const text = 'Antes.\n\n```openui\nroot = Card([t])\nt = TextContent("Hola")\n```\nDespués.\n';
    const segments = splitOpenUiBlocks(text);

    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ type: "text", text: "Antes.\n\n" });
    expect(segments[1]).toMatchObject({
      type: "openui",
      closed: true,
      program: 'root = Card([t])\nt = TextContent("Hola")',
    });
    expect(segments[2]).toEqual({ type: "text", text: "Después.\n" });
  });

  it("trata un bloque sin cerrar como UI en curso", () => {
    const segments = splitOpenUiBlocks("```openui\nroot = Card([t])\n");
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ type: "openui", closed: false });
  });

  it("no confunde un bloque de código normal con UI", () => {
    const segments = splitOpenUiBlocks("```ts\nconst a = 1;\n```\n");
    expect(segments.every((segment) => segment.type === "text")).toBe(true);
    expect(segments.map((segment) => (segment.type === "text" ? segment.text : "")).join("")).toBe(
      "```ts\nconst a = 1;\n```\n",
    );
  });

  it("acepta la etiqueta corta oui y el prefijo de mayúsculas", () => {
    for (const label of ["oui", "OpenUI"]) {
      const segments = splitOpenUiBlocks(`\`\`\`${label}\nroot = Card([])\n\`\`\`\n`);
      expect(segments.some((segment) => segment.type === "openui")).toBe(true);
    }
  });

  it("proseOf elimina los bloques", () => {
    const text = 'Antes.\n\n```openui\nroot = Card([])\n```\n\nDespués.';
    expect(proseOf(text)).toBe("Antes.\n\nDespués.");
  });
});

describe("unwrapOpenUiProgram", () => {
  it("deja un programa limpio igual y desenvuelve uno cercado", async () => {
    const { unwrapOpenUiProgram } = await import("./blocks");
    expect(unwrapOpenUiProgram("root = Card([])")).toBe("root = Card([])");
    expect(unwrapOpenUiProgram("```openui\nroot = Card([])\n```")).toBe("root = Card([])");
    expect(unwrapOpenUiProgram("```\nroot = Card([])\n```\n")).toBe("root = Card([])");
    // En streaming el cierre aún no ha llegado.
    expect(unwrapOpenUiProgram("```openui\nroot = Card([")).toBe("root = Card([");
  });
});
