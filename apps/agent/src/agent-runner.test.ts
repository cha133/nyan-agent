import { describe, expect, test } from "bun:test";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { AgentRunner, fallbackTitle } from "./agent-runner";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 2, text: 2, reasoning: undefined },
};

describe("agent runner", () => {
  test("streams deltas and closes one complete text block", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({ chunks: [
          { type: "reasoning-start", id: "reasoning-1" },
          { type: "reasoning-delta", id: "reasoning-1", delta: "think" },
          { type: "reasoning-end", id: "reasoning-1" },
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: "hello " },
          { type: "text-delta", id: "text-1", delta: "world" },
          { type: "text-end", id: "text-1" },
          { type: "finish", finishReason: { unified: "stop", raw: undefined }, logprobs: undefined, usage },
        ] }),
      }),
    });
    const events: unknown[] = [];
    const result = await new AgentRunner(model).run({
      cwd: "C:\\work",
      messages: [{ role: "user", content: "hi" }],
      abortSignal: new AbortController().signal,
      onEvent: (event) => { events.push(event); },
    });
    expect(result.status).toBe("completed");
    expect(events).toEqual([
      { type: "reasoning.delta", text: "think" },
      { type: "reasoning.completed", text: "think" },
      { type: "text.delta", text: "hello " },
      { type: "text.delta", text: "world" },
      { type: "text.completed", text: "hello world" },
    ]);
    expect(result.responseMessages[0]).toMatchObject({ role: "assistant" });
  });

  test("uses a bounded local title fallback", () => {
    expect(fallbackTitle("  fix   the tests  ")).toBe("fix the tests");
    expect(fallbackTitle("x".repeat(80))).toHaveLength(48);
  });
});
