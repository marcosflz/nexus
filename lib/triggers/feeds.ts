import { createHash } from "node:crypto";

export interface FeedItem {
  id: string;
  title: string;
  link: string;
}

const decode = (text: string) =>
  text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

const tag = (block: string, name: string) =>
  new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block)?.[1];

/**
 * Elementos de un feed RSS 2.0 o Atom. No es un parser XML completo a
 * propósito: solo necesita título, enlace e identificador, y evita traer una
 * dependencia XML (con sus vectores de entidades externas) para ello.
 */
export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ];
  for (const [, block] of blocks) {
    const title = decode(tag(block, "title") ?? "");
    const atomLink = /<link[^>]*\shref=["']([^"']+)["'][^>]*>/i.exec(block)?.[1];
    const link = decode(tag(block, "link") ?? atomLink ?? "");
    const id = decode(tag(block, "guid") ?? tag(block, "id") ?? link ?? title);
    if (!id) continue;
    items.push({ id, title, link });
  }
  return items;
}

/** Elementos que no estaban en `seen`. La primera lectura (sin historial) no dispara nada. */
export function newItems(items: FeedItem[], seen: string[] | undefined): FeedItem[] {
  if (!seen) return [];
  const known = new Set(seen);
  return items.filter((item) => !known.has(item.id));
}

/** Texto visible de una página, para detectar cambios sin que el marcado cambiante dispare falsos positivos. */
export function visibleText(html: string): string {
  return html
    .replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const contentHash = (text: string) => createHash("sha256").update(text).digest("hex");
