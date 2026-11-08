import { readEnv } from "@/lib/env";
import { openuiEnabled } from "@/lib/flags";
import { openUiSpec, profileFor, type OpenUiProfile } from "./profiles";

/**
 * Convención con la que el modelo entrega la interfaz.
 *
 * Hermes solo expone sus propias herramientas, así que la app no puede
 * registrar un tool `present_openui` que el modelo pueda invocar. La solución
 * es un bloque de código cercado que `lib/openui/blocks.ts` extrae y convierte
 * en una tool part de assistant-ui.
 *
 * Si en el futuro se expone el mismo contrato por MCP, basta con registrar el
 * servidor en el perfil de Hermes: la UI no cambia.
 */
const FENCE_CONVENTION = [
  "## Cómo entregar una interfaz",
  "",
  "No dispones de ninguna herramienta para mostrar interfaces. Cuando una respuesta",
  "se entienda mejor con una interfaz (un itinerario, una comparativa, un gráfico,",
  "una tabla, un formulario), escribe el programa OpenUI dentro de un bloque de",
  "código cercado con la etiqueta `openui`, en sus propias líneas:",
  "",
  "```openui",
  "root = Card([titulo, cuerpo])",
  'titulo = CardHeader("Título breve", "Subtítulo")',
  'cuerpo = TextContent("Contenido de la tarjeta.")',
  "```",
  "",
  "Reglas del bloque:",
  "",
  "- Como mucho **un** bloque `openui` por respuesta, y solo si aporta de verdad.",
  "- El bloque empieza siempre por `root =` y es autónomo: define todo lo que usa.",
  "- No metas prosa ni citas dentro del bloque; la respuesta en texto va fuera.",
  "- Escribe la respuesta normal (con sus citas [n]) antes o después del bloque, no dentro.",
  "- Si dudas de la sintaxis, no lo emitas: una respuesta de texto correcta es mejor",
  "  que una interfaz rota.",
].join("\n");

const cached = new Map<OpenUiProfile, string>();

/**
 * Prompt de OpenUI (especificación del perfil + convención de entrega).
 *
 * Por defecto el perfil completo; el BFF elige uno más pequeño según el
 * contexto (`profileFor`) para no pagar ~13k tokens en cada pregunta.
 */
export function openuiInstructions(profile: OpenUiProfile = "full"): string {
  let text = cached.get(profile);
  if (text === undefined) {
    text = `${openUiSpec(profile)}\n\n${FENCE_CONVENTION}`;
    cached.set(profile, text);
  }
  return text;
}

export { profileFor };

/**
 * Focos donde la UI generativa se activa por defecto. Configurable porque el
 * prompt cuesta tokens del usuario.
 */
function defaultFocusSet(): Set<string> {
  const raw = readEnv("NEXUS_OPENUI_FOCUS", "PLEXO_OPENUI_FOCUS") ?? "finance,news";
  return new Set(
    raw
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

export interface OpenUiContext {
  focus?: string | null;
  mode?: string | null;
  /** El usuario lo ha pedido explícitamente en el compositor. */
  userToggle?: boolean;
}

export function openuiToolsEnabled(context: OpenUiContext): boolean {
  if (!openuiEnabled()) return false;
  if (context.userToggle) return true;
  if (context.mode === "research") return true;
  const focus = (context.focus ?? "").toLowerCase();
  return focus !== "" && defaultFocusSet().has(focus);
}
