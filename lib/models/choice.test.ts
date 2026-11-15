import { describe, expect, it } from "vitest";
import { resolveTurnModel } from "./choice";

describe("resolveTurnModel", () => {
  const chosen = { provider: "chatgpt", model: "gpt-6.1-sol" };

  it("un agente con modelo fijo manda sobre el selector", () => {
    expect(resolveTurnModel({ provider: "claude-code", model: "opus" }, chosen)).toEqual({
      provider: "claude-code",
      model: "opus",
      fixedByAgent: true,
    });
    expect(resolveTurnModel({ model: "opus" }, chosen).fixedByAgent).toBe(true);
  });

  it("sin modelo fijo se usa el del selector, y si no hay, el predeterminado", () => {
    expect(resolveTurnModel({}, chosen)).toEqual({ ...chosen, fixedByAgent: false });
    expect(resolveTurnModel({}, null)).toEqual({ fixedByAgent: false });
  });
});
