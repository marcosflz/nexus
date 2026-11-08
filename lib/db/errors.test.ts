import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "./errors";

describe("isUniqueViolation", () => {
  it("reconoce el código directo y el envuelto por Drizzle", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    const wrapped = Object.assign(new Error("Failed query: insert…"), { cause: { code: "23505" } });
    expect(isUniqueViolation(wrapped)).toBe(true);
    expect(isUniqueViolation({ cause: { cause: { code: "23505" } } })).toBe(true);
  });

  it("no confunde otros errores", () => {
    expect(isUniqueViolation(new Error("duplicate key"))).toBe(false);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });
});
