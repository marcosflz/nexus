/**
 * Perfiles de la librería OpenUI.
 *
 * La especificación completa cuesta ~13k tokens de prompt (53k caracteres con
 * ejemplos). La mayoría de respuestas solo necesita tarjetas y texto, así que
 * se ofrecen subconjuntos por grupos de componentes y el modelo (o el BFF)
 * elige el que hace falta. Se construyen una vez, a nivel de módulo: los
 * parsers memorizan por identidad de librería.
 */
import { OPENUI_GROUPS } from "./groups";
import { nexusLibrary, nexusPromptOptions } from "./library";

export const OPENUI_PROFILES = ["minimal", "data", "forms", "lists", "full"] as const;
export type OpenUiProfile = (typeof OPENUI_PROFILES)[number];

export function isOpenUiProfile(value: unknown): value is OpenUiProfile {
  return typeof value === "string" && (OPENUI_PROFILES as readonly string[]).includes(value);
}

const BASE = ["Content", "Cards", "Layout", "Data Display"];

/** Grupos de `openuiChatLibrary` que conserva cada perfil. */
const PROFILE_GROUPS: Record<Exclude<OpenUiProfile, "full">, string[]> = {
  minimal: BASE,
  data: [...BASE, "Tables", "Charts (2D)", "Charts (1D)", "Charts (Scatter)"],
  forms: [...BASE, "Forms", "Buttons"],
  lists: [...BASE, "Lists & Follow-ups", "Sections"],
};

function librariesByProfile() {
  const libraries = { full: nexusLibrary } as Record<OpenUiProfile, typeof nexusLibrary>;

  for (const [profile, keep] of Object.entries(PROFILE_GROUPS)) {
    for (const name of keep) {
      if (!(name in OPENUI_GROUPS)) throw new Error(`Grupo OpenUI desconocido: ${name}`);
    }
    const kept = new Set(keep);
    const remove = Object.entries(OPENUI_GROUPS)
      .filter(([name]) => !kept.has(name))
      .flatMap(([, components]) => components)
      // Solo se pueden quitar componentes que la librería realmente tiene.
      .filter((component) => component in nexusLibrary.components);
    libraries[profile as OpenUiProfile] = extendWithout(remove);
  }
  return libraries;
}

/**
 * Quita componentes de la librería base. `extend` se niega a dejar una propiedad
 * sin tipo (p. ej. `Tag.icon` solo admite `Icon`): cuando eso ocurre, el
 * componente requerido se conserva y se reintenta, en vez de mantener a mano
 * el grafo de dependencias de 84 componentes.
 */
function extendWithout(remove: string[]): typeof nexusLibrary {
  const pending = new Set(remove);
  for (let attempt = 0; attempt <= remove.length; attempt += 1) {
    try {
      return nexusLibrary.extend!({ components: { remove: [...pending] } }) as never;
    } catch (error) {
      const blocked = /Cannot remove "([^"]+)"/.exec(error instanceof Error ? error.message : "");
      if (!blocked || !pending.delete(blocked[1])) throw error;
    }
  }
  throw new Error("No se pudo construir el perfil de OpenUI");
}

export const openUiLibraries = librariesByProfile();

const promptCache = new Map<OpenUiProfile, string>();

/**
 * Especificación de componentes de un perfil. Sin ejemplos: duplican el coste
 * y el modelo ya sabe componer a partir de la gramática.
 */
export function openUiSpec(profile: OpenUiProfile): string {
  let cached = promptCache.get(profile);
  if (cached === undefined) {
    cached = openUiLibraries[profile].prompt({
      ...nexusPromptOptions,
      examples: [],
      toolExamples: [],
    });
    promptCache.set(profile, cached);
  }
  return cached;
}

/** Perfil por defecto según el contexto de la pregunta. */
export function profileFor(context: {
  focus?: string | null;
  mode?: string | null;
  userToggle?: boolean;
  /** Perfil de la instancia cuando la UI se ofrece en todos los turnos. */
  autoProfile?: OpenUiProfile | null;
}): OpenUiProfile {
  if (context.userToggle) return "full";
  if (context.autoProfile) return context.autoProfile;
  if (context.mode === "research" || context.focus === "finance") return "data";
  return "minimal";
}
