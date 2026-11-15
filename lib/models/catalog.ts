import type { ModelEntry } from "@/lib/credentials";

/**
 * Los proveedores devuelven `{data:[{id, name?}]}`, `{models:[…]}` o una lista pelada.
 * Devuelve `{id, label}` sin duplicados, ordenados por id. `label` usa el nombre legible si lo hay.
 */
export function extractModelEntries(payload: unknown): ModelEntry[] {
  const entries = new Map<string, string>();

  const push = (item: unknown) => {
    if (typeof item === "string") {
      if (item.trim() && !entries.has(item.trim())) entries.set(item.trim(), item.trim());
      return;
    }
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const text = (key: string) => (typeof record[key] === "string" && (record[key] as string).trim()) || null;
    const id = text("id") ?? text("slug") ?? text("name");
    if (!id || entries.has(id)) return;
    entries.set(id, text("display_name") ?? text("displayName") ?? (text("id") ? text("name") : null) ?? id);
  };

  if (Array.isArray(payload)) {
    payload.forEach(push);
  } else if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const list = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : null;
    if (list) list.forEach(push);
  }

  return [...entries].map(([id, label]) => ({ id, label })).sort((a, b) => a.id.localeCompare(b.id));
}
