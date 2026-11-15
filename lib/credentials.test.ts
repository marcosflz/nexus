import { describe, expect, it } from "vitest";
import { enabledModels } from "./credentials";

describe("enabledModels", () => {
  it("convierte las filas antiguas (solo ids) y quita duplicados", () => {
    expect(enabledModels({ models: ["a", { id: "b", label: "B" }, "a"], model: "a" })).toEqual([
      { id: "a", label: "a" },
      { id: "b", label: "B" },
    ]);
  });

  it("sin lista, el modelo de la fila", () => {
    expect(enabledModels({ models: null, model: "m" })).toEqual([{ id: "m", label: "m" }]);
    expect(enabledModels({ models: null, model: "" })).toEqual([]);
  });
});
