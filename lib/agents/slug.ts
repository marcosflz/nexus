/** Texto → slug ASCII en minúsculas (`Análisis Fiscal` → `analisis-fiscal`). */
export function slugify(text: string): string {
  const slug = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "agente";
}

/** Primer slug libre: `base`, `base-2`, `base-3`… */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * Menciona un agente al principio del mensaje: `@analista ¿qué opinas?`.
 * Devuelve el slug y el resto del texto, o null si no hay mención.
 */
export function parseMention(text: string): { slug: string; rest: string } | null {
  const match = /^\s*@([a-z0-9][a-z0-9-]{0,39})(?:\s+([\s\S]*))?$/i.exec(text);
  if (!match) return null;
  return { slug: match[1].toLowerCase(), rest: (match[2] ?? "").trim() };
}
