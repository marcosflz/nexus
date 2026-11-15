import { describe, expect, it } from "vitest";
import { hasPermission } from "@/lib/access";
import { DEFAULT_RULES } from "@/lib/policy/defaults";
import {
  botConfigSchema,
  botInputSchema,
  botPatchSchema,
  botSlug,
  botTaskSchema,
  isConfigPending,
  isTerminalTask,
  sanitizeSteps,
  statusFromReport,
  taskStatusFromRun,
} from "./spec";

describe("tareas de ordenador", () => {
  it("limita los pasos, que son lo que más consume", () => {
    expect(botTaskSchema.parse({ kind: "computer", prompt: "x" })).toMatchObject({ maxSteps: 30 });
    expect(botTaskSchema.safeParse({ kind: "computer", prompt: "x", maxSteps: 61 }).success).toBe(false);
    expect(botTaskSchema.safeParse({ kind: "computer", prompt: " " }).success).toBe(false);
  });

  it("oculta también el texto secreto escrito en el escritorio", () => {
    expect(sanitizeSteps([{ action: "desktop_type", text: "clave", secret: true }])[0].text).toBe("***");
  });
});

describe("configuración del bot", () => {
  it("por defecto restringe la red y no guarda la sesión", () => {
    const config = botConfigSchema.parse({});
    expect(config.network).toBe("restricted");
    expect(config.persistBrowser).toBe(false);
  });

  it("rechaza límites fuera de margen y redes desconocidas", () => {
    expect(botConfigSchema.safeParse({ memoryMb: 99_999 }).success).toBe(false);
    expect(botConfigSchema.safeParse({ cpus: 16 }).success).toBe(false);
    expect(botConfigSchema.safeParse({ network: "host" }).success).toBe(false);
  });

  it("exige un nombre", () => {
    expect(botInputSchema.safeParse({ name: "  " }).success).toBe(false);
  });

  it("genera slugs limpios", () => {
    expect(botSlug("Investigador Ñandú 2")).toBe("investigador-nandu-2");
    expect(botSlug("!!!")).toBe("bot");
  });
});

describe("tareas", () => {
  it("distingue planes de tareas con agente", () => {
    expect(botTaskSchema.safeParse({ kind: "plan", steps: [{ action: "goto", url: "http://a" }] }).success).toBe(true);
    expect(botTaskSchema.safeParse({ kind: "agent", prompt: "hola" }).success).toBe(true);
    expect(botTaskSchema.safeParse({ kind: "plan", steps: [] }).success).toBe(false);
  });

  it("no guarda los valores secretos", () => {
    const clean = sanitizeSteps([
      { action: "fill", selector: "#p", value: "hunter2", secret: true },
      { action: "fill", selector: "#n", value: "Ada" },
    ]);
    expect(JSON.stringify(clean)).not.toContain("hunter2");
    expect(clean[1].value).toBe("Ada");
  });

  it("reconoce los estados finales", () => {
    expect(isTerminalTask("interrupted")).toBe(true);
    expect(isTerminalTask("awaiting_approval")).toBe(false);
  });

  it("traduce los estados del run", () => {
    expect(taskStatusFromRun("completed")).toBe("succeeded");
    expect(taskStatusFromRun("awaiting_input")).toBe("awaiting_approval");
  });
});

describe("estado del contenedor", () => {
  it("un cierre limpio es parado", () => {
    expect(statusFromReport({ state: "stopped", exitCode: 0 })).toEqual({ status: "stopped", error: null });
  });

  it("un cierre anómalo se ve como error", () => {
    expect(statusFromReport({ state: "stopped", exitCode: 137 }).status).toBe("error");
    expect(statusFromReport({ state: "stopped", exitCode: 137, oomKilled: true }).error).toContain("memoria");
  });

  it("en marcha limpia el error", () => {
    expect(statusFromReport({ state: "running" })).toEqual({ status: "running", error: null });
  });
});

describe("permisos y política", () => {
  it("se puede retirar el permiso de bots", () => {
    const user = { role: "user" as const, access: { permissions: { bots: false }, modelAccess: null, monthlyTokenLimit: null } };
    expect(hasPermission(user, "bots")).toBe(false);
  });

  const rule = DEFAULT_RULES.find((item) => item.id === "ask-scheduled-write")!;
  const asks = (tool: string) =>
    rule.when({ tool, args: {}, initiator: "routine", kind: "connector" } as Parameters<typeof rule.when>[0]);

  it("un run sin nadie delante no pide permiso para su propio workspace", () => {
    expect(asks("nexbot__workspace_write")).toBe(false);
    expect(asks("nexbot__browser_snapshot")).toBe(false);
  });

  it("pero sí para actuar sobre webs o ejecutar comandos", () => {
    expect(asks("nexbot__browser_click")).toBe(true);
    expect(asks("nexbot__browser_navigate")).toBe(true);
    expect(asks("nexbot__shell_exec")).toBe(true);
    expect(asks("otro__workspace_write")).toBe(true);
  });
});

describe("cambios parciales", () => {
  it("no reinician lo que no se envía", () => {
    expect(botPatchSchema.parse({ skillIds: [] })).toEqual({ skillIds: [] });
  });

  it("aceptan solo una parte de la configuración", () => {
    expect(botPatchSchema.parse({ config: { network: "none" } })).toEqual({ config: { network: "none" } });
  });

  it("mantienen los márgenes", () => {
    expect(botPatchSchema.safeParse({ config: { memoryMb: 99999 } }).success).toBe(false);
    expect(botPatchSchema.safeParse({ name: "   " }).success).toBe(false);
  });
});

describe("configuración pendiente de aplicar", () => {
  const saved = botConfigSchema.parse({});

  it("no hay nada pendiente si coincide", () => {
    expect(isConfigPending(saved, { ...saved })).toBe(false);
  });

  it("detecta cualquier diferencia", () => {
    expect(isConfigPending({ ...saved, network: "none" }, saved)).toBe(true);
    expect(isConfigPending({ ...saved, cpus: 2 }, saved)).toBe(true);
  });

  it("sin dato del contenedor no afirma que difiera", () => {
    expect(isConfigPending(saved, undefined)).toBe(false);
    expect(isConfigPending(saved, null)).toBe(false);
    expect(isConfigPending(saved, { network: "desconocida" })).toBe(false);
  });
});
