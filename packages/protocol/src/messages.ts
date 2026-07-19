const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type RequestId = Brand<string, "RequestId">;
export type ProjectId = Brand<string, "ProjectId">;
export type SessionId = Brand<string, "SessionId">;
export type TurnId = Brand<string, "TurnId">;
export type ToolExecutionId = Brand<string, "ToolExecutionId">;
export type SubagentId = Brand<string, "SubagentId">;

export type ProtocolError = {
  code: string;
  message: string;
  details?: unknown;
};

export type ClientMessage =
  | { v: 1; type: "initialize"; requestId: RequestId; client: { name: string; version: string } }
  | { v: 1; type: "shutdown"; requestId: RequestId }
  | { v: 1; type: "project.list"; requestId: RequestId }
  | { v: 1; type: "project.add"; requestId: RequestId; path: string }
  | { v: 1; type: "project.remove"; requestId: RequestId; projectId: ProjectId }
  | { v: 1; type: "project.context.set"; requestId: RequestId; projectId: ProjectId | null }
  | { v: 1; type: "model.list"; requestId: RequestId; refresh?: boolean }
  | { v: 1; type: "session.list"; requestId: RequestId }
  | { v: 1; type: "session.create"; requestId: RequestId; projectId?: ProjectId; cwd?: string; model?: string }
  | { v: 1; type: "session.load"; requestId: RequestId; sessionId: SessionId }
  | { v: 1; type: "session.model.set"; requestId: RequestId; sessionId: SessionId; model: string }
  | { v: 1; type: "session.remove"; requestId: RequestId; sessionId: SessionId }
  | { v: 1; type: "prompt.submit"; requestId: RequestId; sessionId: SessionId; prompt: string }
  | { v: 1; type: "turn.cancel"; requestId: RequestId; sessionId: SessionId; turnId: TurnId };

export type ServerMessage =
  | { v: 1; type: "initialized"; requestId: RequestId; backend: { name: string; version: string; bunVersion: string } }
  | { v: 1; type: "response"; requestId: RequestId; ok: true; result: unknown }
  | { v: 1; type: "response"; requestId: RequestId; ok: false; error: ProtocolError }
  | { v: 1; type: "backend.error"; error: ProtocolError }
  | { v: 1; type: "backend.crashed"; exitCode: number | null; message: string }
  | { v: 1; type: "session.title.updated"; sessionId: SessionId; title: string }
  | TurnEvent;

export type TurnEvent =
  | TurnEventBase<"turn.started">
  | (TurnEventBase<"assistant.text.delta"> & { text: string })
  | (TurnEventBase<"assistant.block.completed"> & { text: string })
  | (TurnEventBase<"reasoning.delta"> & { text: string })
  | (TurnEventBase<"tool.started"> & { toolExecutionId: ToolExecutionId; toolName: string; input: unknown })
  | (TurnEventBase<"tool.output"> & { toolExecutionId: ToolExecutionId; preview: string })
  | (TurnEventBase<"tool.completed"> & { toolExecutionId: ToolExecutionId; output: unknown })
  | (TurnEventBase<"subagent.activity"> & { subagentId: SubagentId; kind: "reasoning" | "tool" | "text"; preview: string })
  | TurnEventBase<"turn.completed">
  | (TurnEventBase<"turn.failed"> & { error: ProtocolError })
  | TurnEventBase<"turn.cancelled">;

type TurnEventBase<Type extends string> = {
  v: 1;
  type: Type;
  sessionId: SessionId;
  turnId: TurnId;
  seq: number;
};

const clientTypes = new Set<ClientMessage["type"]>([
  "initialize",
  "shutdown",
  "project.list",
  "project.add",
  "project.remove",
  "project.context.set",
  "model.list",
  "session.list",
  "session.create",
  "session.load",
  "session.model.set",
  "session.remove",
  "prompt.submit",
  "turn.cancel",
]);

const serverTypes = new Set<ServerMessage["type"]>([
  "initialized",
  "response",
  "backend.error",
  "backend.crashed",
  "session.title.updated",
  "turn.started",
  "assistant.text.delta",
  "assistant.block.completed",
  "reasoning.delta",
  "tool.started",
  "tool.output",
  "tool.completed",
  "subagent.activity",
  "turn.completed",
  "turn.failed",
  "turn.cancelled",
]);

