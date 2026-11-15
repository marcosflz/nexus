"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";
import { installRandomUuid } from "@/lib/uuid";

// Este módulo se carga en todas las páginas antes de pintar nada: es el sitio para
// completar lo que falta en el navegador cuando Nexus se sirve por HTTP.
installRandomUuid();

export function ThemeProvider(props: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props} />;
}
