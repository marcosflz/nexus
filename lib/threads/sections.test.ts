import { describe, expect, it } from "vitest";
import { splitThreads } from "./sections";

const t = (id: string, pinnedAt: string | null = null, projectId: string | null = null) => ({
  id,
  updatedAt: "2026-11-07T10:00:00.000Z",
  pinnedAt,
  projectId,
});

describe("splitThreads", () => {
  it("un fijado con proyecto aparece solo en pinned", () => {
    const r = splitThreads([t("a", "2026-11-01T00:00:00Z", "p1")]);
    expect(r.pinned.map((x) => x.id)).toEqual(["a"]);
    expect(r.byProject).toEqual({});
    expect(r.recent).toEqual([]);
  });

  it("ordena pinned por pinnedAt desc", () => {
    const r = splitThreads([t("a", "2026-11-01T00:00:00Z"), t("b", "2026-11-03T00:00:00Z")]);
    expect(r.pinned.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("agrupa por proyecto conservando el orden y el resto va a recent", () => {
    const r = splitThreads([t("a", null, "p1"), t("b"), t("c", null, "p1")]);
    expect(r.byProject.p1.map((x) => x.id)).toEqual(["a", "c"]);
    expect(r.recent.map((x) => x.id)).toEqual(["b"]);
  });

  it("devuelve estructuras vacías sin hilos", () => {
    expect(splitThreads([])).toEqual({ pinned: [], byProject: {}, recent: [] });
  });
});
