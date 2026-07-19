import { describe, expect, test } from "bun:test";
import { activeTurnFromSessions } from "./sessionState";

describe("desktop session state", () => {
  test("restores the active turn from persisted session metadata", () => {
    expect(activeTurnFromSessions([
      { id: "idle", status: "completed" },
      { id: "active", status: "running", activeTurnId: "turn" },
    ])).toEqual({ sessionId: "active", turnId: "turn" });
  });

  test("does not treat incomplete running metadata as cancellable", () => {
    expect(activeTurnFromSessions([{ id: "stale", status: "running" }])).toBeUndefined();
  });
});
