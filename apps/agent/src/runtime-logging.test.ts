import { afterEach, describe, expect, mock, test } from "bun:test";
import { configureRuntimeLogging } from "./runtime-logging";

describe("runtime logging", () => {
  const originalLogger = globalThis.AI_SDK_LOG_WARNINGS;
  const originalWrite = process.stderr.write;

  afterEach(() => {
    globalThis.AI_SDK_LOG_WARNINGS = originalLogger;
    process.stderr.write = originalWrite;
  });

  test("routes AI SDK warnings to stderr instead of the protocol stdout", () => {
    const writes: unknown[] = [];
    const write = mock((chunk: unknown) => {
      writes.push(chunk);
      return true;
    });
    process.stderr.write = write as typeof process.stderr.write;

    configureRuntimeLogging();
    const logger = globalThis.AI_SDK_LOG_WARNINGS;
    expect(typeof logger).toBe("function");
    if (typeof logger !== "function") throw new Error("AI SDK warning logger was not configured");

    logger({
      warnings: [{ type: "other", message: "test warning" }],
      provider: "test-provider",
      model: "test-model",
    });

    expect(write).toHaveBeenCalledTimes(1);
    expect(String(writes[0])).toContain("[ai-sdk warning] provider=test-provider model=test-model");
    expect(String(writes[0])).toContain("test warning");
  });
});
