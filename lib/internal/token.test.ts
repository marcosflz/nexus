import { describe, expect, it } from "vitest";
import { signRunToken, signSidecarRequest, verifyRunToken } from "./token";

const SECRET = "secreto-de-prueba";
const claims = { runId: "r1", userId: "u1", agentId: null };

describe("token de run", () => {
  it("firma y verifica", () => {
    const token = signRunToken(claims, { secret: SECRET, now: 1000 });
    expect(verifyRunToken(token, { secret: SECRET, now: 2000 })).toMatchObject(claims);
  });

  it("caduca", () => {
    const token = signRunToken(claims, { secret: SECRET, now: 0, ttlMs: 1000 });
    expect(verifyRunToken(token, { secret: SECRET, now: 999 })).not.toBeNull();
    expect(verifyRunToken(token, { secret: SECRET, now: 1001 })).toBeNull();
  });

  it("rechaza manipulaciones y secretos ajenos", () => {
    const token = signRunToken(claims, { secret: SECRET, now: 0 });
    const [payload, signature] = token.split(".");

    const forged = Buffer.from(
      JSON.stringify({ ...claims, userId: "otro", exp: Number.MAX_SAFE_INTEGER }),
    ).toString("base64url");
    expect(verifyRunToken(`${forged}.${signature}`, { secret: SECRET, now: 1 })).toBeNull();
    expect(verifyRunToken(`${payload}.${signature}x`, { secret: SECRET, now: 1 })).toBeNull();
    expect(verifyRunToken(token, { secret: "otro-secreto", now: 1 })).toBeNull();
    expect(verifyRunToken("basura", { secret: SECRET })).toBeNull();
    expect(verifyRunToken("a.b.c", { secret: SECRET })).toBeNull();
  });

  it("sin secreto configurado no valida nada", () => {
    const token = signRunToken(claims, { secret: SECRET });
    const previous = process.env.NEXUS_AGENT_SECRET;
    delete process.env.NEXUS_AGENT_SECRET;
    try {
      expect(verifyRunToken(token)).toBeNull();
    } finally {
      if (previous !== undefined) process.env.NEXUS_AGENT_SECRET = previous;
    }
  });
});

describe("firma de peticiones al sidecar", () => {
  it("coincide con la comprobación del sidecar (HMAC-SHA256 de «ts.cuerpo»)", async () => {
    const body = '{"a":1,"ñ":"é"}';
    const headers = signSidecarRequest(body, { secret: SECRET, now: 1_700_000_000_000 });

    expect(headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(headers["X-Nexus-Timestamp"]).toBe("1700000000");
    // Valor de referencia calculado de forma independiente.
    const { createHmac } = await import("node:crypto");
    const expected = createHmac("sha256", SECRET).update(`1700000000.${body}`).digest("hex");
    expect(headers["X-Nexus-Signature"]).toBe(expected);
  });
});
