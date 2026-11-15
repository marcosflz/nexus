import { describe, expect, it } from "vitest";
import { OPENUI_GROUPS } from "./groups";
import { nexusLibrary } from "./library";

describe("OPENUI_GROUPS", () => {
  it("coincide con los grupos de la librería instalada", () => {
    const actual = Object.fromEntries(
      (nexusLibrary.componentGroups ?? []).map((group) => [group.name, group.components]),
    );
    // Si falla tras actualizar @openuidev/react-ui, hay que regenerar groups.ts.
    expect(OPENUI_GROUPS).toEqual(actual);
  });

  it("todos los componentes de los grupos existen en la librería", () => {
    for (const components of Object.values(OPENUI_GROUPS)) {
      for (const component of components) {
        expect(component in nexusLibrary.components, component).toBe(true);
      }
    }
  });
});
