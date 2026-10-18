export interface FocusOption {
  id: string;
  label: string;
  instruction: string;
}

export const FOCUS_OPTIONS: FocusOption[] = [
  {
    id: "web",
    label: "Web",
    instruction: "",
  },
  {
    id: "academic",
    label: "Académico",
    instruction:
      "Enfoca la búsqueda a fuentes académicas y revisadas por pares (arxiv.org, pubmed.ncbi.nlm.nih.gov, nature.com, sciencedirect.com, ieee.org). Evita blogs y contenido promocional.",
  },
  {
    id: "reddit",
    label: "Reddit",
    instruction:
      "Enfoca la búsqueda a discusiones y experiencias de usuarios reales (reddit.com y foros afines). Distingue claramente opinión de hechos y cita el hilo concreto.",
  },
  {
    id: "finance",
    label: "Finanzas",
    instruction:
      "Enfoca la búsqueda a fuentes financieras primarias y de mercado (sec.gov/EDGAR, informes de resultados, reuters.com, bloomberg.com). Indica siempre la fecha de los datos.",
  },
  {
    id: "news",
    label: "Noticias",
    instruction:
      "Enfoca la búsqueda a noticias recientes (últimos 7 días) de medios verificables (reuters.com, apnews.com, bbc.com, elpais.com). Indica la fecha de publicación de cada fuente.",
  },
];

export const FOCUS_IDS = FOCUS_OPTIONS.map((option) => option.id) as [
  string,
  ...string[],
];

export const SEARCH_MODES = ["search", "research"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

export function focusInstruction(id: string): string | null {
  const option = FOCUS_OPTIONS.find((item) => item.id === id);
  return option && option.instruction ? option.instruction : null;
}

export function researchInstruction(): string {
  return [
    "Modo Research: descompón la pregunta en subconsultas, ejecuta varias búsquedas y lecturas,",
    "contrasta las fuentes y escribe un informe estructurado en Markdown: introducción breve,",
    "secciones con encabezados, tabla comparativa si aporta, conclusión y una lista final",
    "`## Sources` con todas las fuentes citadas [n].",
  ].join(" ");
}
