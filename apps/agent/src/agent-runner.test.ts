import { describe, expect, test } from "bun:test";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  test("executes edit calls through the same tool lifecycle", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nyan-runner-edit-"));
    try {
      await writeFile(join(cwd, "file.txt"), "old", "utf8");
      const input = JSON.stringify({ filePath: "file.txt", oldText: "old", newText: "new" });
      let call = 0;
      const model = new MockLanguageModelV4({
        doStream: async () => {
          call++;
          if (call === 1) return { stream: simulateReadableStream({ chunks: [
            { type: "tool-input-start", id: "provider-edit-1", toolName: "edit" },
            { type: "tool-input-delta", id: "provider-edit-1", delta: input },
            { type: "tool-input-end", id: "provider-edit-1" },
            { type: "tool-call", toolCallId: "provider-edit-1", toolName: "edit", input },
            { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, logprobs: undefined, usage },
          ] }) };
          return { stream: simulateReadableStream({ chunks: [
            { type: "text-start", id: "text-edit" },
            { type: "text-delta", id: "text-edit", delta: "edited" },
            { type: "text-end", id: "text-edit" },
            { type: "finish", finishReason: { unified: "stop", raw: undefined }, logprobs: undefined, usage },
          ] }) };
        },
      });
      const events: Array<Record<string, unknown>> = [];
      const result = await new AgentRunner(model).run({
        cwd,
        messages: [{ role: "user", content: "edit it" }],
        abortSignal: new AbortController().signal,
        onEvent: (event) => { events.push(event); },
      });

      expect(result.status).toBe("completed");
      expect(await readFile(join(cwd, "file.txt"), "utf8")).toBe("new");
      expect(events.find((event) => event.type === "tool.started")).toMatchObject({ toolName: "edit", input: { filePath: "file.txt" } });
      expect(JSON.stringify(events.find((event) => event.type === "tool.completed"))).toContain('"strategy":"exact"');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("runs independent subagents concurrently and aggregates every result", async () => {
    let call = 0;
    const input = JSON.stringify({ tasks: [
      { id: "alpha", prompt: "Inspect alpha without edits." },
      { id: "beta", prompt: "Inspect beta without edits." },
      { id: "gamma", prompt: "Inspect gamma without edits." },
    ] });
    let activeWorkers = 0;
    let peakWorkers = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        call++;
        if (call === 1) return toolCallStream("provider-subagent-1", "subagent", input);
        if (call <= 4) {
          const worker = call - 1;
          activeWorkers++;
          peakWorkers = Math.max(peakWorkers, activeWorkers);
          await Bun.sleep(20);
          activeWorkers--;
          return textStream(`worker-${worker}`, `result-${worker}`);
        }
        return textStream("main-final", "combined");
      },
    });
    const events: Array<Record<string, unknown>> = [];
    const result = await new AgentRunner(model).run({
      cwd: process.cwd(),
      messages: [{ role: "user", content: "delegate" }],
      abortSignal: new AbortController().signal,
      onEvent: (event) => { events.push(event); },
    });

    expect(result.status).toBe("completed");
    expect(peakWorkers).toBe(3);
    const activities = events.filter((event) => event.type === "subagent.activity");
    expect(new Set(activities.map((event) => event.subagentId)).size).toBe(3);
    expect(activities.filter((event) => event.status === "completed").map((event) => event.taskId).sort()).toEqual(["alpha", "beta", "gamma"]);
    const completion = events.find((event) => event.type === "tool.completed" && JSON.stringify(event).includes('"tasks"'));
    expect(completion).toMatchObject({ output: { tasks: [
      { id: "alpha", status: "completed", text: "result-1" },
      { id: "beta", status: "completed", text: "result-2" },
      { id: "gamma", status: "completed", text: "result-3" },
    ] } });
  });

  test("keeps successful subagent results when a sibling fails", async () => {
    let call = 0;
    const input = JSON.stringify({ tasks: [
      { id: "good", prompt: "Return a result." },
      { id: "bad", prompt: "Fail." },
    ] });
    const model = new MockLanguageModelV4({
      doStream: async () => {
        call++;
        if (call === 1) return toolCallStream("provider-subagent-2", "subagent", input);
        if (call === 2) return textStream("worker-good", "useful finding");
        if (call === 3) return errorStream("worker exploded");
        return textStream("main-after-failure", "handled");
      },
    });
    const events: Array<Record<string, unknown>> = [];
    const result = await new AgentRunner(model).run({
      cwd: process.cwd(),
      messages: [{ role: "user", content: "delegate" }],
      abortSignal: new AbortController().signal,
      onEvent: (event) => { events.push(event); },
    });

    expect(result.status).toBe("completed");
    const completion = events.find((event) => event.type === "tool.completed" && JSON.stringify(event).includes('"tasks"'));
    expect(completion).toMatchObject({ output: { tasks: [
      { id: "good", status: "completed", text: "useful finding" },
      { id: "bad", status: "failed", error: "worker exploded" },
    ] } });
    expect(events.some((event) => event.type === "subagent.activity" && event.taskId === "bad" && event.status === "failed")).toBe(true);
  });

  test("cascades the parent abort signal into a running subagent", async () => {
    let call = 0;
    let markWorkerStarted!: () => void;
    const workerStarted = new Promise<void>((resolve) => { markWorkerStarted = resolve; });
    const input = JSON.stringify({ tasks: [{ id: "wait", prompt: "Wait until cancelled." }] });
    const model = new MockLanguageModelV4({
      doStream: async ({ abortSignal }) => {
        call++;
        if (call === 1) return toolCallStream("provider-subagent-cancel", "subagent", input);
        markWorkerStarted();
        return await new Promise<never>((_resolve, reject) => {
          if (abortSignal?.aborted) reject(abortSignal.reason ?? new DOMException("Cancelled", "AbortError"));
          else abortSignal?.addEventListener("abort", () => reject(abortSignal.reason ?? new DOMException("Cancelled", "AbortError")), { once: true });
        });
      },
    });
    const controller = new AbortController();
    const events: Array<Record<string, unknown>> = [];
    const running = new AgentRunner(model).run({
      cwd: process.cwd(),
      messages: [{ role: "user", content: "delegate" }],
      abortSignal: controller.signal,
      onEvent: (event) => { events.push(event); },
    });
    await workerStarted;
    controller.abort(new DOMException("Stopped", "AbortError"));

    expect((await running).status).toBe("cancelled");
    expect(events.some((event) => event.type === "subagent.activity" && event.taskId === "wait" && event.status === "cancelled")).toBe(true);
  });
});

function toolCallStream(id: string, toolName: string, input: string) {
  return { stream: simulateReadableStream({ chunks: [
    { type: "tool-input-start" as const, id, toolName },
    { type: "tool-input-delta" as const, id, delta: input },
    { type: "tool-input-end" as const, id },
    { type: "tool-call" as const, toolCallId: id, toolName, input },
    { type: "finish" as const, finishReason: { unified: "tool-calls" as const, raw: undefined }, logprobs: undefined, usage },
  ] }) };
}

function textStream(id: string, text: string) {
  return { stream: simulateReadableStream({ chunks: [
    { type: "text-start" as const, id },
    { type: "text-delta" as const, id, delta: text },
    { type: "text-end" as const, id },
    { type: "finish" as const, finishReason: { unified: "stop" as const, raw: undefined }, logprobs: undefined, usage },
  ] }) };
}

function errorStream(message: string) {
  return { stream: simulateReadableStream({ chunks: [
    { type: "error" as const, error: new Error(message) },
  ] }) };
}
