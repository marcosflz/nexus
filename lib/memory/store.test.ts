import { describe, expect, it } from "vitest";
import { normalizeKey } from "./store";

describe("normalizeKey", () => {
  it("deja claves estables y seguras", () => {
    expect(normalizeKey("Ciudad Favorita")).toBe("ciudad_favorita");
    expect(normalizeKey("  Año de nacimiento!! ")).toBe("ano_de_nacimiento");
    expect(normalizeKey("a".repeat(200))).toHaveLength(80);
    expect(normalizeKey("🙂")).toBe("");
  });
});
