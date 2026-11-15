"use client";

import { defaultDarkTheme, defaultLightTheme } from "@openuidev/react-ui";

/**
 * Paletas de los gráficos: las mismas de `app/tokens.css` (--chart-1…6). Sin ellas,
 * OpenUI pinta todas las series con una rampa de azules casi indistinguibles.
 * Se repiten aquí con valores literales porque la librería calcula contrastes con
 * el color resuelto y no lee variables CSS.
 */
// Orden pensado para `getDistributedColors`, que reparte desde el centro: una serie
// sale en el turquesa de la marca; dos, en azul y verde; tres, azul, turquesa y verde.
const LIGHT_CHART = [
  "oklch(0.68 0.17 330)",
  "oklch(0.64 0.18 25)",
  "oklch(0.66 0.15 260)",
  "oklch(0.62 0.12 205)",
  "oklch(0.70 0.15 152)",
  "oklch(0.78 0.15 85)",
];

const DARK_CHART = [
  "oklch(0.76 0.16 330)",
  "oklch(0.72 0.17 25)",
  "oklch(0.74 0.13 260)",
  "oklch(0.74 0.12 205)",
  "oklch(0.76 0.14 152)",
  "oklch(0.82 0.14 85)",
];

/**
 * Solo los gráficos de series: el mapa de calor y el calendario leen
 * `defaultChartPalette` como rampa secuencial y con colores categóricos no se leería.
 */
function seriesPalettes(colors: string[]) {
  return {
    barChartPalette: colors,
    horizontalBarChartPalette: colors,
    lineChartPalette: colors,
    areaChartPalette: colors,
    pieChartPalette: colors,
    radarChartPalette: colors,
    radialChartPalette: colors,
  };
}

/** Temas de OpenUI. Solo se usan en componentes de cliente. */
export const nexusLightTheme = { ...defaultLightTheme, ...seriesPalettes(LIGHT_CHART) };
export const nexusDarkTheme = { ...defaultDarkTheme, ...seriesPalettes(DARK_CHART) };
