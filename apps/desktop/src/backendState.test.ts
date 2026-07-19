import { describe, expect, test } from "bun:test";
import { failureStatusFromMessage, formatBackendError } from "./backendState";

describe("backend failure state", () => {
  test("keeps illegal protocol distinct from a process crash", () => {
    expect(failureStatusFromMessage({
      v: 1,
      type: "backend.error",
      error: { code: "protocol_error", message: "invalid_json" },
    })).toEqual({
      state: "protocol_error",
      error: { code: "protocol_error", message: "invalid_json" },
    });

    expect(failureStatusFromMessage({
      v: 1,
      type: "backend.crashed",
      exitCode: 1,
      message: "Bun backend exited unexpectedly.",
    })).toEqual({
      state: "crashed",
      exitCode: 1,
      message: "Bun backend exited unexpectedly.",
    });
  });

  test("formats structured command failures without parsing error strings", () => {
    expect(formatBackendError({ code: "config_invalid", message: "default_model is missing" }))
      .toBe("[config_invalid] default_model is missing");
  });
});
