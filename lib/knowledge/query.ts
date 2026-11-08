/**
 * Convierte una pregunta en lenguaje natural en una consulta `to_tsquery` con
 * semántica OR. `websearch_to_tsquery` exige TODAS las palabras, y una pregunta
 * como «¿cuál es el plazo de entrega?» casi nunca las contiene todas juntas en
 * un fragmento. Con OR, `ts_rank_cd` ordena por cuántas coinciden.
 */
const STOPWORDS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al", "y", "o", "u", "a",
  "en", "con", "por", "para", "que", "qué", "cual", "cuál", "es", "son", "se", "su", "sus", "lo",
  "como", "cómo", "me", "te", "mi", "tu", "the", "and", "or", "of", "to", "in", "is", "are", "for",
  "on", "with", "what", "how", "this", "that", "an",
]);

export function buildOrQuery(question: string): string | null {
  const terms = new Set<string>();
  for (const raw of question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    terms.add(raw);
    if (terms.size === 12) break;
  }
  if (terms.size === 0) return null;
  // Solo letras y números sobreviven, así que no hay operadores que escapar.
  return [...terms].map((term) => `${term}:*`).join(" | ");
}
