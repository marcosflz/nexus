import { describe, expect, it } from "vitest";
import { matchesSettings } from "./settings-search";

describe("matchesSettings", () => {
  it("ignora tildes y mayúsculas", () => {
    expect(matchesSettings("busqueda", "Preferencias", "tema búsqueda")).toBe(true);
  });
  it("la consulta vacía coincide siempre", () => {
    expect(matchesSettings("", "Cuenta", "")).toBe(true);
  });
  it("no coincide con texto ajeno", () => {
    expect(matchesSettings("xyz", "Cuenta", "email")).toBe(false);
  });
});
