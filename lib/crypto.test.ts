import { beforeAll, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  hashToken,
  verifyPassword,
} from "./crypto";

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = "ab".repeat(32);
});

describe("cifrado de secretos", () => {
  it("hace roundtrip AES-256-GCM con IV aleatorio", () => {
    const plain = "sk-or-v1-secreto";
    const a = encryptSecret(plain);
    const b = encryptSecret(plain);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(plain);
    expect(decryptSecret(b)).toBe(plain);
  });
});

describe("hash de contraseñas", () => {
  it("verifica correctamente y rechaza incorrectas", () => {
    const stored = hashPassword("contraseña-larga");
    expect(verifyPassword("contraseña-larga", stored)).toBe(true);
    expect(verifyPassword("otra", stored)).toBe(false);
  });
});

describe("hashToken", () => {
  it("es determinista", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });
});
