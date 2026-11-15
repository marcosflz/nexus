import { afterEach, describe, expect, it, vi } from "vitest";
import { installRandomUuid, randomId } from "./uuid";

/** UUID v4 según RFC 4122. */
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("randomId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("usa randomUUID cuando el contexto es seguro", () => {
    const spy = vi.fn(() => "11111111-2222-4333-8444-555555555555");
    vi.stubGlobal("crypto", { randomUUID: spy });

    expect(randomId()).toBe("11111111-2222-4333-8444-555555555555");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("cae a getRandomValues cuando no hay randomUUID (HTTP en LAN)", () => {
    // Escenario real de un despliegue autoalojado: contexto no seguro, sin
    // randomUUID. Antes esto lanzaba un TypeError y tumbaba la página.
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = i;
        return bytes;
      },
    });

    const id = randomId();
    expect(id).toMatch(V4);
    // Versión y variante quedan fijadas por el algoritmo, no por el azar.
    expect(id).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });

  it("sigue funcionando sin WebCrypto", () => {
    vi.stubGlobal("crypto", undefined);
    expect(randomId()).toMatch(V4);
  });

  it("genera identificadores distintos", () => {
    const ids = new Set(Array.from({ length: 500 }, () => randomId()));
    expect(ids.size).toBe(500);
  });
});

describe("installRandomUuid", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("define crypto.randomUUID donde falta, para las librerías que lo llaman a pelo", () => {
    // Por HTTP los componentes de OpenUI fallaban con «crypto.randomUUID is not a function».
    const insecure = { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) } as unknown as Crypto;
    vi.stubGlobal("crypto", insecure);

    installRandomUuid();

    expect(crypto.randomUUID()).toMatch(V4);
    expect(randomId()).toMatch(V4);
  });

  it("no toca el del navegador cuando existe", () => {
    const native = vi.fn(() => "11111111-2222-4333-8444-555555555555");
    vi.stubGlobal("crypto", { randomUUID: native });

    installRandomUuid();

    expect(crypto.randomUUID).toBe(native);
  });
});
