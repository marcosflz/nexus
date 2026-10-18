import { describe, expect, it } from "vitest";
import { isLeaseExpired, nextRunState } from "./types";

describe("nextRunState", () => {
  it("no resucita un run ya cerrado", () => {
    expect(nextRunState("completed", { kind: "started", at: new Date() })).toBe("completed");
  });

  it("distingue interrumpido de completado", () => {
    const at = new Date();
    expect(nextRunState("running", { kind: "finished", at, interrupted: false })).toBe("completed");
    expect(nextRunState("running", { kind: "finished", at, interrupted: true })).toBe("interrupted");
  });

  it("un lease vencido interrumpe, nunca completa", () => {
    expect(nextRunState("running", { kind: "lease-expired", at: new Date() })).toBe("interrupted");
    expect(nextRunState("completed", { kind: "lease-expired", at: new Date() })).toBe("completed");
  });

  it("la cancelación es terminal", () => {
    expect(nextRunState("running", { kind: "cancelled", at: new Date() })).toBe("cancelled");
  });
});

describe("isLeaseExpired", () => {
  const now = new Date("2026-10-18T12:00:00Z");

  it("es falso mientras el lease está vivo", () => {
    expect(
      isLeaseExpired({ status: "running", leaseUntil: new Date("2026-10-18T12:01:00Z") }, now),
    ).toBe(false);
  });

  it("es verdadero cuando el lease venció", () => {
    expect(
      isLeaseExpired({ status: "running", leaseUntil: new Date("2026-10-18T11:59:00Z") }, now),
    ).toBe(true);
  });

  it("no se aplica a runs ya cerrados", () => {
    expect(isLeaseExpired({ status: "completed", leaseUntil: null }, now)).toBe(false);
  });
});
