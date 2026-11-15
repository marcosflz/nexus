import { describe, expect, it } from "vitest";
import { authHeaders, checkConnectorUrl } from "./validate";

describe("checkConnectorUrl", () => {
  it("acepta servidores https públicos", () => {
    expect(checkConnectorUrl("https://mcp.example.com/mcp")).toEqual({
      ok: true,
      url: "https://mcp.example.com/mcp",
    });
  });

  it.each([
    "http://localhost:3000/mcp",
    "https://127.0.0.1/mcp",
    "https://192.168.1.5/mcp",
    "https://10.0.0.2/mcp",
    "https://169.254.169.254/latest",
    "https://db/mcp",
    "https://agent:8090/",
    "https://mcp.internal/x",
    "http://mcp.example.com/mcp",
    "ftp://mcp.example.com/",
    "https://user:pw@mcp.example.com/",
    "no es una url",
  ])("rechaza %s", (url) => {
    expect(checkConnectorUrl(url).ok).toBe(false);
  });

  it("permite red privada y http solo con la bandera explícita", () => {
    expect(checkConnectorUrl("http://192.168.1.5:9000/mcp", true).ok).toBe(true);
    expect(checkConnectorUrl("http://miservidor:9000/mcp", true).ok).toBe(true);
    // Las credenciales en la URL se rechazan siempre.
    expect(checkConnectorUrl("http://u:p@192.168.1.5/", true).ok).toBe(false);
  });
});

describe("authHeaders", () => {
  it("construye la cabecera según el tipo", () => {
    expect(authHeaders("bearer", "tok", null)).toEqual({ Authorization: "Bearer tok" });
    expect(authHeaders("header", "tok", "X-Api-Key")).toEqual({ "X-Api-Key": "tok" });
    expect(authHeaders("none", "tok", null)).toEqual({});
    expect(authHeaders("bearer", null, null)).toEqual({});
  });

  it("descarta nombres de cabecera con caracteres peligrosos", () => {
    expect(authHeaders("header", "tok", "X-A\r\nInjected: 1")).toEqual({});
    expect(authHeaders("header", "tok", "")).toEqual({});
  });
});
