import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, parsePrefs } from "./prefs";

describe("parsePrefs", () => {
  it("null y JSON inválido dan los valores por defecto", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("{no")).toEqual(DEFAULT_PREFS);
  });
  it("un foco desconocido vuelve a web", () => {
    expect(parsePrefs(JSON.stringify({ focus: "nope" })).focus).toBe("web");
  });
  it("conserva research y valida ui", () => {
    expect(parsePrefs(JSON.stringify({ mode: "research" })).mode).toBe("research");
    expect(parsePrefs(JSON.stringify({ ui: "true" })).ui).toBe(false);
    expect(parsePrefs(JSON.stringify({ ui: true })).ui).toBe(true);
  });
});
