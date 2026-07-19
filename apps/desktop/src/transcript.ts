export type TranscriptRecord = { seq: number; createdAt: string; turnId?: string; kind: string; payload: unknown };
export type TranscriptItem = { id: string; role: "user" | "assistant" | "status" | "tool" | "subagent"; text: string };

export function toTranscriptItems(records: TranscriptRecord[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const toolIndexes = new Map<string, number>();
  const subagentIndexes = new Map<string, number>();
  for (const record of records) {
    const payload = record.payload as { itemId?: string; text?: string; toolExecutionId?: string; toolName?: string; input?: unknown; output?: unknown; subagentId?: string; taskId?: string; status?: SubagentStatus; kind?: SubagentKind; preview?: string } | undefined;
    if (record.kind === "user.message" && payload?.text) items.push({ id: payload.itemId ?? `record-${record.seq}`, role: "user", text: payload.text });
    else if (record.kind === "assistant.block" && payload?.text) items.push({ id: payload.itemId ?? `record-${record.seq}`, role: "assistant", text: payload.text });
    else if (record.kind === "turn.interrupted") items.push({ id: `record-${record.seq}`, role: "status", text: "上次运行因后端重启而中断。" });
    else if (record.kind === "tool.started" && payload?.toolExecutionId && payload.toolName) {
      toolIndexes.set(payload.toolExecutionId, items.length);
      items.push({ id: payload.toolExecutionId, role: "tool", text: formatToolStart(payload.toolName, payload.input) });
    } else if (record.kind === "tool.completed" && payload?.toolExecutionId) {
      const index = toolIndexes.get(payload.toolExecutionId);
      if (index !== undefined) items[index] = { ...items[index], text: formatToolCompletion(toolHeading(items[index].text), payload.output) };
    } else if (record.kind === "subagent.activity" && payload?.subagentId && payload.taskId && payload.status && payload.kind && typeof payload.preview === "string") {
      const item = { id: payload.subagentId, role: "subagent" as const, text: formatSubagentActivity(payload.taskId, payload.status, payload.kind, payload.preview) };
      const index = subagentIndexes.get(payload.subagentId);
      if (index === undefined) {
        subagentIndexes.set(payload.subagentId, items.length);
        items.push(item);
      } else items[index] = item;
    }
  }
  return items;
}

export function updateToolItem(items: TranscriptItem[], id: string, update: (text: string) => string): TranscriptItem[] {
  return items.map((item) => item.id === id ? { ...item, text: update(item.text) } : item);
}

type SubagentStatus = "running" | "completed" | "failed" | "cancelled";
type SubagentKind = "reasoning" | "tool" | "text";

export function updateSubagentItem(items: TranscriptItem[], subagentId: string, taskId: string, status: SubagentStatus, kind: SubagentKind, preview: string): TranscriptItem[] {
  const item = { id: subagentId, role: "subagent" as const, text: formatSubagentActivity(taskId, status, kind, preview) };
  return items.some((current) => current.id === subagentId)
    ? items.map((current) => current.id === subagentId ? item : current)
    : [...items, item];
}

export function formatSubagentActivity(taskId: string, status: SubagentStatus, kind: SubagentKind, preview: string): string {
  const statusLabel = ({ running: "运行中", completed: "已完成", failed: "失败", cancelled: "已停止" } as const)[status];
  const kindLabel = ({ reasoning: "思考", tool: "工具", text: "输出" } as const)[kind];
  return `${taskId} · ${statusLabel} · ${kindLabel}${preview ? `\n${preview}` : ""}`;
}

export function toolHeading(text: string): string {
  return text.split("\n\n", 1)[0] ?? text;
}

export function formatToolStart(toolName: string, input: unknown): string {
  const value = input as { command?: unknown; processId?: unknown; action?: unknown; filePath?: unknown } | undefined;
  const detail = typeof value?.filePath === "string"
    ? value.filePath
    : typeof value?.command === "string"
    ? value.command
    : [value?.action, value?.processId].filter((part) => typeof part === "string").join(" ");
  const compact = detail.replace(/\s+/g, " ").trim();
  return `${toolName} · 运行中${compact ? `\n${compact.slice(0, 500)}` : ""}`;
}

export function formatToolCompletion(heading: string, output: unknown): string {
  const value = output as { status?: unknown; output?: unknown; diff?: unknown; exitCode?: unknown; originalBytes?: unknown; truncated?: unknown; error?: unknown } | undefined;
  const hasError = typeof value?.error === "string" && value.error.length > 0;
  const status = hasError ? "failed" : typeof value?.status === "string" ? value.status : "completed";
  const exit = typeof value?.exitCode === "number" ? ` · exit ${value.exitCode}` : "";
  const truncation = value?.truncated && typeof value.originalBytes === "number" ? ` · ${value.originalBytes} bytes（已截断）` : "";
  const title = heading.replace(" · 运行中", ` · ${status}${exit}${truncation}`);
  const detail = typeof value?.diff === "string" && value.diff
    ? value.diff
    : typeof value?.output === "string" && value.output
      ? value.output
      : hasError ? value.error as string : "";
  return detail ? `${title}\n\n${detail}` : title;
}
