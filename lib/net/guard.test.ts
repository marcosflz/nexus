import { describe, expect, it } from "vitest";
import { checkPublicUrl, fetchPublicText, isBlockedAddress, type Resolver } from "./guard";

const resolveTo =
  (map: Record<string, string[]>): Resolver =>
  async (host) => {
    if (!(host in map)) throw new Error("NXDOMAIN");
    return map[host];
  };
const dns = resolveTo({ "ok.test": ["93.184.216.34"], "evil.test": ["93.184.216.34", "10.0.0.5"], "meta.test": ["169.254.169.254"] });

describe("isBlockedAddress", () => {
  it.each([
    "10.1.2.3", "127.0.0.1", "192.168.0.1", "172.16.5.5", "172.31.255.255", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fd00::5", "::ffff:127.0.0.1", "no-es-ip",
  ])("bloquea %s", (address) => expect(isBlockedAddress(address)).toBe(true));

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111"])("permite %s", (address) =>
    expect(isBlockedAddress(address)).toBe(false),
  );
});

describe("checkPublicUrl", () => {
  it("acepta un host público", async () => {
    expect((await checkPublicUrl("https://ok.test/feed.xml", dns)).ok).toBe(true);
  });

  it("rechaza destinos privados, mixtos, sin resolver o con credenciales", async () => {
    for (const url of [
      "http://localhost/x", "http://127.0.0.1/x", "http://[::1]/x", "http://192.168.1.1/",
      "https://evil.test/", "https://meta.test/", "https://nope.test/", "ftp://ok.test/",
      "https://u:p@ok.test/", "no es url",
    ]) {
      expect((await checkPublicUrl(url, dns)).ok, url).toBe(false);
    }
  });
});

describe("fetchPublicText", () => {
  const text = (body: string, init: ResponseInit = {}) => new Response(body, init);

  it("lee el cuerpo de una URL pública", async () => {
    const result = await fetchPublicText("https://ok.test/a", { resolve: dns, fetchImpl: async () => text("hola") });
    expect(result).toEqual({ ok: true, text: "hola", url: "https://ok.test/a" });
  });

  it("revalida cada redirección: una página pública no puede llevar a la red interna", async () => {
    const calls: string[] = [];
    const result = await fetchPublicText("https://ok.test/r", {
      resolve: dns,
      fetchImpl: async (url) => {
        calls.push(String(url));
        return text("", { status: 302, headers: { location: "http://169.254.169.254/latest" } });
      },
    });
    expect(result.ok).toBe(false);
    expect(calls).toEqual(["https://ok.test/r"]); // nunca llegó a pedir el destino interno
  });

  it("corta bucles de redirección y errores HTTP", async () => {
    const loop = await fetchPublicText("https://ok.test/l", {
      resolve: dns,
      fetchImpl: async () => text("", { status: 301, headers: { location: "https://ok.test/l" } }),
    });
    expect(loop.ok === false && loop.error).toContain("redirecciones");

    const notFound = await fetchPublicText("https://ok.test/x", { resolve: dns, fetchImpl: async () => text("", { status: 404 }) });
    expect(notFound.ok === false && notFound.error).toBe("HTTP 404");
  });
});
