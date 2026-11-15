import { BadgeCheck, BarChart3, Bot, BrainCircuit, CircleUser, Globe, Inbox, KeyRound, Plug, SlidersHorizontal, Sparkles, Users, type LucideIcon } from "lucide-react";
import type { Permission } from "@/lib/access";
import type { SettingsSection } from "@/components/shell/shell-context";

export interface SettingsNavItem {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group: "Cuenta" | "Herramientas" | "Administración";
  keywords: string;
  adminOnly?: boolean;
  superadminOnly?: boolean;
  permission?: Permission;
}
export interface SettingsNavLink {
  href: string;
  label: string;
  icon: LucideIcon;
  keywords: string;
  permission?: Permission;
  adminOnly?: boolean;
}

export const SETTINGS_ITEMS: SettingsNavItem[] = [
  { id: "account", label: "Cuenta", icon: CircleUser, group: "Cuenta", keywords: "email correo sesión cerrar seguridad cifrado" },
  { id: "preferences", label: "Preferencias", icon: SlidersHorizontal, group: "Cuenta", keywords: "tema apariencia oscuro claro fuente búsqueda modo research interfaz" },
  { id: "models", label: "Claves de API", icon: KeyRound, group: "Cuenta", keywords: "modelos proveedor api key clave modelo openrouter openai anthropic gemini deepseek base url local" },
  { id: "subscriptions", label: "Suscripciones", icon: BadgeCheck, group: "Cuenta", keywords: "suscripción plan claude code chatgpt codex opencode go cuenta vincular modelos" },
  { id: "usage", label: "Uso", icon: BarChart3, group: "Cuenta", keywords: "tokens ejecuciones consumo actividad" },
  { id: "connectors", label: "Conectores", icon: Plug, group: "Herramientas", keywords: "mcp servidor herramientas integraciones", permission: "connectors" },
  { id: "search", label: "Búsqueda web", icon: Globe, group: "Administración", keywords: "motores searxng langsearch brave buscador api clave respaldo", adminOnly: true },
  { id: "assistant", label: "Asistente", icon: BrainCircuit, group: "Administración", keywords: "prompt sistema instrucciones interfaz generativa ui gráficos temperatura tokens razonamiento pasos contexto modelo", superadminOnly: true },
  { id: "claudeCode", label: "Claude Code", icon: Sparkles, group: "Administración", keywords: "suscripción claude code límites", superadminOnly: true },
];

export const SETTINGS_LINKS: SettingsNavLink[] = [
  { href: "/skills", label: "Skills", icon: Bot, keywords: "skills habilidades procedimientos biblioteca galería", permission: "skills" },
  { href: "/inbox", label: "Bandeja", icon: Inbox, keywords: "notificaciones aprobaciones" },
  { href: "/admin/users", label: "Usuarios", icon: Users, keywords: "cuentas admin superadmin administrador permisos contraseña cupo tokens modelos sesiones", adminOnly: true },
];
