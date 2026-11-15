import { describe, expect, it } from "vitest";
import { createParser } from "@openuidev/lang-core";
import { OPENUI_PROFILES, openUiLibraries, openUiSpec, profileFor } from "./profiles";

const SIMPLE = 'root = Card([t])\nt = TextContent("Hola")';

describe("perfiles de OpenUI", () => {
  it("todos los perfiles se construyen y entienden un programa simple", () => {
    for (const profile of OPENUI_PROFILES) {
      const library = openUiLibraries[profile];
      const parser = createParser(library.toJSONSchema(), library.root ?? "Card");
      const result = parser.parse(SIMPLE);
      expect(result.root, profile).toBeTruthy();
    }
  });

  it("cada perfil ofrece solo lo que promete", () => {
    const has = (profile: (typeof OPENUI_PROFILES)[number], component: string) =>
      component in openUiLibraries[profile].components;

    expect(has("minimal", "Card")).toBe(true);
    expect(has("minimal", "BarChart")).toBe(false);
    expect(has("minimal", "Form")).toBe(false);
    expect(has("data", "BarChart")).toBe(true);
    expect(has("data", "Table")).toBe(true);
    expect(has("data", "Form")).toBe(false);
    expect(has("forms", "Form")).toBe(true);
    expect(has("forms", "BarChart")).toBe(false);
    expect(has("lists", "ListBlock")).toBe(true);
    expect(has("full", "BarChart") && has("full", "Form")).toBe(true);
  });

  it("los perfiles pequeños recortan el prompt de forma sustancial", () => {
    const size = (profile: (typeof OPENUI_PROFILES)[number]) => openUiSpec(profile).length;

    expect(size("minimal")).toBeLessThan(size("data"));
    expect(size("data")).toBeLessThan(size("full"));
    // Frente a los ~53k caracteres de la librería completa con ejemplos.
    expect(size("minimal")).toBeLessThan(53_000 * 0.5); // medido: ~21,7k (−59%)
    expect(size("full")).toBeLessThan(53_000);
  });

  it("la especificación se cachea por perfil", () => {
    expect(openUiSpec("data")).toBe(openUiSpec("data"));
  });

  it("elige el perfil por contexto", () => {
    expect(profileFor({})).toBe("minimal");
    expect(profileFor({ focus: "finance" })).toBe("data");
    expect(profileFor({ mode: "research" })).toBe("data");
    expect(profileFor({ focus: "news" })).toBe("minimal");
    expect(profileFor({ userToggle: true, focus: "finance" })).toBe("full");
  });
});

describe("UI generativa en modo auto", () => {
  it("usa el perfil de la instancia salvo que se pida la UI expresamente", async () => {
    const { openuiToolsEnabled } = await import("./prompt");
    expect(profileFor({ autoProfile: "data" })).toBe("data");
    expect(profileFor({ autoProfile: "lists", focus: "finance" })).toBe("lists");
    expect(profileFor({ autoProfile: "data", userToggle: true })).toBe("full");
    expect(profileFor({})).toBe("minimal");
    expect(openuiToolsEnabled({ auto: true })).toBe(openuiToolsEnabled({ userToggle: true }));
  });
});
