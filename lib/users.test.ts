import { describe, expect, it } from "vitest";
import { adminChangeError, generatePassword } from "./users";

const admin = { id: "a", role: "admin" as const, disabled: false };
const user = { id: "u", role: "user" as const, disabled: false };

describe("adminChangeError", () => {
  it("permite gestionar cuentas normales y dar permisos", () => {
    expect(adminChangeError({ actorId: "a", target: user, change: { disabled: true }, otherActiveAdmins: 0 })).toBeNull();
    expect(adminChangeError({ actorId: "a", target: user, change: { delete: true }, otherActiveAdmins: 0 })).toBeNull();
    expect(adminChangeError({ actorId: "a", target: admin, change: {}, otherActiveAdmins: 0 })).toBeNull();
  });

  it("nadie se quita el acceso a sí mismo", () => {
    for (const change of [{ role: "user" as const }, { disabled: true }, { delete: true }]) {
      expect(adminChangeError({ actorId: "a", target: admin, change, otherActiveAdmins: 5 })).toBeTruthy();
    }
  });

  it("no se puede dejar la instancia sin admins activos", () => {
    const change = { role: "user" as const };
    expect(adminChangeError({ actorId: "b", target: admin, change, otherActiveAdmins: 0 })).toMatch(/al menos un/);
    expect(adminChangeError({ actorId: "b", target: admin, change, otherActiveAdmins: 1 })).toBeNull();
    // Un admin ya desactivado no cuenta como el último.
    expect(
      adminChangeError({ actorId: "b", target: { ...admin, disabled: true }, change: { delete: true }, otherActiveAdmins: 0 }),
    ).toBeNull();
  });
});

describe("generatePassword", () => {
  it("genera contraseñas largas y distintas", () => {
    expect(generatePassword().length).toBeGreaterThanOrEqual(16);
    expect(generatePassword()).not.toBe(generatePassword());
  });
});
