import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { hostOf, isPrivateHost } from "@/lib/policy/defaults";

export type Resolver = (host: string) => Promise<string[]>;

export const systemResolver: Resolver = async (host) =>
  (await lookup(host, { all: true })).map((entry) => entry.address);

/** ¿La dirección IP es privada, de loopback, link-local, reservada o multicast? */
export function isBlockedAddress(address: string): boolean {
  const value = address.toLowerCase().split("%")[0];
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  const ip = mapped ? mapped[1] : value;

  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) || // 192.0.0.0/24 y TEST-NET
      a >= 224 // multicast y reservado
    );
  }
  if (isIP(ip) === 6) {
    return (
      ip === "::1" || ip === "::" ||
      ip.startsWith("fc") || ip.startsWith("fd") || // únicas locales
      ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb") || // link-local
      ip.startsWith("ff") // multicast
    );
  }
  return true; // lo que no es una IP interpretable se trata como sospechoso
}

export type GuardResult = { ok: true; url: URL } | { ok: false; error: string };

/**
 * Comprueba que una URL que el SERVIDOR va a consultar (feeds, páginas
 * vigiladas) apunta a un destino público. Resuelve el DNS y rechaza cualquier
 * dirección privada. Hay que llamarla en cada salto de redirección.
 */
export async function checkPublicUrl(raw: string, resolve: Resolver = systemResolver): Promise<GuardResult> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: "La URL no es válida" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: "Solo http(s)" };
  if (url.username || url.password) return { ok: false, error: "La URL no puede llevar credenciales" };

  const host = hostOf(url.href);
  if (!host || isPrivateHost(host)) return { ok: false, error: "El destino es una red privada" };

  const addresses = isIP(host) ? [host] : await resolve(host).catch(() => [] as string[]);
  if (addresses.length === 0) return { ok: false, error: `No se pudo resolver ${host}` };
  if (addresses.some(isBlockedAddress)) return { ok: false, error: "El destino resuelve a una red privada" };
  return { ok: true, url };
}

const MAX_BODY = 2_000_000;
const MAX_REDIRECTS = 4;

/** GET con guardia SSRF en cada salto, límite de tamaño y de tiempo. */
export async function fetchPublicText(
  raw: string,
  options: { resolve?: Resolver; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ ok: true; text: string; url: string } | { ok: false; error: string }> {
  const doFetch = options.fetchImpl ?? fetch;
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const checked = await checkPublicUrl(current, options.resolve);
    if (!checked.ok) return checked;
    let response: Response;
    try {
      response = await doFetch(checked.url, {
        redirect: "manual",
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
        headers: { "User-Agent": "NexusBot/0.1", Accept: "text/html,application/xml,application/rss+xml,application/atom+xml,text/*" },
      });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "No se pudo conectar" };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, error: "Redirección sin destino" };
      current = new URL(location, checked.url).href;
      continue;
    }
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const buffer = Buffer.from(await response.arrayBuffer());
    return { ok: true, text: buffer.subarray(0, MAX_BODY).toString("utf8"), url: checked.url.href };
  }
  return { ok: false, error: "Demasiadas redirecciones" };
}
