/** Fuente citada en una respuesta. El sidecar la numera y la anuncia (`nexus.sources`). */
export interface SourceItem {
  id: number;
  url: string;
  title?: string;
  domain: string;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Las respuestas guardadas por el motor anterior terminaban con un bloque
 * `## Follow-ups`; la vista compartida lo oculta. Los turnos nuevos usan la
 * herramienta `suggest_followups`.
 */
const FOLLOWUPS_HEADING = /\n+#{1,6}\s*Follow[-\s]?ups?\b[^\n]*(?:\n|$)/i;

/** Texto sin el bloque de follow-ups (que va al final de la respuesta). */
export function stripFollowupsBlock(text: string): string {
  const match = FOLLOWUPS_HEADING.exec(text);
  return match ? text.slice(0, match.index).trimEnd() : text;
}

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "gob", "ac", "edu"]);

/** Nombre corto de un dominio para las citas: «es.wikipedia.org» → «wikipedia», «bbc.co.uk» → «bbc». */
export function shortDomain(url: string): string {
  const host = domainOf(url);
  if (!host) return "";
  const parts = host.split(".");
  if (parts.length < 2) return host;
  const candidate = parts[parts.length - 2];
  if (SECOND_LEVEL.has(candidate) && parts.length >= 3) return parts[parts.length - 3];
  return candidate;
}
