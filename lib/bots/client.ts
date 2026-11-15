import { signSidecarRequest } from "@/lib/internal/token";
import type { ConnectorLink } from "@/lib/agents/backend";
import { sandboxConfig, type SandboxDeps } from "@/lib/sandbox/client";
import type { BotConfig, BotRuntimeReport } from "./spec";

export type BotCall<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

const unavailable = "Los NexBots no están desplegados en esta instalación";

async function send(
  method: "GET" | "POST",
  path: string,
  payload: unknown,
  deps: SandboxDeps,
  timeoutMs: number,
): Promise<Response | { failure: string; status: number }> {
  const config = deps.config === undefined ? sandboxConfig() : deps.config;
  if (!config) return { failure: unavailable, status: 503 };
  const body = payload === undefined ? "" : JSON.stringify(payload);
  try {
    return await (deps.fetch ?? fetch)(`${config.url}${path}`, {
      method,
      body: method === "GET" ? undefined : body,
      headers: {
        ...signSidecarRequest(body, { now: deps.now?.() }),
        ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { failure: error instanceof Error ? error.message : "No se pudo contactar con sandboxd", status: 502 };
  }
}

async function call<T>(
  method: "GET" | "POST",
  path: string,
  payload: unknown,
  deps: SandboxDeps = {},
  timeoutMs = 90_000,
): Promise<BotCall<T>> {
  const response = await send(method, path, payload, deps, timeoutMs);
  if (!(response instanceof Response)) return { ok: false, status: response.status, error: response.failure };
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    const error = typeof detail?.detail === "string" ? detail.detail : `sandboxd respondió ${response.status}`;
    return { ok: false, status: response.status, error };
  }
  return { ok: true, data: (await response.json()) as T };
}

export const ensureBot = (id: string, options: BotConfig, deps?: SandboxDeps) =>
  call<BotRuntimeReport>("POST", `/v1/bots/${id}/ensure`, { options }, deps);

export const recreateBot = (id: string, options: BotConfig, deps?: SandboxDeps) =>
  call<BotRuntimeReport>("POST", `/v1/bots/${id}/recreate`, { options }, deps, 120_000);

export const stopBot = (id: string, deps?: SandboxDeps) =>
  call<{ ok: boolean }>("POST", `/v1/bots/${id}/stop`, undefined, deps, 40_000);

export const destroyBot = (id: string, purge: boolean, deps?: SandboxDeps) =>
  call<{ ok: boolean }>("POST", `/v1/bots/${id}/destroy?purge=${purge ? "true" : "false"}`, undefined, deps);

export const botReport = (id: string, deps?: SandboxDeps) =>
  call<BotRuntimeReport>("GET", `/v1/bots/${id}/status`, undefined, deps, 15_000);

export const botContainerLogs = (id: string, tail: number, deps?: SandboxDeps) =>
  call<{ logs: string }>("GET", `/v1/bots/${id}/container-logs?tail=${tail}`, undefined, deps, 15_000);

/** Llamada a la API del runtime del bot, a través de sandboxd. */
export function botApi<T>(
  id: string,
  method: "GET" | "POST",
  path: string,
  payload?: unknown,
  deps?: SandboxDeps,
): Promise<BotCall<T>> {
  return call<T>(method, `/v1/bots/${id}/api/${path}`, payload, deps, 30_000);
}

/** Descarga un fichero del workspace. Devuelve la respuesta tal cual para transmitirla. */
export async function botFile(id: string, path: string, deps: SandboxDeps = {}): Promise<Response | null> {
  const response = await send("GET", `/v1/bots/${id}/api/files/content?path=${encodeURIComponent(path)}`, undefined, deps, 60_000);
  return response instanceof Response && response.ok ? response : null;
}

/** Abre la emisión del escritorio. Dura lo que dure `signal`: la cierra quien la consume. */
export async function botDesktopStream(
  id: string,
  fps: number,
  signal: AbortSignal,
  deps: SandboxDeps = {},
): Promise<Response | { failure: string; status: number }> {
  const config = deps.config === undefined ? sandboxConfig() : deps.config;
  if (!config) return { failure: unavailable, status: 503 };
  try {
    const response = await (deps.fetch ?? fetch)(`${config.url}/v1/bots/${id}/desktop/stream?fps=${fps}`, {
      headers: signSidecarRequest("", { now: deps.now?.() }),
      signal,
      cache: "no-store",
    });
    if (response.ok) return response;
    const detail = await response.json().catch(() => null);
    return {
      failure: typeof detail?.detail === "string" ? detail.detail : `sandboxd respondió ${response.status}`,
      status: response.status,
    };
  } catch (error) {
    return { failure: error instanceof Error ? error.message : "No se pudo contactar con sandboxd", status: 502 };
  }
}

/** Un fotograma JPEG de la pantalla, o null si el bot no tiene escritorio disponible. */
export async function botDesktopFrame(id: string, deps: SandboxDeps = {}): Promise<Response | null> {
  const response = await send("GET", `/v1/bots/${id}/api/desktop/frame`, undefined, deps, 15_000);
  return response instanceof Response && response.ok ? response : null;
}

/** Conector MCP del bot para un run, o null si el bot no está en marcha. */
export async function botConnector(id: string, deps?: SandboxDeps): Promise<ConnectorLink | null> {
  const link = await call<{ url: string; headers: Record<string, string> }>("GET", `/v1/bots/${id}/mcp-link`, undefined, deps, 15_000);
  if (!link.ok) return null;
  return { id: "nexbot", name: "nexbot", url: link.data.url, transport: "streamable-http", headers: link.data.headers };
}

/** Pixel-based tools belong to computer/room mode, whose adapter handles images. */
export async function standardBotConnector(id: string): Promise<ConnectorLink | null> {
  const link = await botConnector(id);
  return link ? { ...link, allowTools: ["browser_navigate", "browser_snapshot", "browser_click", "browser_type", "browser_press", "browser_scroll", "browser_screenshot", "workspace_list", "workspace_read", "workspace_write", "shell_exec"] } : null;
}
