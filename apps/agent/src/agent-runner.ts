import { generateText, isStepCount, jsonSchema, tool, ToolLoopAgent, type LanguageModel, type ModelMessage } from "ai";
import type { ToolExecutionId } from "@nyan/protocol";
import { EditManager, type EditInput } from "./edit";
import { ShellManager, type ShellInput } from "./shell";

export type RunnerEvent =
  | { type: "text.delta"; text: string }
  | { type: "text.completed"; text: string }
  | { type: "reasoning.delta"; text: string }
  | { type: "reasoning.completed"; text: string }
  | { type: "tool.started"; toolExecutionId: ToolExecutionId; toolName: string; input: unknown }
  | { type: "tool.output"; toolExecutionId: ToolExecutionId; preview: string }
  | { type: "tool.completed"; toolExecutionId: ToolExecutionId; output: unknown };

export type RunResult = { status: "completed" | "cancelled"; responseMessages: ModelMessage[] };

export class AgentRunner {
  constructor(private readonly model: LanguageModel, private readonly maxOutputTokens?: number) {}

  async run(options: {
    cwd: string;
    messages: ModelMessage[];
    abortSignal: AbortSignal;
    onEvent: (event: RunnerEvent) => void | Promise<void>;
  }): Promise<RunResult> {
    const shell = new ShellManager();
    const edit = new EditManager();
    const toolExecutions = new Map<string, ToolExecutionId>();
    const tools = {
      shell: tool({
        description: "Run PowerShell 7 on Windows. Start with command, or continue a running command with processId and action poll/write/kill. Output is UTF-8 and byte-truncated.",
        inputSchema: jsonSchema<ShellInput>({
          type: "object",
          additionalProperties: false,
          properties: {
            command: { type: "string", description: "PowerShell 7 command to start." },
            cwd: { type: "string", description: "Optional absolute working directory. Defaults to the task cwd." },
            timeoutMs: { type: "integer", minimum: 1, maximum: 86_400_000 },
            yieldTimeMs: { type: "integer", minimum: 0, maximum: 30_000 },
            maxOutputBytes: { type: "integer", minimum: 1024, maximum: 16_777_216 },
            processId: { type: "string", description: "Opaque ID returned by a previous running shell call." },
            action: { type: "string", enum: ["poll", "write", "kill"] },
            stdin: { type: "string", description: "UTF-8 text to write to a running process." },
            closeStdin: { type: "boolean" },
          },
        }),
        execute: async (input, { abortSignal }) => shell.execute(input, {
          cwd: options.cwd,
          abortSignal,
        }),
      }),
      edit: tool({
        description: "Create a UTF-8 text file or replace oldText with newText in one file. Uses safe fuzzy whitespace fallbacks, requires a unique match by default, preserves BOM and line endings, and writes atomically.",
        inputSchema: jsonSchema<EditInput>({
          type: "object",
          additionalProperties: false,
          required: ["filePath", "oldText", "newText"],
          properties: {
            filePath: { type: "string", description: "Absolute path or path relative to the task cwd." },
            oldText: { type: "string", description: "Text to replace. Use an empty string only when creating a file that does not exist." },
            newText: { type: "string", description: "Replacement text or the complete content of a newly created file." },
            replaceAll: { type: "boolean", description: "Replace every match. Defaults to false; fuzzy block-anchor matching always requires one unique candidate." },
          },
        }),
        execute: async (input, { abortSignal }) => edit.execute(input, {
          cwd: options.cwd,
          abortSignal,
        }),
      }),
    };
    const agent = new ToolLoopAgent({
      model: this.model,
      instructions: shellInstructions(options.cwd),
      tools,
      stopWhen: isStepCount(50),
      maxOutputTokens: this.maxOutputTokens,
    });
    const result = await agent.stream({
      messages: options.messages,
      abortSignal: options.abortSignal,
      onToolExecutionStart: async ({ toolCall }) => {
        const toolExecutionId = crypto.randomUUID() as ToolExecutionId;
        toolExecutions.set(toolCall.toolCallId, toolExecutionId);
        await options.onEvent({ type: "tool.started", toolExecutionId, toolName: toolCall.toolName, input: toolCall.input });
      },
      onToolExecutionEnd: async ({ toolCall, toolOutput }) => {
        const toolExecutionId = toolExecutions.get(toolCall.toolCallId) ?? crypto.randomUUID() as ToolExecutionId;
        const output = toolOutput.type === "tool-result" ? toolOutput.output : { error: publicToolError(toolOutput.error) };
        await options.onEvent({ type: "tool.output", toolExecutionId, preview: previewOutput(output) });
        await options.onEvent({ type: "tool.completed", toolExecutionId, output });
        toolExecutions.delete(toolCall.toolCallId);
      },
    });
    const text = new Map<string, string>();
    const reasoning = new Map<string, string>();
    let cancelled = false;

    try {
      for await (const part of result.fullStream) {
        switch (part.type) {
        case "text-start":
          text.set(part.id, "");
          break;
        case "text-delta":
          text.set(part.id, `${text.get(part.id) ?? ""}${part.text}`);
          await options.onEvent({ type: "text.delta", text: part.text });
          break;
        case "text-end":
          await options.onEvent({ type: "text.completed", text: text.get(part.id) ?? "" });
          text.delete(part.id);
          break;
        case "reasoning-delta":
          reasoning.set(part.id, `${reasoning.get(part.id) ?? ""}${part.text}`);
          await options.onEvent({ type: "reasoning.delta", text: part.text });
          break;
        case "reasoning-start":
          reasoning.set(part.id, "");
          break;
        case "reasoning-end":
          await options.onEvent({ type: "reasoning.completed", text: reasoning.get(part.id) ?? "" });
          reasoning.delete(part.id);
          break;
        case "abort":
          cancelled = true;
          break;
        case "error":
          throw part.error;
        }
      }
    } finally {
      await shell.cancelAll();
    }

    if (cancelled || options.abortSignal.aborted) return { status: "cancelled", responseMessages: [] };
    return { status: "completed", responseMessages: await result.responseMessages as ModelMessage[] };
  }

