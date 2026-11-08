import { describe, expect, it } from "vitest";
import { runStages } from "./loop";

describe("runStages", () => {
  it("ejecuta todas las etapas aunque una falle", async () => {
    const ran: string[] = [];
    const failures = await runStages([
      ["a", async () => void ran.push("a")],
      [
        "planificar",
        async () => {
          throw new Error("disparador roto");
        },
      ],
      ["c", async () => void ran.push("c")],
    ]);

    expect(ran).toEqual(["a", "c"]); // la etapa posterior al fallo sí se ejecutó
    expect(failures.map((f) => f.stage)).toEqual(["planificar"]);
    expect((failures[0].error as Error).message).toBe("disparador roto");
  });

  it("sin fallos devuelve una lista vacía", async () => {
    expect(await runStages([["x", async () => 1]])).toEqual([]);
  });
});
