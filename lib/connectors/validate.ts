import { hostOf, isPrivateHost } from "@/lib/policy/defaults";

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

/**
 * Valida la URL de un conector MCP.
 *
 * El sidecar abre esa URL desde dentro de la red de la instalación, así que una
 * URL apuntando a `db:5432`, `localhost` o a un endpoint de metadatos sería un
 * SSRF. Por defecto solo se admiten servidores públicos; `allowPrivate` (la
 * variable `NEXUS_ALLOW_PRIVATE_CONNECTORS`) lo permite para quien alojar sus
 * propios MCP en la red local, sabiendo lo que hace.
 */
export function checkConnectorUrl(raw: string, allowPrivate = false): UrlCheck {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, error: "La URL no es válida" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "Solo se admiten URLs http(s)" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "No incluyas credenciales en la URL: usa el campo de secreto" };
  }
  const host = hostOf(parsed.href);
  if (!host) return { ok: false, error: "La URL no tiene host" };
  if (!allowPrivate && (isPrivateHost(host) || !host.includes("."))) {
    return {
      ok: false,
      error: "Los conectores deben apuntar a un servidor público (no a la red local ni a un nombre interno)",
    };
  }
  if (parsed.protocol === "http:" && !allowPrivate) {
    return { ok: false, error: "Los conectores públicos deben usar https" };
  }
  return { ok: true, url: parsed.href };
}

/** Cabecera HTTP que autentica el conector, o ninguna. */
export function authHeaders(
  authType: "none" | "bearer" | "header",
  secret: string | null,
  headerName: string | null,
): Record<string, string> {
  if (!secret || authType === "none") return {};
  if (authType === "bearer") return { Authorization: `Bearer ${secret}` };
  const name = (headerName ?? "").trim();
  return /^[A-Za-z0-9-]{1,64}$/.test(name) ? { [name]: secret } : {};
}
