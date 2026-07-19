import { describe, expect, test } from "bun:test";
import { toTranscriptItems } from "./transcript";

describe("desktop transcript", () => {
  test("restores a completed shell call as one tool item", () => {
    const records = [
      { seq: 0, createdAt: "2026-01-01", kind: "tool.started", payload: { toolExecutionId: "tool-1", toolName: "shell", input: { command: "pwd" } } },
      { seq: 1, createdAt: "2026-01-01", kind: "tool.completed", payload: { toolExecutionId: "tool-1", output: { status: "completed", exitCode: 0, output: "C:\\work" } } },
    ];
    expect(toTranscriptItems(records)).toEqual([{
      id: "tool-1",
      role: "tool",
      text: "shell · completed · exit 0\npwd\n\nC:\\work",
    }]);
  });

  test("renders a persisted edit diff", () => {
    const records = [
      { seq: 0, createdAt: "2026-01-01", kind: "tool.started", payload: { toolExecutionId: "tool-2", toolName: "edit", input: { filePath: "src/app.ts" } } },
      { seq: 1, createdAt: "2026-01-01", kind: "tool.completed", payload: { toolExecutionId: "tool-2", output: { status: "updated", diff: "-old\n+new" } } },
    ];
    expect(toTranscriptItems(records)[0]).toEqual({
      id: "tool-2",
      role: "tool",
      text: "edit · updated\nsrc/app.ts\n\n-old\n+new",
    });
  });

  test("restores only the latest one-line activity for each subagent", () => {
    const records = [
      { seq: 0, createdAt: "2026-01-01", kind: "subagent.activity", payload: { subagentId: "agent-1", taskId: "inspect", status: "running", kind: "tool", preview: "rg files" } },
      { seq: 1, createdAt: "2026-01-01", kind: "subagent.activity", payload: { subagentId: "agent-2", taskId: "tests", status: "running", kind: "reasoning", preview: "checking" } },
      { seq: 2, createdAt: "2026-01-01", kind: "subagent.activity", payload: { subagentId: "agent-1", taskId: "inspect", status: "completed", kind: "text", preview: "found the cause" } },
    ];
    expect(toTranscriptItems(records)).toEqual([
      { id: "agent-1", role: "subagent", text: "inspect · 已完成 · 输出\nfound the cause" },
      { id: "agent-2", role: "subagent", text: "tests · 运行中 · 思考\nchecking" },
    ]);
  });
});
