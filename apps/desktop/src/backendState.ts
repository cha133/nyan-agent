import type { ProtocolError, ServerMessage } from "@nyan/protocol";

export type BackendStatus =
  | { state: "starting" }
  | { state: "ready"; bunPath: string; bunVersion: string }
  | { state: "unavailable"; reason: string }
  | { state: "crashed"; exitCode: number | null; message: string }
  | { state: "protocol_error"; error: ProtocolError }
  | { state: "stopped" };

export function failureStatusFromMessage(message: ServerMessage): BackendStatus | undefined {
  if (message.type === "backend.error") {
    return { state: "protocol_error", error: message.error };
  }
  if (message.type === "backend.crashed") {
    return { state: "crashed", exitCode: message.exitCode, message: message.message };
  }
  return undefined;
}

export function formatBackendError(reason: unknown): string {
  if (typeof reason === "object" && reason !== null && !Array.isArray(reason)) {
    const value = reason as Record<string, unknown>;
    if (typeof value.code === "string" && typeof value.message === "string") {
      return `[${value.code}] ${value.message}`;
    }
  }
  return reason instanceof Error ? reason.message : String(reason);
}
