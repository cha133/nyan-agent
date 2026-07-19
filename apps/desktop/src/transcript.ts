export type TranscriptRecord = { seq: number; createdAt: string; turnId?: string; kind: string; payload: unknown };
export type TranscriptItem = { id: string; role: "user" | "assistant" | "status" | "tool"; text: string };

export function toTranscriptItems(records: TranscriptRecord[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const toolIndexes = new Map<string, number>();
  for (const record of records) {
    const payload = record.payload as { itemId?: string; text?: string; toolExecutionId?: string; toolName?: string; input?: unknown; output?: unknown } | undefined;
    if (record.kind === "user.message" && payload?.text) items.push({ id: payload.itemId ?? `record-${record.seq}`, role: "user", text: payload.text });
    else if (record.kind === "assistant.block" && payload?.text) items.push({ id: payload.itemId ?? `record-${record.seq}`, role: "assistant", text: payload.text });
    else if (record.kind === "turn.interrupted") items.push({ id: `record-${record.seq}`, role: "status", text: "上次运行因后端重启而中断。" });
    else if (record.kind === "tool.started" && payload?.toolExecutionId && payload.toolName) {
      toolIndexes.set(payload.toolExecutionId, items.length);
      items.push({ id: payload.toolExecutionId, role: "tool", text: formatToolStart(payload.toolName, payload.input) });
    } else if (record.kind === "tool.completed" && payload?.toolExecutionId) {
      const index = toolIndexes.get(payload.toolExecutionId);
      if (index !== undefined) items[index] = { ...items[index], text: formatToolCompletion(toolHeading(items[index].text), payload.output) };
    }
  }
  return items;
}

export function updateToolItem(items: TranscriptItem[], id: string, update: (text: string) => string): TranscriptItem[] {
  return items.map((item) => item.id === id ? { ...item, text: update(item.text) } : item);
}

export function toolHeading(text: string): string {
  return text.split("\n\n", 1)[0] ?? text;
}

export function formatToolStart(toolName: string, input: unknown): string {
  const value = input as { command?: unknown; processId?: unknown; action?: unknown } | undefined;
  const detail = typeof value?.command === "string"
    ? value.command
    : [value?.action, value?.processId].filter((part) => typeof part === "string").join(" ");
  const compact = detail.replace(/\s+/g, " ").trim();
  return `${toolName} · 运行中${compact ? `\n${compact.slice(0, 500)}` : ""}`;
}

export function formatToolCompletion(heading: string, output: unknown): string {
  const value = output as { status?: unknown; output?: unknown; exitCode?: unknown; originalBytes?: unknown; truncated?: unknown; error?: unknown } | undefined;
  const hasError = typeof value?.error === "string" && value.error.length > 0;
  const status = hasError ? "failed" : typeof value?.status === "string" ? value.status : "completed";
  const exit = typeof value?.exitCode === "number" ? ` · exit ${value.exitCode}` : "";
  const truncation = value?.truncated && typeof value.originalBytes === "number" ? ` · ${value.originalBytes} bytes（已截断）` : "";
  const title = heading.replace(" · 运行中", ` · ${status}${exit}${truncation}`);
  const detail = typeof value?.output === "string" && value.output ? value.output : hasError ? value.error as string : "";
  return detail ? `${title}\n\n${detail}` : title;
}
