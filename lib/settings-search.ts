/** Quita tildes y pasa a minúsculas para buscar «busqueda» y encontrar «Búsqueda». */
export function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

/** ¿La sección de ajustes coincide con la búsqueda? Busca en la etiqueta y en las palabras clave. */
export function matchesSettings(query: string, label: string, keywords: string): boolean {
  const q = normalizeText(query);
  if (!q) return true;
  return normalizeText(`${label} ${keywords}`).includes(q);
}
