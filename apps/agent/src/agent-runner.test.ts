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

  test("executes shell calls and emits domain tool lifecycle events", async () => {
    let call = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        call++;
        if (call === 1) return { stream: simulateReadableStream({ chunks: [
            { type: "tool-input-start", id: "provider-call-1", toolName: "shell" },
            { type: "tool-input-delta", id: "provider-call-1", delta: '{"command":"[Console]::Out.Write(\\"TOOL_OK\\")","yieldTimeMs":5000}' },
            { type: "tool-input-end", id: "provider-call-1" },
            { type: "tool-call", toolCallId: "provider-call-1", toolName: "shell", input: '{"command":"[Console]::Out.Write(\\"TOOL_OK\\")","yieldTimeMs":5000}' },
            { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, logprobs: undefined, usage },
          ] }) };
        return { stream: simulateReadableStream({ chunks: [
          { type: "text-start", id: "text-2" },
          { type: "text-delta", id: "text-2", delta: "done" },
          { type: "text-end", id: "text-2" },
          { type: "finish", finishReason: { unified: "stop", raw: undefined }, logprobs: undefined, usage },
        ] }) };
      },
    });
    const events: Array<Record<string, unknown>> = [];
    const result = await new AgentRunner(model).run({
      cwd: process.cwd(),
      messages: [{ role: "user", content: "run it" }],
      abortSignal: new AbortController().signal,
      onEvent: (event) => { events.push(event); },
    });

    expect(result.status).toBe("completed");
    const started = events.find((event) => event.type === "tool.started");
    const output = events.find((event) => event.type === "tool.output");
    const completed = events.find((event) => event.type === "tool.completed");
    expect(started).toMatchObject({ toolName: "shell" });
    expect(started?.toolExecutionId).not.toBe("provider-call-1");
    expect(output?.toolExecutionId).toBe(started?.toolExecutionId);
    expect(completed?.toolExecutionId).toBe(started?.toolExecutionId);
    expect(JSON.stringify(completed)).toContain("TOOL_OK");
    expect(events.at(-1)).toEqual({ type: "text.completed", text: "done" });
  });
});
