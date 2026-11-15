import { describe, expect, it } from "vitest";
import {
  allowedModelList,
  hasPermission,
  manageError,
  modelAllowed,
  OPEN_ACCESS,
  parseAccess,
  providerAllowed,
  remainingTokens,
  startOfUtcMonth,
  type UserAccess,
} from "./access";

const as = (role: "superadmin" | "admin" | "user", access: Partial<UserAccess> = {}) => ({
  role,
  access: { ...OPEN_ACCESS, ...access },
});

describe("permisos", () => {
  it("todo está permitido salvo lo que se haya negado", () => {
    expect(hasPermission(as("user"), "research")).toBe(true);
    expect(hasPermission(as("user", { permissions: { research: false } }), "research")).toBe(false);
    expect(hasPermission(as("admin", { permissions: { research: false } }), "research")).toBe(false);
  });

  it("un superadmin no tiene restricciones", () => {
    const limited = { permissions: { research: false }, modelAccess: {}, monthlyTokenLimit: 1 };
    expect(hasPermission(as("superadmin", limited), "research")).toBe(true);
    expect(modelAllowed(as("superadmin", limited), "openrouter", "x")).toBe(true);
    expect(remainingTokens(as("superadmin", limited), 500)).toBeNull();
  });

  it("un valor corrupto cierra el acceso en vez de abrirlo", () => {
    const access = parseAccess({ permissions: "todo" });
    expect(hasPermission({ role: "user", access }, "skills")).toBe(false);
    expect(modelAllowed({ role: "user", access }, "openrouter", "x")).toBe(false);
    expect(parseAccess(null)).toEqual(OPEN_ACCESS);
  });
});

describe("modelos", () => {
  const user = as("user", { modelAccess: { openrouter: "*", anthropic: ["claude-sonnet-5-5"] } });

  it("sin reglas vale cualquiera", () => {
    expect(modelAllowed(as("user"), "gemini", "lo-que-sea")).toBe(true);
    expect(allowedModelList(as("user"), "gemini")).toBeNull();
  });

  it("aplica la regla de cada proveedor y bloquea los que no aparecen", () => {
    expect(modelAllowed(user, "openrouter", "cualquiera")).toBe(true);
    expect(modelAllowed(user, "anthropic", "claude-sonnet-5-5")).toBe(true);
    expect(modelAllowed(user, "anthropic", "claude-opus-5-5")).toBe(false);
    expect(modelAllowed(user, "gemini", "x")).toBe(false);
    expect(providerAllowed(user, "gemini")).toBe(false);
    expect(allowedModelList(user, "anthropic")).toEqual(["claude-sonnet-5-5"]);
    expect(allowedModelList(user, "openrouter")).toBeNull();
  });
});

describe("cupo de tokens", () => {
  it("calcula lo que queda sin bajar de cero", () => {
    expect(remainingTokens(as("user"), 500)).toBeNull();
    expect(remainingTokens(as("user", { monthlyTokenLimit: 1000 }), 400)).toBe(600);
    expect(remainingTokens(as("user", { monthlyTokenLimit: 1000 }), 4000)).toBe(0);
  });

  it("el mes empieza el día 1 en UTC", () => {
    expect(startOfUtcMonth(new Date("2026-11-30T23:59:00Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});

describe("manageError", () => {
  const superadmin = { id: "s", role: "superadmin" as const };
  const admin = { id: "a", role: "admin" as const };
  const target = (id: string, role: "superadmin" | "admin" | "user", disabled = false) => ({ id, role, disabled });
  const check = (actor: typeof superadmin | typeof admin, t: ReturnType<typeof target>, change: object, others = 0) =>
    manageError({ actor, target: t, change, otherActiveSuperadmins: others });

  it("un admin gestiona cuentas normales pero no a otros admins", () => {
    expect(check(admin, target("u", "user"), { disabled: true, access: true })).toBeNull();
    expect(check(admin, target("b", "admin"), { disabled: true })).toMatch(/superadmin/);
    expect(check(admin, target("x", "superadmin"), { access: true })).toMatch(/superadmin/);
  });

  it("solo un superadmin nombra administradores", () => {
    expect(check(admin, target("u", "user"), { role: "admin" })).toMatch(/superadmin/);
    expect(check(superadmin, target("u", "user"), { role: "admin" })).toBeNull();
    expect(check(superadmin, target("b", "admin"), { role: "superadmin" })).toBeNull();
  });

  it("nadie se quita el acceso ni se amplía sus propios permisos", () => {
    expect(check(admin, target("a", "admin"), { access: true })).toMatch(/propios/);
    expect(check(superadmin, target("s", "superadmin"), { role: "user" }, 3)).toMatch(/propio rol/);
    expect(check(superadmin, target("s", "superadmin"), { delete: true }, 3)).toMatch(/borrar/);
  });

  it("siempre queda un superadmin activo", () => {
    expect(check(superadmin, target("o", "superadmin"), { role: "admin" }, 0)).toMatch(/al menos un/);
    expect(check(superadmin, target("o", "superadmin"), { role: "admin" }, 1)).toBeNull();
    expect(check(superadmin, target("o", "superadmin", true), { delete: true }, 0)).toBeNull();
  });
});
