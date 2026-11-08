import { BarChart3, Bot, CircleUser, Inbox, KeyRound, Plug, SlidersHorizontal, type LucideIcon } from "lucide-react";
import type { SettingsSection } from "@/components/shell/shell-context";

export interface SettingsNavItem {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group: "Cuenta" | "Agentes";
  keywords: string;
}
export interface SettingsNavLink {
  href: string;
  label: string;
  icon: LucideIcon;
  keywords: string;
}

export const SETTINGS_ITEMS: SettingsNavItem[] = [
  { id: "account", label: "Cuenta", icon: CircleUser, group: "Cuenta", keywords: "email correo sesión cerrar seguridad cifrado" },
  { id: "preferences", label: "Preferencias", icon: SlidersHorizontal, group: "Cuenta", keywords: "tema apariencia oscuro claro fuente búsqueda modo research interfaz" },
  { id: "models", label: "Modelos y claves", icon: KeyRound, group: "Cuenta", keywords: "proveedor api key clave modelo openrouter openai anthropic base url local" },
  { id: "usage", label: "Uso", icon: BarChart3, group: "Cuenta", keywords: "tokens ejecuciones consumo actividad" },
  { id: "connectors", label: "Conectores", icon: Plug, group: "Agentes", keywords: "mcp servidor herramientas integraciones" },
];

export const SETTINGS_LINKS: SettingsNavLink[] = [
  { href: "/agents", label: "Agentes", icon: Bot, keywords: "asistentes galería" },
  { href: "/inbox", label: "Bandeja", icon: Inbox, keywords: "notificaciones aprobaciones" },
];
