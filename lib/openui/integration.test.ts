import { describe, expect, it } from "vitest";
import { openuiToolsEnabled } from "./prompt";
import { validateOpenUiProgram } from "./validate";

/**
 * Guardarraíl de la parte más frágil de la integración: si la librería, el
 * prompt y el validador se desincronizan, la UI deja de pintarse sin que nada
 * falle de forma evidente.
 */
describe("integración OpenUI", () => {
  it("acepta un programa válido", () => {
    const result = validateOpenUiProgram('root = Card([t])\nt = TextContent("Hola")');
    expect(result.ok).toBe(true);
  });

  it("rechaza un programa vacío, roto o incompleto", () => {
    expect(validateOpenUiProgram("   ").ok).toBe(false);
    expect(validateOpenUiProgram("root = Card([t]").ok).toBe(false);
    expect(validateOpenUiProgram("esto no es un programa").ok).toBe(false);
  });

  it("activa la interfaz por foco, por modo o a petición del usuario", () => {
    expect(openuiToolsEnabled({ focus: "finance" })).toBe(true);
    expect(openuiToolsEnabled({ mode: "research" })).toBe(true);
    expect(openuiToolsEnabled({ userToggle: true })).toBe(true);
    expect(openuiToolsEnabled({ focus: "academic" })).toBe(false);
  });
});
