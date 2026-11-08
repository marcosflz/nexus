import { describe, expect, it } from "vitest";
import { groupThreadsByDate } from "./group";

describe("groupThreadsByDate", () => {
  const now = new Date(2026, 10, 7, 15, 0, 0); // 7 nov 2026, 15:00 locales
  const at = (daysAgo: number, hour = 12) => new Date(2026, 10, 7 - daysAgo, hour).toISOString();

  it("reparte los hilos en sus grupos y omite los vacíos", () => {
    const groups = groupThreadsByDate(
      [
        { id: "a", updatedAt: at(0, 9) },
        { id: "b", updatedAt: at(1) },
        { id: "c", updatedAt: at(5) },
        { id: "d", updatedAt: at(20) },
        { id: "e", updatedAt: at(90) },
      ],
      now,
    );

    expect(groups.map((g) => [g.label, g.threads.map((t) => t.id)])).toEqual([
      ["Hoy", ["a"]],
      ["Ayer", ["b"]],
      ["Últimos 7 días", ["c"]],
      ["Últimos 30 días", ["d"]],
      ["Anteriores", ["e"]],
    ]);
  });

  it("conserva el orden dentro de cada grupo y devuelve [] sin hilos", () => {
    const groups = groupThreadsByDate(
      [
        { id: "x", updatedAt: at(0, 14) },
        { id: "y", updatedAt: at(0, 8) },
      ],
      now,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].threads.map((t) => t.id)).toEqual(["x", "y"]);
    expect(groupThreadsByDate([], now)).toEqual([]);
  });
});
