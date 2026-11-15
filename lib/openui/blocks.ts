/** Nombre del tool que assistant-ui usa para renderizar UI generativa. */
export const OPENUI_TOOL_NAME = "present_openui";

const WRAPPED_RE = /^\s*```[ \t]*(?:openui|oui)?[ \t]*\n([\s\S]*?)(?:\n[ \t]*```)?\s*$/i;

/**
 * Programa de un argumento `ui` de `present_openui`. Algunos modelos lo envuelven
 * en un bloque cercado aunque se les pida el programa a secas; aquí se desenvuelve.
 */
export function unwrapOpenUiProgram(ui: string): string {
  const match = WRAPPED_RE.exec(ui);
  return (match ? match[1] : ui).trim();
}
