/** Patrón de `LIKE` que busca `query` de forma literal (escapa `\`, `%` y `_`). */
export function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}
