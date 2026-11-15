import { readEnv } from "@/lib/env";
import { openuiEnabled } from "@/lib/flags";
import { profileFor } from "./profiles";

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
  /** La instancia ofrece la UI en todos los turnos y el modelo decide si la usa. */
  auto?: boolean;
}

export function openuiToolsEnabled(context: OpenUiContext): boolean {
  if (!openuiEnabled()) return false;
  if (context.userToggle || context.auto) return true;
  if (context.mode === "research") return true;
  const focus = (context.focus ?? "").toLowerCase();
  return focus !== "" && defaultFocusSet().has(focus);
}
