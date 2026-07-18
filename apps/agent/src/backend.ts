import type { ClientMessage, ServerMessage, SessionId, TurnId } from "@nyan/protocol";

type HandleResult = {
  messages: ServerMessage[];
  shouldExit?: boolean;
};

export class EchoBackend {
  private readonly sessions = new Map<SessionId, { cwd: string }>();

  handle(message: ClientMessage): HandleResult {
    switch (message.type) {
      case "initialize":
        return {
          messages: [{
            v: 1,
            type: "initialized",
            requestId: message.requestId,
            backend: { name: "nyan-agent", version: "0.1.0", bunVersion: Bun.version },
          }],
        };
      case "shutdown":
        return {
          messages: [{ v: 1, type: "response", requestId: message.requestId, ok: true, result: { status: "shutting_down" } }],
          shouldExit: true,
        };
      case "session.create": {
        const sessionId = crypto.randomUUID() as SessionId;
        this.sessions.set(sessionId, { cwd: message.cwd });
        return {
          messages: [{ v: 1, type: "response", requestId: message.requestId, ok: true, result: { sessionId, cwd: message.cwd } }],
        };
      }
      case "session.load": {
        const session = this.sessions.get(message.sessionId);
        return session
          ? { messages: [{ v: 1, type: "response", requestId: message.requestId, ok: true, result: { sessionId: message.sessionId, ...session } }] }
          : { messages: [{ v: 1, type: "response", requestId: message.requestId, ok: false, error: { code: "session_not_found", message: "Session was not found" } }] };
      }
      case "prompt.submit": {
        if (!this.sessions.has(message.sessionId)) {
          return { messages: [{ v: 1, type: "response", requestId: message.requestId, ok: false, error: { code: "session_not_found", message: "Session was not found" } }] };
        }
        const turnId = crypto.randomUUID() as TurnId;
        return {
          messages: [
            { v: 1, type: "response", requestId: message.requestId, ok: true, result: { accepted: true, turnId } },
            { v: 1, type: "turn.started", sessionId: message.sessionId, turnId, seq: 0 },
            { v: 1, type: "assistant.text.delta", sessionId: message.sessionId, turnId, seq: 1, text: message.prompt },
            { v: 1, type: "assistant.block.completed", sessionId: message.sessionId, turnId, seq: 2, text: message.prompt },
            { v: 1, type: "turn.completed", sessionId: message.sessionId, turnId, seq: 3 },
          ],
        };
      }
      case "turn.cancel":
        return {
          messages: [{ v: 1, type: "response", requestId: message.requestId, ok: true, result: { status: "already_completed", turnId: message.turnId } }],
        };
    }
  }
}