export function parseClientMessage(value: unknown): ClientMessage {
  const message = parseEnvelope(value, clientTypes);
  requireUuid(message, "requestId");

  switch (message.type) {
    case "initialize":
      requireObject(message, "client");
      requireString(message.client, "name");
      requireString(message.client, "version");
      break;
    case "project.add":
      requireString(message, "path");
      break;
    case "project.remove":
      requireUuid(message, "projectId");
      break;
    case "project.context.set":
      if (message.projectId !== null) requireUuid(message, "projectId");
      break;
    case "model.list":
      if (message.refresh !== undefined && typeof message.refresh !== "boolean") throw invalid("refresh must be a boolean");
      break;
    case "session.create":
      if (message.projectId !== undefined) requireUuid(message, "projectId");
      if (message.cwd !== undefined) requireString(message, "cwd");
      if (message.model !== undefined) requireString(message, "model");
      break;
    case "session.load":
    case "session.remove":
      requireUuid(message, "sessionId");
      break;
    case "session.model.set":
      requireUuid(message, "sessionId");
      requireString(message, "model");
      break;
    case "prompt.submit":
      requireUuid(message, "sessionId");
      requireString(message, "prompt");
      break;
    case "turn.cancel":
      requireUuid(message, "sessionId");
      requireUuid(message, "turnId");
      break;
  }

  return message as ClientMessage;
}

export function parseServerMessage(value: unknown): ServerMessage {
  const message = parseEnvelope(value, serverTypes);

  if (message.type === "initialized" || message.type === "response") {
    requireUuid(message, "requestId");
  }

  if (message.type === "initialized") {
    requireObject(message, "backend");
    requireString(message.backend, "name");
    requireString(message.backend, "version");
    requireString(message.backend, "bunVersion");
  } else if (message.type === "response") {
    if (typeof message.ok !== "boolean") throw invalid("response.ok must be a boolean");
    if (!message.ok) requireError(message, "error");
  } else if (message.type === "backend.error") {
    requireError(message, "error");
  } else if (message.type === "backend.crashed") {
    if (message.exitCode !== null && typeof message.exitCode !== "number") throw invalid("backend.crashed.exitCode must be a number or null");
    requireString(message, "message");
  } else if (message.type === "session.title.updated") {
    requireUuid(message, "sessionId");
    requireString(message, "title");
  } else {
    requireUuid(message, "sessionId");
    requireUuid(message, "turnId");
    if (!Number.isSafeInteger(message.seq) || (message.seq as number) < 0) throw invalid("turn event seq must be a non-negative safe integer");
    switch (message.type) {
      case "assistant.text.delta":
      case "assistant.block.completed":
      case "reasoning.delta":
        requireString(message, "text");
        break;
      case "tool.started":
        requireUuid(message, "toolExecutionId");
        requireString(message, "toolName");
        break;
      case "tool.output":
        requireUuid(message, "toolExecutionId");
        requireString(message, "preview");
        break;
      case "tool.completed":
        requireUuid(message, "toolExecutionId");
        break;
      case "subagent.activity":
        requireUuid(message, "subagentId");
        if (message.kind !== "reasoning" && message.kind !== "tool" && message.kind !== "text") throw invalid("subagent.activity.kind is invalid");
        requireString(message, "preview");
        break;
      case "turn.failed":
        requireError(message, "error");
        break;
    }
  }

  return message as ServerMessage;
}

function parseEnvelope<T extends string>(value: unknown, types: Set<T>): Record<string, unknown> & { type: T } {
  if (!isObject(value)) throw invalid("message must be an object");
  if (value.v !== 1) throw invalid("unsupported protocol version");
  if (typeof value.type !== "string" || !types.has(value.type as T)) throw invalid("unknown message type");
  return value as Record<string, unknown> & { type: T };
}

function requireObject(object: Record<string, unknown>, key: string): asserts object is Record<string, unknown> & Record<typeof key, Record<string, unknown>> {
  if (!isObject(object[key])) throw invalid(`${key} must be an object`);
}

function requireString(object: Record<string, unknown>, key: string): void {
  if (typeof object[key] !== "string") throw invalid(`${key} must be a string`);
}

function requireUuid(object: Record<string, unknown>, key: string): void {
  if (typeof object[key] !== "string" || !UUID_V4.test(object[key])) throw invalid(`${key} must be a UUIDv4`);
}

function requireError(object: Record<string, unknown>, key: string): void {
  requireObject(object, key);
  requireString(object[key], "code");
  requireString(object[key], "message");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): TypeError {
  return new TypeError(`invalid_protocol_message: ${message}`);
}
