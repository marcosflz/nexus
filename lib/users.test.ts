import { describe, expect, it } from "vitest";
import { generatePassword } from "./users";

describe("generatePassword", () => {
  it("genera contraseñas largas y distintas", () => {
    expect(generatePassword().length).toBeGreaterThanOrEqual(16);
    expect(generatePassword()).not.toBe(generatePassword());
  });
});
