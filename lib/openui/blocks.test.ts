import { describe, expect, it } from "vitest";
import { unwrapOpenUiProgram } from "./blocks";

describe("unwrapOpenUiProgram", () => {
  it("deja un programa limpio igual y desenvuelve uno cercado", () => {
    expect(unwrapOpenUiProgram("root = Card([])")).toBe("root = Card([])");
    expect(unwrapOpenUiProgram("```openui\nroot = Card([])\n```")).toBe("root = Card([])");
    expect(unwrapOpenUiProgram("```\nroot = Card([])\n```\n")).toBe("root = Card([])");
    // En streaming el cierre aún no ha llegado.
    expect(unwrapOpenUiProgram("```openui\nroot = Card([")).toBe("root = Card([");
  });
});
