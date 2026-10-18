export interface SourceItem {
  id: number;
  url: string;
  title?: string;
  domain: string;
}

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function cleanUrl(url: string): string {
  return url.replace(/[.,;:]+$/, "");
}

export function parseSourcesBlock(text: string): SourceItem[] {
  const match = text.match(/\n(?:#{1,6}\s*Sources\s*|Sources:\s*)\n([\s\S]*?)$/i);
  if (!match) return [];

  const items: SourceItem[] = [];
  for (const line of match[1].split("\n")) {
    const entry = line.match(/^\s*(?:[-*]\s*)?\[(\d+)\]\s*(.*)$/);
    if (!entry) continue;
    const rest = entry[2];
    const urlMatch = rest.match(URL_RE);
    if (!urlMatch) continue;
    const url = cleanUrl(urlMatch[0]);
    const title = rest.replace(urlMatch[0], "").replace(/[—–-]\s*$/, "").trim() || undefined;
    items.push({ id: Number(entry[1]), url, title, domain: domainOf(url) });
  }
  return items;
}

function walkForUrls(value: unknown, acc: { url: string; title?: string }[]): void {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) walkForUrls(item, acc);
    return;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const url =
      typeof obj.url === "string"
        ? obj.url
        : typeof obj.link === "string"
          ? obj.link
          : undefined;
    const title =
      typeof obj.title === "string"
        ? obj.title
        : typeof obj.name === "string"
          ? obj.name
          : undefined;
    if (url && /^https?:\/\//.test(url)) acc.push({ url, title });
    for (const nested of Object.values(obj)) walkForUrls(nested, acc);
  }
}

export function extractUrlsFromToolOutput(output: string): { url: string; title?: string }[] {
  const found: { url: string; title?: string }[] = [];

  const jsonStart = output.indexOf("{");
  const jsonEnd = output.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      walkForUrls(JSON.parse(output.slice(jsonStart, jsonEnd + 1)), found);
    } catch {
      // no era JSON; seguimos con regex
    }
  }

  if (found.length === 0) {
    for (const match of output.matchAll(URL_RE)) {
      found.push({ url: match[0] });
    }
  }

  const seen = new Set<string>();
  return found.filter((item) => {
    const url = cleanUrl(item.url);
    if (seen.has(url)) return false;
    seen.add(url);
    item.url = url;
    return true;
  });
}

export function buildSources(finalText: string, toolOutputs: string[]): SourceItem[] {
  const block = parseSourcesBlock(finalText);
  const seen = new Set(block.map((s) => s.url));
  let nextId = block.length > 0 ? Math.max(...block.map((s) => s.id)) + 1 : 1;

  const extra: SourceItem[] = [];
  for (const output of toolOutputs) {
    for (const { url, title } of extractUrlsFromToolOutput(output)) {
      if (seen.has(url)) continue;
      seen.add(url);
      extra.push({ id: nextId++, url, title, domain: domainOf(url) });
    }
  }

  return [...block, ...extra].slice(0, 30);
}