  async title(prompt: string): Promise<string> {
    const result = await generateText({
      model: this.model,
      maxOutputTokens: 24,
      prompt: `Create a short session title (at most 8 words) for this request. Return only the title:\n\n${prompt}`,
    });
    return cleanTitle(result.text) || fallbackTitle(prompt);
  }
}

function shellInstructions(cwd: string): string {
  return `You are Nyan, a coding agent working in ${cwd}. Be concise and accurate.

Use the shell tool for reading, searching, builds, tests, and process work. It runs PowerShell 7 with the task directory as its default cwd. Prefer rg for text and file searches. Poll a returned processId when status is running; use write only when a process needs stdin, and kill processes you no longer need.

Use the edit tool for precise changes to one UTF-8 text file. Include enough unchanged surrounding context in oldText to make the match unique. Set replaceAll only when every occurrence should change. To create a new file, use empty oldText; never use empty oldText to overwrite an existing file. Read a file again after a rejected match instead of guessing a broader replacement.

You have full filesystem access, so handle irreversible operations carefully. Use -LiteralPath for filesystem mutations. Before recursive deletion or moving, resolve and verify the exact absolute targets. Never recursively delete a workspace root, user home, or another broad path. Do not build destructive commands by passing paths between different shells.`;
}

function previewOutput(output: unknown): string {
  const text = typeof output === "string" ? output : JSON.stringify(output);
  if (!text) return "";
  return text.length > 240 ? `${text.slice(0, 239)}…` : text;
}

function publicToolError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function fallbackTitle(prompt: string): string {
  const singleLine = prompt.replace(/\s+/g, " ").trim();
  return singleLine.length > 48 ? `${singleLine.slice(0, 47)}…` : singleLine || "New session";
}

function cleanTitle(value: string): string {
  return value.trim().replace(/^['\"]|['\"]$/g, "").replace(/\s+/g, " ").slice(0, 80);
}
