import { describe, expect, it } from "vitest";
import { completeOrder, SEARCH_PROVIDER_IDS } from "./providers";

const missing = (id: (typeof SEARCH_PROVIDER_IDS)[number]) => ({ id, enabled: false });

describe("completeOrder", () => {
  it("respeta el orden guardado", () => {
    const out = completeOrder([{ id: "brave", enabled: true }, { id: "searxng", enabled: true }], missing);
    expect(out.map((item) => item.id)).toEqual(["brave", "searxng", "langsearch"]);
  });

  it("añade los motores nuevos desactivados", () => {
    expect(completeOrder([], missing).every((item) => !item.enabled)).toBe(true);
    expect(completeOrder([], missing)).toHaveLength(SEARCH_PROVIDER_IDS.length);
  });

  it("descarta duplicados y motores desconocidos", () => {
    const out = completeOrder(
      [{ id: "brave", enabled: true }, { id: "brave", enabled: false }, { id: "retirado" as "brave", enabled: true }],
      missing,
    );
    expect(out.filter((item) => item.id === "brave")).toEqual([{ id: "brave", enabled: true }]);
    expect(out).toHaveLength(SEARCH_PROVIDER_IDS.length);
  });
});
