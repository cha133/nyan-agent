import { generateText, isStepCount, ToolLoopAgent, type LanguageModel, type ModelMessage } from "ai";

export type RunnerEvent =
  | { type: "text.delta"; text: string }
  | { type: "text.completed"; text: string }
  | { type: "reasoning.delta"; text: string }
  | { type: "reasoning.completed"; text: string };

export type RunResult = { status: "completed" | "cancelled"; responseMessages: ModelMessage[] };

export class AgentRunner {
  constructor(private readonly model: LanguageModel, private readonly maxOutputTokens?: number) {}

  async run(options: {
    cwd: string;
    messages: ModelMessage[];
    abortSignal: AbortSignal;
    onEvent: (event: RunnerEvent) => void | Promise<void>;
  }): Promise<RunResult> {
    const agent = new ToolLoopAgent({
      model: this.model,
      instructions: `You are Nyan, a coding agent working in ${options.cwd}. Be concise, accurate, and respect the user's workspace.`,
      tools: {},
      stopWhen: isStepCount(50),
      maxOutputTokens: this.maxOutputTokens,
    });
    const result = await agent.stream({ messages: options.messages, abortSignal: options.abortSignal });
    const text = new Map<string, string>();
    const reasoning = new Map<string, string>();
    let cancelled = false;

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

export function fallbackTitle(prompt: string): string {
  const singleLine = prompt.replace(/\s+/g, " ").trim();
  return singleLine.length > 48 ? `${singleLine.slice(0, 47)}…` : singleLine || "New session";
}

function cleanTitle(value: string): string {
  return value.trim().replace(/^['\"]|['\"]$/g, "").replace(/\s+/g, " ").slice(0, 80);
}
