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
});
