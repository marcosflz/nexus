import { describe, expect, it } from "vitest";
import { extractModelEntries } from "./catalog";

describe("extractModelEntries", () => {
  it("acepta los formatos habituales y usa el nombre legible", () => {
    expect(
      extractModelEntries({
        data: [
          { id: "openai/gpt-x", name: "OpenAI: GPT X" },
          { id: "b-model" },
          { id: "openai/gpt-x", name: "dup" },
        ],
      }),
    ).toEqual([
      { id: "b-model", label: "b-model" },
      { id: "openai/gpt-x", label: "OpenAI: GPT X" },
    ]);
    expect(extractModelEntries({ models: [{ slug: "gpt-6", display_name: "GPT-6" }] })).toEqual([
      { id: "gpt-6", label: "GPT-6" },
    ]);
    expect(extractModelEntries(["  m1 ", "", 3])).toEqual([{ id: "m1", label: "m1" }]);
    expect(extractModelEntries(null)).toEqual([]);
  });
});
