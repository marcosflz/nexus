/**
 * Citas inline estilo Perplexity: convierte `[1]`, `[2]` y `[1, 3]` del texto
 * del modelo en enlaces `#cite-N` que la UI pinta como chips con tarjeta de
 * fuente. Es un plugin remark (opera sobre el árbol, no sobre el texto crudo),
 * así que no toca el código, los enlaces ya escritos ni el streaming a medias.
 */
interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
  [key: string]: unknown;
}

const CITATION = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g;
const SKIP = new Set(["code", "inlineCode", "link", "linkReference", "definition", "html"]);

export const CITE_PREFIX = "#cite-";

export function citationNodes(text: string): MdNode[] | null {
  CITATION.lastIndex = 0;
  if (!CITATION.test(text)) return null;
  CITATION.lastIndex = 0;

  const out: MdNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(CITATION)) {
    const start = match.index ?? 0;
    if (start > cursor) out.push({ type: "text", value: text.slice(cursor, start) });
    for (const id of match[1].split(",").map((part) => part.trim())) {
      out.push({
        type: "link",
        url: `${CITE_PREFIX}${Number(id)}`,
        children: [{ type: "text", value: id }],
      });
    }
    cursor = start + match[0].length;
  }
  if (cursor < text.length) out.push({ type: "text", value: text.slice(cursor) });
  return out;
}

const isCite = (node: MdNode | undefined): node is MdNode =>
  node?.type === "link" && typeof node.url === "string" && node.url.startsWith(CITE_PREFIX);

/**
 * Une citas consecutivas (`[1][2]`, `[1, 3]`) en un solo enlace `#cite-1,3`, que
 * la UI pinta como un chip «dominio +N» al estilo Perplexity.
 */
export function mergeCitationRuns(nodes: MdNode[]): MdNode[] {
  const out: MdNode[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const prev = out[out.length - 1];
    if (isCite(node) && isCite(prev)) {
      const ids = [...new Set([...citationIdsOf(prev.url as string), ...citationIdsOf(node.url as string)])];
      out[out.length - 1] = { ...prev, url: `${CITE_PREFIX}${ids.join(",")}`, children: [{ type: "text", value: ids.join(",") }] };
      continue;
    }
    // Espacio entre dos citas: desaparece al unirlas.
    if (node.type === "text" && !node.value?.trim() && isCite(prev) && isCite(nodes[i + 1])) continue;
    out.push(node);
  }
  return out;
}

function visit(node: MdNode): void {
  if (!node.children || SKIP.has(node.type)) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string") {
      next.push(...(citationNodes(child.value) ?? [child]));
    } else {
      visit(child);
      next.push(child);
    }
  }
  node.children = mergeCitationRuns(next);
}

export function remarkCitations() {
  return (tree: MdNode) => visit(tree);
}

/** Números de fuente de un enlace `#cite-N` o `#cite-N,M`; vacío si no lo es. */
export function citationIdsOf(href: string | undefined): number[] {
  if (!href?.startsWith(CITE_PREFIX)) return [];
  const ids = href
    .slice(CITE_PREFIX.length)
    .split(",")
    .map((part) => Number(part));
  return ids.every((id) => Number.isInteger(id) && id > 0) ? ids : [];
}

/** Primer número de fuente de un enlace de cita, o null si no lo es. */
export function citationIdOf(href: string | undefined): number | null {
  return citationIdsOf(href)[0] ?? null;
}

const SOURCES_BLOCK = /\n+(?:#{1,6}\s*Sources\s*|Sources:\s*)\n[\s\S]*$/i;

/**
 * Quita del texto mostrado el bloque final `## Sources`: la UI ya enseña las
 * fuentes como chips y panel, y repetirlas como lista de enlaces es ruido. El
 * texto guardado no se toca.
 */
export function stripSourcesBlock(text: string): string {
  return text.replace(SOURCES_BLOCK, "").trimEnd();
}
