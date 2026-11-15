/**
 * Librería de componentes OpenUI de Nexus.
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
import { openuiChatLibrary, openuiChatPromptOptions } from "@openuidev/react-ui/genui-lib";
import { unwrapOpenUiProgram } from "./blocks";
import { argumentOrderOf, positionalArguments, type ArgumentOrder } from "./named-args";

// OJO: se importa de `/genui-lib`, no de la raíz del paquete. La raíz lleva
// "use client", y desde el servidor de Next (rutas /api, prompts, validación)
// llega como una referencia vacía: sin `components`, sin `prompt()`. El
// subpath `genui-lib` es la misma librería sin esa directiva. Los temas, que
// solo hacen falta en el navegador, viven en `themes.ts`.
export const nexusLibrary = openuiChatLibrary;
export const nexusPromptOptions = openuiChatPromptOptions;

/** Componente raíz que el modelo debe usar (`root = Card([...])`). */
export const OPENUI_ROOT = nexusLibrary.root ?? "Card";

let argumentOrder: ArgumentOrder | null = null;

/**
 * Programa tal y como se valida y se pinta: sin el bloque cercado y con los
 * argumentos con nombre pasados a posicionales. Servidor y navegador aplican
 * lo mismo, así que lo que el validador da por bueno es lo que se ve.
 */
export function normalizeOpenUiProgram(ui: string): string {
  argumentOrder ??= argumentOrderOf(nexusLibrary.toJSONSchema());
  return positionalArguments(unwrapOpenUiProgram(ui), argumentOrder);
}
