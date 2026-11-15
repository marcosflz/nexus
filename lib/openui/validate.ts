import { createParser } from "@openuidev/lang-core";
import { OPENUI_ROOT, nexusLibrary, normalizeOpenUiProgram } from "./library";

export interface OpenUiValidation {
  ok: boolean;
  error?: string;
  /** Errores tolerados: no dejan huecos en la interfaz (p. ej. argumentos de más, que se descartan). */
  warnings: number;
}

/** Lo único que no estropea lo que se ve: el parser descarta los argumentos sobrantes. */
const HARMLESS = new Set(["excess-args"]);
const MAX_REPORTED = 3;

type Parser = ReturnType<typeof createParser>;

let parser: Parser | null = null;

function getParser(): Parser {
  if (!parser) {
    parser = createParser(nexusLibrary.toJSONSchema(), OPENUI_ROOT);
  }
  return parser;
}

/**
 * Valida un programa OpenUI antes de darlo por mostrado.
 *
 * Se llama **una sola vez, cuando el bloque ya está cerrado**: durante el
 * streaming el programa está a medias por definición y `incomplete` es lo
 * normal, no un error.
 *
 * Es tan estricto como el renderer: un componente al que le falta un dato
 * obligatorio o una referencia sin definir desaparecen de la interfaz, así que
 * se devuelven como error (con la firma del componente) para que el modelo lo
 * corrija, en vez de dar por buena una tarjeta vacía.
 */
export function validateOpenUiProgram(program: string): OpenUiValidation {
  const normalized = normalizeOpenUiProgram(program);
  if (!normalized) return { ok: false, error: "programa vacío", warnings: 0 };

  try {
    const result = getParser().parse(normalized);
    if (result.meta.incomplete) {
      return { ok: false, error: "el programa quedó incompleto", warnings: 0 };
    }
    if (!result.root) {
      return { ok: false, error: "el programa no produce un componente raíz", warnings: 0 };
    }
    const errors = (result.meta.errors ?? []).filter((item) => item.severity !== "warning");
    const fatal = errors.filter((item) => !HARMLESS.has(item.code));
    const problems = [...new Set(fatal.map((item) => item.message))];
    if (result.meta.unresolved.length > 0) {
      problems.unshift(`referencias sin definir: ${[...new Set(result.meta.unresolved)].join(", ")}`);
    }
    if (problems.length > 0) {
      return { ok: false, error: problems.slice(0, MAX_REPORTED).join("; "), warnings: 0 };
    }
    return { ok: true, warnings: errors.length };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "error de parseo",
      warnings: 0,
    };
  }
}
