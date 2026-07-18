import { describe, expect, test } from "bun:test";
import type { ClientMessage, RequestId, SessionId } from "@nyan/protocol";
import { EchoBackend } from "./backend";

const requestId = () => crypto.randomUUID() as RequestId;

describe("echo backend", () => {
  test("initializes and emits an ordered echo turn", () => {
    const backend = new EchoBackend();
    const initialized = backend.handle({ v: 1, type: "initialize", requestId: requestId(), client: { name: "test", version: "0" } });
    expect(initialized.messages[0]?.type).toBe("initialized");

    const created = backend.handle({ v: 1, type: "session.create", requestId: requestId(), cwd: "C:\\work" });
    const sessionId = (created.messages[0] as Extract<(typeof created.messages)[number], { type: "response" }> & { result: { sessionId: SessionId } }).result.sessionId;
    const submitted = backend.handle({ v: 1, type: "prompt.submit", requestId: requestId(), sessionId, prompt: "猫" });

    expect(submitted.messages.map((message) => message.type)).toEqual([
      "response",
      "turn.started",
      "assistant.text.delta",
      "assistant.block.completed",
      "turn.completed",
    ]);
    expect(submitted.messages.slice(1).map((message) => "seq" in message ? message.seq : null)).toEqual([0, 1, 2, 3]);
  });

  test("rejects an unknown session", () => {
    const command: ClientMessage = {
      v: 1,
      type: "prompt.submit",
      requestId: requestId(),
      sessionId: crypto.randomUUID() as SessionId,
      prompt: "hello",
    };
    const response = new EchoBackend().handle(command).messages[0];
    expect(response).toMatchObject({ type: "response", ok: false, error: { code: "session_not_found" } });
  });
});
