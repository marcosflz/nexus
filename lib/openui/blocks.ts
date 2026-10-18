/** Nombre del tool que assistant-ui usa para renderizar UI generativa. */
export const OPENUI_TOOL_NAME = "present_openui";

export interface OpenUiTextSegment {
  type: "text";
  text: string;
}

export interface OpenUiBlockSegment {
  type: "openui";
  /** Índice del bloque dentro del mensaje. Es estable durante el streaming. */
  index: number;
  program: string;
  /** `false` mientras el modelo sigue escribiendo el programa. */
  closed: boolean;
}

export type OpenUiSegment = OpenUiTextSegment | OpenUiBlockSegment;

const OPEN_RE = /^\s*```\s*(openui|oui)\s*$/i;
const CLOSE_RE = /^\s*```\s*$/;

/**
 * Separa el texto del asistente en prosa y bloques de UI generativa.
 *
 * El modelo no puede llamar a herramientas propias de la app (Hermes solo
 * expone las suyas), así que el contrato es un bloque de código cercado:
 *
 *     ```openui
 *     Card(Title("…"), Chart(…))
 *     ```
 *
 * Es una función pura: se recalcula sobre el texto acumulado en cada delta, de
 * modo que el resultado es idéntico en streaming, al recargar desde la base de
 * datos y en los tests.
 */
export function splitOpenUiBlocks(text: string): OpenUiSegment[] {
  const segments: OpenUiSegment[] = [];
  const chunks = text.split(/(?<=\n)/);

  let mode: "text" | "fence" = "text";
  let pending = "";
  let program = "";
  let index = 0;

  for (const chunk of chunks) {
    const bare = chunk.endsWith("\n") ? chunk.slice(0, -1) : chunk;

    if (mode === "text") {
      if (OPEN_RE.test(bare)) {
        if (pending) {
          segments.push({ type: "text", text: pending });
          pending = "";
        }
        mode = "fence";
        program = "";
      } else {
        pending += chunk;
      }
      continue;
    }

    if (CLOSE_RE.test(bare)) {
      segments.push({
        type: "openui",
        index: index++,
        program: program.trim(),
        closed: true,
      });
      mode = "text";
      program = "";
    } else {
      program += chunk;
    }
  }

  if (mode === "fence") {
    segments.push({
      type: "openui",
      index: index++,
      program: program.trim(),
      closed: false,
    });
  } else if (pending) {
    segments.push({ type: "text", text: pending });
  }

  return segments;
}

/** Texto sin los bloques de UI, para mostrarlo como prosa. */
export function proseOf(text: string): string {
  return splitOpenUiBlocks(text)
    .filter((segment): segment is OpenUiTextSegment => segment.type === "text")
    .map((segment) => segment.text)
    .join("")
    .replace(/\n{3,}/g, "\n\n");
}
