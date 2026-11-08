import { FOCUS_IDS } from "@/lib/focus";

export interface Prefs {
  focus: string;
  mode: "search" | "research";
  ui: boolean;
}

export const DEFAULT_PREFS: Prefs = { focus: "web", mode: "search", ui: false };
export const PREFS_KEY = "nexus.prefs";
export const PREFS_EVENT = "nexus:prefs";

/** Lee las preferencias de un JSON guardado; cualquier valor raro vuelve al predeterminado. */
export function parsePrefs(raw: string | null): Prefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const data = JSON.parse(raw) as Partial<Prefs>;
    return {
      focus: typeof data.focus === "string" && FOCUS_IDS.includes(data.focus) ? data.focus : DEFAULT_PREFS.focus,
      mode: data.mode === "research" ? "research" : "search",
      ui: data.ui === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function readPrefs(): Prefs {
  try {
    return parsePrefs(window.localStorage.getItem(PREFS_KEY));
  } catch {
    return DEFAULT_PREFS;
  }
}

export function writePrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...readPrefs(), ...patch };
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    // Modo privado o almacenamiento bloqueado: se aplica solo en esta sesión.
  }
  window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: next }));
  return next;
}
