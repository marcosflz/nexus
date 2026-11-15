import { describe, expect, it } from "vitest";
import { publicTrigger } from "./public";
import type { TriggerRow } from "./service";

describe("publicTrigger", () => {
  it("no expone nunca el hash del token del webhook", () => {
    const row = {
      id: "t1", botId: "a1", kind: "webhook", name: "n", prompt: "p",
      config: { tokenHash: "SECRETO-HASH", otra: 1 }, enabled: true, nextRunAt: null, lastRunAt: null,
      lastState: {}, failureCount: 0, createdAt: new Date(),
    } as unknown as TriggerRow;

    const shown = publicTrigger(row);
    expect(JSON.stringify(shown)).not.toContain("SECRETO-HASH");
    expect(shown.config).toEqual({ otra: 1 });
  });
});
