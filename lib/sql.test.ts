import { describe, expect, it } from "vitest";
import { likePattern } from "./sql";

describe("likePattern", () => {
  it("busca de forma literal", () => {
    expect(likePattern("hola")).toBe("%hola%");
    expect(likePattern("100%")).toBe("%100\\%%");
    expect(likePattern("a_b")).toBe("%a\\_b%");
    expect(likePattern("a\\b")).toBe("%a\\\\b%");
  });
});
