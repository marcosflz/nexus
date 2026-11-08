import { signSidecarRequest } from "@/lib/internal/token";
import type { ConnectorLink } from "@/lib/agents/backend";

export interface SandboxConfig {
  url: string;
}

/** URL de sandboxd o null si el ordenador de los agentes no está desplegado. */
export function sandboxConfig(env: Record<string, string | undefined> = process.env): SandboxConfig | null {
  const url = env.NEXUS_SANDBOXD_URL?.trim();
  if (!url || !env.NEXUS_AGENT_SECRET?.trim()) return null;
  return { url: url.replace(/\/$/, "") };
}

export const sandboxAvailable = () => sandboxConfig() !== null;

export interface SandboxDeps {
  fetch?: typeof fetch;
  config?: SandboxConfig | null;
  now?: () => number;
}

type EnsureResult = { ok: true; link: ConnectorLink } | { ok: false; error: string };

/**
 * Deja en marcha el navegador del agente y devuelve el conector MCP para
 * usarlo. Se llama al arrancar cada run: así el contenedor cuenta como activo
 * y sandboxd no lo apaga por inactividad a mitad de una tarea.
 */
export async function ensureBrowser(agentId: string, deps: SandboxDeps = {}): Promise<EnsureResult> {
  const config = deps.config === undefined ? sandboxConfig() : deps.config;
  if (!config) return { ok: false, error: "El ordenador de los agentes no está desplegado en esta instalación" };

  const body = "";
  try {
    const response = await (deps.fetch ?? fetch)(`${config.url}/v1/workspaces/${agentId}/ensure`, {
      method: "POST",
      body,
      headers: signSidecarRequest(body, { now: deps.now?.() }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) return { ok: false, error: `sandboxd respondió ${response.status}` };
    const data = (await response.json()) as { url: string };
    return {
      ok: true,
      link: { id: "sandbox", name: "browser", url: data.url, transport: "streamable-http", headers: {} },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo contactar con sandboxd" };
  }
}
