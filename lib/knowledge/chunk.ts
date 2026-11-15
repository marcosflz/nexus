/**
 * Troceado de documentos para la base de conocimiento de un agente.
 *
 * Fragmentos de ~800 tokens (≈ 3200 caracteres) con solape, cortando por
 * párrafos cuando se puede: un fragmento que empieza a mitad de una frase
 * recupera peor. El conteo de tokens es una estimación de 4 caracteres/token.
 */
export interface ChunkOptions {
  targetChars?: number;
  overlapChars?: number;
}

const DEFAULT_TARGET = 3200;
const DEFAULT_OVERLAP = 400;

/** Parte un párrafo demasiado largo respetando, si puede, el final de una frase. */
function splitLong(paragraph: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = paragraph;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("\n"), window.lastIndexOf("; "));
    const at = cut > max * 0.5 ? cut + 1 : max;
    pieces.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const target = options.targetChars ?? DEFAULT_TARGET;
  const overlap = Math.min(options.overlapChars ?? DEFAULT_OVERLAP, Math.floor(target / 2));

  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => (p.length > target ? splitLong(p, target) : [p]));

  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > target) {
      chunks.push(current);
      // El solape son los últimos caracteres del fragmento anterior, desde una frontera de palabra.
      const tail = current.slice(-overlap);
      const space = tail.indexOf(" ");
      current = `${space > 0 ? tail.slice(space + 1) : tail}\n\n${paragraph}`;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}
