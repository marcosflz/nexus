import { describe, expect, it } from "vitest";
import { canEditAgent, canUseAgent, isListedFor } from "./access";
import { parseMention, slugify, uniqueSlug } from "./slug";

describe("slugify", () => {
  it("normaliza acentos, símbolos y mayúsculas", () => {
    expect(slugify("Análisis Fiscal")).toBe("analisis-fiscal");
    expect(slugify("  ¡Hola, Mundo!  ")).toBe("hola-mundo");
    expect(slugify("Ñandú & Co.")).toBe("nandu-co");
  });

  it("acota la longitud y nunca devuelve vacío", () => {
    expect(slugify("a".repeat(100)).length).toBeLessThanOrEqual(40);
    expect(slugify("---")).toBe("agente");
    expect(slugify("🙂🙂")).toBe("agente");
  });
});

describe("uniqueSlug", () => {
  it("añade un sufijo numérico hasta encontrar uno libre", () => {
    expect(uniqueSlug("bot", [])).toBe("bot");
    expect(uniqueSlug("bot", ["bot"])).toBe("bot-2");
    expect(uniqueSlug("bot", ["bot", "bot-2", "bot-3"])).toBe("bot-4");
  });
});

describe("parseMention", () => {
  it("separa la mención del resto del mensaje", () => {
    expect(parseMention("@analista ¿qué opinas?")).toEqual({ slug: "analista", rest: "¿qué opinas?" });
    expect(parseMention("  @Mi-Bot  hola\nmundo")).toEqual({ slug: "mi-bot", rest: "hola\nmundo" });
    expect(parseMention("@solo")).toEqual({ slug: "solo", rest: "" });
  });

  it("ignora lo que no es una mención inicial", () => {
    expect(parseMention("hola @analista")).toBeNull();
    expect(parseMention("correo@dominio.com")).toBeNull();
    expect(parseMention("@")).toBeNull();
    expect(parseMention("@ espacio")).toBeNull();
  });
});

describe("permisos de agentes", () => {
  const owned = { ownerId: "u1", visibility: "private" as const };
  const shared = { ownerId: "u2", visibility: "public" as const };
  const link = { ownerId: "u2", visibility: "unlisted" as const };
  const secret = { ownerId: "u2", visibility: "private" as const };

  it("solo el dueño edita", () => {
    expect(canEditAgent("u1", owned)).toBe(true);
    expect(canEditAgent("u1", shared)).toBe(false);
  });

  it("los privados solo los usa su dueño; públicos y con enlace los usa cualquiera", () => {
    expect(canUseAgent("u1", owned)).toBe(true);
    expect(canUseAgent("u1", shared)).toBe(true);
    expect(canUseAgent("u1", link)).toBe(true);
    expect(canUseAgent("u1", secret)).toBe(false);
  });

  it("la galería muestra los míos y los públicos, no los que solo tienen enlace", () => {
    expect(isListedFor("u1", owned)).toBe(true);
    expect(isListedFor("u1", shared)).toBe(true);
    expect(isListedFor("u1", link)).toBe(false);
    expect(isListedFor("u1", secret)).toBe(false);
  });
});
