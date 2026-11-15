"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { OpenUIPresent, OpenUIPrompt } from "@openuidev/assistant-ui";
import { useTheme } from "next-themes";
import { OPENUI_TOOL_NAME } from "@/lib/openui/blocks";
import { nexusLibrary, normalizeOpenUiProgram } from "@/lib/openui/library";
import { nexusDarkTheme, nexusLightTheme } from "@/lib/openui/themes";

export const OPENUI_PROMPT_TOOL_NAME = "prompt_openui";

/** Tema de OpenUI según el tema activo de la app (claro u oscuro). */
function useOpenUiTheme() {
  const { resolvedTheme } = useTheme();
  return {
    mode: resolvedTheme === "light" ? ("light" as const) : ("dark" as const),
    lightTheme: nexusLightTheme,
    darkTheme: nexusDarkTheme,
  };
}

/**
 * Renderer de la UI generativa.
 *
 * El programa llega como argumento `ui` de una llamada a `present_openui` del
 * agente. OpenUI se encarga del parseo, el estado de los controles y
 * el replay; aquí solo se fija la librería y el tema.
 */
export const OpenUIPresentTool: ToolCallMessagePartComponent = (props) => {
  const theme = useOpenUiTheme();
  // Si el servidor rechazó el programa, no hay nada válido que pintar: el modelo reintenta o responde en texto.
  if (props.isError || rejected(props.result)) return null;
  const args = withProgram(props.args);
  if (!args.ui) return null;
  return (
    <div className="nexus-openui my-4">
      <OpenUIPresent
        {...(props as Parameters<typeof OpenUIPresent>[0])}
        args={args}
        library={nexusLibrary}
        theme={theme}
        ErrorFallback={RenderIssue}
      />
    </div>
  );
};

/**
 * Si aun así algo no se puede pintar, OpenUI muestra lo que sí puede. El aviso por
 * defecto de la librería (en inglés) no aporta nada a quien lee la respuesta, y un
 * argumento de más (que se descarta sin cambiar lo que se ve) no merece aviso.
 */
function RenderIssue({ errors }: { errors: readonly { code?: string }[] }) {
  if (errors.every((error) => error.code === "excess-args")) return null;
  return <p className="text-muted-fg mt-2 text-[12px]">Parte de esta interfaz no se ha podido mostrar.</p>;
}

/** El validador del sidecar devuelve `{"error": …}` como resultado (no como excepción). */
function rejected(result: unknown): boolean {
  return Boolean(result && typeof result === "object" && "error" in result);
}

function withProgram(args: unknown): { ui: string } {
  const ui = (args as { ui?: unknown } | undefined)?.ui;
  return { ...(args as object), ui: typeof ui === "string" ? normalizeOpenUiProgram(ui) : "" };
}

/**
 * Formulario o elección que pausa el run hasta que la persona lo envía. El
 * resultado vuelve por `addResult`, que el runtime convierte en una reanudación.
 */
export const OpenUIPromptTool: ToolCallMessagePartComponent = (props) => {
  const theme = useOpenUiTheme();
  return (
    <div className="nexus-openui">
      <OpenUIPrompt
        {...(props as Parameters<typeof OpenUIPrompt>[0])}
        args={withProgram(props.args)}
        library={nexusLibrary}
        theme={theme}
        ErrorFallback={RenderIssue}
      />
    </div>
  );
};

export { OPENUI_TOOL_NAME };
