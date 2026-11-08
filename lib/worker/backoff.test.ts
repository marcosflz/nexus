import { describe, expect, it } from "vitest";
import { backoffMs } from "./backoff";

describe("backoffMs", () => {
  it("crece de forma exponencial y se acota", () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([30_000, 120_000, 480_000, 1_920_000]);
    expect(backoffMs(10)).toBe(3_600_000);
    expect(backoffMs(0)).toBe(30_000);
  });
});
