import { createParser } from "@openuidev/lang-core";
import { OPENUI_ROOT, nexusLibrary } from "./library";

export interface OpenUiValidation {
  ok: boolean;
  error?: string;
  /**
   * Errores de propiedades no fatales: el componente se pinta con un hueco.
   * Se registran para diagnóstico, pero no invalidan el programa entero,
   * porque tirar la interfaz completa es peor que mostrar un hueco.
   */
  warnings: number;
}

type Parser = ReturnType<typeof createParser>;

let parser: Parser | null = null;

function getParser(): Parser {
  if (!parser) {
    parser = createParser(nexusLibrary.toJSONSchema(), OPENUI_ROOT);
  }
  return parser;
}

/**
 * Valida un programa OpenUI antes de persistirlo.
 *
 * Se llama **una sola vez, cuando el bloque ya está cerrado**: durante el
 * streaming el programa está a medias por definición y `incomplete` es lo
 * normal, no un error.
 */
export function validateOpenUiProgram(program: string): OpenUiValidation {
  const trimmed = program.trim();
  if (!trimmed) return { ok: false, error: "programa vacío", warnings: 0 };

  try {
    const result = getParser().parse(trimmed);
    if (result.meta.incomplete) {
      return { ok: false, error: "el programa quedó incompleto", warnings: 0 };
    }
    if (!result.root) {
      return { ok: false, error: "el programa no produce un componente raíz", warnings: 0 };
    }
    return { ok: true, warnings: result.meta.errors?.length ?? 0 };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "error de parseo",
      warnings: 0,
    };
  }
}
