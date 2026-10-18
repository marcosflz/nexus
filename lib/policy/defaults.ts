import type { PolicyRule, ActionRequest } from "./types";

/**
 * Extrae los hosts que una acción va a tocar, sea desde `target.host` o desde
 * los argumentos (url, urls, base_url…). Devuelve los que se puedan leer.
 */
export function hostsInArgs(args: unknown): string[] {
  const hosts: string[] = [];

  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (typeof nested === "string" && /^(url|uri|link|href|base_url|baseUrl|endpoint|target)$/i.test(key)) {
        const host = hostOf(nested);
        if (host) hosts.push(host);
      }
      visit(nested, depth + 1);
    }
  };

  visit(args, 0);
  return hosts;
}

export function hostOf(value: string): string | null {
  const candidate = value.includes("://") ? value : `https://${value}`;
  try {
    return new URL(candidate).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Hosts que un agente nunca debe alcanzar: la propia máquina, la red local y
 * los endpoints de metadatos de los proveedores de nube (el vector clásico
 * para robar credenciales desde una página inyectada).
 */
export function isPrivateHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return false;
  if (h === "localhost" || h === "::1" || h === "0.0.0.0" || h === "metadata") return true;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) return true;

  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

const READ_ONLY_BROWSER = new Set([
  "browser_navigate",
  "browser_snapshot",
  "browser_scroll",
  "browser_back",
  "browser_get_images",
  "browser_vision",
  "browser_console",
]);

const WRITE_BROWSER = new Set([
  "browser_click",
  "browser_type",
  "browser_press",
  "browser_exec",
  "browser_dialog",
  "browser_cdp",
]);

const READ_ONLY_WEB = new Set(["web_search", "web_extract"]);

const FILE_TOOLS = new Set(["read_file", "write_file", "patch", "search_files"]);
const TERMINAL_TOOLS = new Set(["terminal", "process_manage", "execute_code"]);

const AGENT_TOOLS = new Set([
  "clarify",
  "delegate_task",
  "todo",
  "memory",
  "session_search",
  "cronjob",
  "skill",
  "skills_list",
]);

const VAULT_TOOLS = /^browser_vault/;

/**
 * Reglas por defecto. El orden no decide: el motor aplica
 * `deny` > `ask` > `allow` sobre todas las que casen.
 */
export const DEFAULT_RULES: PolicyRule[] = [
  // --- Denegaciones primero: lo que nunca debe ocurrir ---
  {
    id: "deny-private-host",
    effect: "deny",
    reason: "La acción apunta a la red local o a un endpoint de metadatos.",
    when: (req) => {
      const hosts = [...(req.target?.host ? [req.target.host] : []), ...hostsInArgs(req.args)];
      return hosts.some(isPrivateHost);
    },
  },
  {
    id: "deny-vault",
    effect: "deny",
    reason: "Las credenciales del navegador no están habilitadas.",
    when: (req) => VAULT_TOOLS.test(req.tool),
  },
  {
    id: "deny-file-tools",
    effect: "deny",
    reason: "El acceso a ficheros todavía no está habilitado.",
    when: (req) => FILE_TOOLS.has(req.tool),
  },
  {
    id: "deny-terminal",
    effect: "deny",
    reason: "El terminal todavía no está habilitado.",
    when: (req) => TERMINAL_TOOLS.has(req.tool),
  },

  // --- Escrituras: siempre piden aprobación ---
  {
    id: "ask-browser-write",
    effect: "ask",
    reason: "La acción modifica el estado de una página web.",
    when: (req) => WRITE_BROWSER.has(req.tool),
  },
  {
    id: "ask-scheduled-write",
    effect: "ask",
    reason: "Una rutina programada quiere ejecutar una acción con efectos.",
    when: (req) => req.initiator === "routine" && !READ_ONLY_WEB.has(req.tool),
  },

  // --- Lecturas permitidas ---
  {
    id: "allow-web",
    effect: "allow",
    when: (req) => READ_ONLY_WEB.has(req.tool),
  },
  {
    id: "allow-browser-read",
    effect: "allow",
    when: (req) => READ_ONLY_BROWSER.has(req.tool),
  },
  {
    id: "allow-agent",
    effect: "allow",
    when: (req) => AGENT_TOOLS.has(req.tool),
  },
  // Sin coincidencia -> el motor deniega.
];

/** Herramientas que manejan el navegador; se bloquean si una persona lo conduce. */
export function isComputerTool(tool: string): boolean {
  return tool.startsWith("browser_");
}

export const POLICY_SUMMARY: Array<{ id: string; effect: string; reason?: string }> =
  DEFAULT_RULES.map(({ id, effect, reason }) => ({ id, effect, reason }));
