/** Catálogo de motores de búsqueda. Sin dependencias: lo usan servidor e interfaz. */
export const SEARCH_PROVIDERS = [
  {
    id: "searxng",
    label: "SearXNG",
    needsKey: false,
    hasBaseUrl: true,
    description: "Autoalojado y gratuito. Depende de buscadores externos que pueden bloquear la IP del servidor.",
    docsUrl: "https://docs.searxng.org/",
  },
  {
    id: "langsearch",
    label: "LangSearch",
    needsKey: true,
    hasBaseUrl: false,
    description: "API alojada, gratuita con cupo diario y sin garantía de servicio. Tus consultas salen a un tercero.",
    docsUrl: "https://docs.langsearch.com/",
  },
  {
    id: "brave",
    label: "Brave Search",
    needsKey: true,
    hasBaseUrl: false,
    description: "API de pago por uso con índice propio. Tus consultas salen a un tercero.",
    docsUrl: "https://brave.com/search/api/",
  },
] as const;

export type SearchProviderId = (typeof SEARCH_PROVIDERS)[number]["id"];

export const SEARCH_PROVIDER_IDS = SEARCH_PROVIDERS.map((provider) => provider.id) as [
  SearchProviderId,
  ...SearchProviderId[],
];

export const searchProvider = (id: SearchProviderId) => SEARCH_PROVIDERS.find((provider) => provider.id === id)!;

export interface SearchProviderView {
  id: SearchProviderId;
  enabled: boolean;
  hasKey: boolean;
  /** Hay una clave guardada que ya no se puede descifrar. */
  keyUnreadable: boolean;
  baseUrl: string | null;
}

export interface SearchSettingsView {
  providers: SearchProviderView[];
  minResults: number;
}

/** Devuelve la lista con todos los motores del catálogo una sola vez, respetando el orden dado. */
export function completeOrder<T extends { id: SearchProviderId }>(items: T[], missing: (id: SearchProviderId) => T): T[] {
  const seen = new Set<SearchProviderId>();
  const known = SEARCH_PROVIDER_IDS as readonly string[];
  const ordered = items.filter((item) => {
    if (seen.has(item.id) || !known.includes(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return [...ordered, ...SEARCH_PROVIDER_IDS.filter((id) => !seen.has(id)).map(missing)];
}
