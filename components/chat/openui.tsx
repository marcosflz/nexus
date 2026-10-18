"use client";

import { createOpenUIPresent } from "@openuidev/assistant-ui";
import { OPENUI_TOOL_NAME } from "@/lib/openui/blocks";
import { plexoDarkTheme, plexoLibrary } from "@/lib/openui/library";

/**
 * Renderer de la UI generativa.
 *
 * El programa llega como argumento `ui` de una tool part `present_openui`
 * (extraída del texto del asistente). OpenUI se encarga del parseo, el estado
 * de los controles y el replay; aquí solo se fija la librería y el tema.
 */
export const OpenUIPresentTool = createOpenUIPresent({
  library: plexoLibrary,
  theme: { mode: "dark", darkTheme: plexoDarkTheme },
});

export { OPENUI_TOOL_NAME };
