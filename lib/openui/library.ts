/**
 * Librería de componentes OpenUI de Plexo.
 *
 * Se parte de `openuiChatLibrary` de `@openuidev/react-ui`: 84 componentes ya
 * diseñados (tarjetas, gráficos, tablas, formularios, mapas, citas…) con su
 * tema claro/oscuro. Definirla a mano no aportaría nada y perdería el trabajo
 * de diseño que es justamente lo que buscamos.
 *
 * El prompt que genera esta librería es grande (~6,7k tokens de especificación
 * más ~6,7k de ejemplos), así que OpenUI se activa solo en los focos y modos
 * donde una respuesta rica aporta de verdad; ver `openuiToolsEnabled()`.
 */
import {
  defaultDarkTheme,
  defaultLightTheme,
  openuiChatLibrary,
  openuiChatPromptOptions,
} from "@openuidev/react-ui";

export const plexoLibrary = openuiChatLibrary;
export const plexoPromptOptions = openuiChatPromptOptions;
export const plexoDarkTheme = defaultDarkTheme;
export const plexoLightTheme = defaultLightTheme;

/** Componente raíz que el modelo debe usar (`root = Card([...])`). */
export const OPENUI_ROOT = plexoLibrary.root ?? "Card";
