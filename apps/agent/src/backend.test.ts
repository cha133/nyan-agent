import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import type { ProjectId, RequestId, ServerMessage, SessionId, TurnId } from "@nyan/protocol";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunnerEvent } from "./agent-runner";
import { AgentBackend } from "./backend";
import { parseConfig } from "./config";
import { resolveNyanPaths } from "./paths";

const requestId = () => crypto.randomUUID() as RequestId;
const config = parseConfig({
  version: 1,
  default_model: "test/model",
  providers: [{ id: "test", kind: "openai-compatible", base_url: "https://example.test/v1", api_key: "secret", models: ["model"] }],
});

async function createBackend(runner?: {
  run(options: { messages: ModelMessage[]; abortSignal: AbortSignal; onEvent: (event: RunnerEvent) => void | Promise<void> }): Promise<{ status: "completed" | "cancelled"; responseMessages: ModelMessage[] }>;
  title(prompt: string): Promise<string>;
}) {
  const root = await mkdtemp(join(tmpdir(), "nyan-backend-"));
  const paths = resolveNyanPaths({ XDG_CONFIG_HOME: join(root, "cfg"), XDG_DATA_HOME: join(root, "data"), XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache") }, root);
  const events: ServerMessage[] = [];
  const defaultRunner = {
    async run(options: { onEvent: (event: RunnerEvent) => void | Promise<void> }) {
      await options.onEvent({ type: "text.delta", text: "猫" });
      await options.onEvent({ type: "text.completed", text: "猫" });
      return { status: "completed" as const, responseMessages: [{ role: "assistant", content: [{ type: "text", text: "猫" }] }] satisfies ModelMessage[] };
    },
    async title() { return "Cat task"; },
  };
  const backend = new AgentBackend({ paths, config, runnerFactory: () => runner ?? defaultRunner, emit: (event) => { events.push(event); } });
  return { backend, events, root };
}

async function createSession(backend: AgentBackend): Promise<SessionId> {
  const created = await backend.handle({ v: 1, type: "session.create", requestId: requestId(), cwd: "C:\\work" });
  return (created.messages[0] as Extract<ServerMessage, { type: "response" }> & { result: { id: SessionId } }).result.id;
}

describe("agent backend", () => {
  test("accepts a prompt and emits an ordered real-runner turn", async () => {
    const { backend, events } = await createBackend();
    const initialized = await backend.handle({ v: 1, type: "initialize", requestId: requestId(), client: { name: "test", version: "0" } });
    expect(initialized.messages[0]?.type).toBe("initialized");
    const sessionId = await createSession(backend);
    const submitted = await backend.handle({ v: 1, type: "prompt.submit", requestId: requestId(), sessionId, prompt: "猫" });
    submitted.start?.();
    await waitFor(() => events.some((event) => event.type === "turn.completed"));

    expect(submitted.messages[0]).toMatchObject({ type: "response", ok: true, result: { accepted: true, sessionId } });
    expect(events.map((event) => event.type)).toEqual(["turn.started", "assistant.text.delta", "assistant.block.completed", "turn.completed"]);
    expect(events.map((event) => "seq" in event ? event.seq : null)).toEqual([0, 1, 2, 3]);
  });

  test("enforces one global active turn and supports cancellation", async () => {
    const runner = {
      async run(options: { abortSignal: AbortSignal }) {
        if (!options.abortSignal.aborted) {
          await new Promise<void>((resolve) => options.abortSignal.addEventListener("abort", () => resolve(), { once: true }));
        }
        return { status: "cancelled" as const, responseMessages: [] };
      },
      async title() { return "Waiting"; },
    };
    const { backend, events } = await createBackend(runner);
    const firstSession = await createSession(backend);
    const secondSession = await createSession(backend);
    const first = await backend.handle({ v: 1, type: "prompt.submit", requestId: requestId(), sessionId: firstSession, prompt: "wait" });
    first.start?.();
    const turnId = (first.messages[0] as Extract<ServerMessage, { type: "response" }> & { result: { turnId: TurnId } }).result.turnId;
    const rejected = await backend.handle({ v: 1, type: "prompt.submit", requestId: requestId(), sessionId: secondSession, prompt: "also wait" });
    expect(rejected.messages[0]).toMatchObject({ type: "response", ok: false, error: { code: "turn_in_progress" } });
    const cancelled = await backend.handle({ v: 1, type: "turn.cancel", requestId: requestId(), sessionId: firstSession, turnId });
    expect(cancelled.messages[0]).toMatchObject({ type: "response", ok: true, result: { status: "cancelling" } });
    await waitFor(() => events.some((event) => event.type === "turn.cancelled"));
  });

  test("rejects an unknown session", async () => {
    const { backend } = await createBackend();
    const response = await backend.handle({ v: 1, type: "prompt.submit", requestId: requestId(), sessionId: crypto.randomUUID() as SessionId, prompt: "hello" });
    expect(response.messages[0]).toMatchObject({ type: "response", ok: false, error: { code: "session_not_found" } });
  });

  test("binds new sessions to a persisted project and returns transcript on load", async () => {
    const { backend, root } = await createBackend();
    const projectPath = join(root, "workspace");
    await mkdir(projectPath);
    const added = await backend.handle({ v: 1, type: "project.add", requestId: requestId(), path: projectPath });
    const projectId = (added.messages[0] as Extract<ServerMessage, { type: "response" }> & { result: { project: { id: ProjectId } } }).result.project.id;
    const created = await backend.handle({ v: 1, type: "session.create", requestId: requestId(), projectId });
    const session = (created.messages[0] as Extract<ServerMessage, { type: "response" }> & { result: { id: SessionId; projectId: ProjectId; cwd: string } }).result;
    const loaded = await backend.handle({ v: 1, type: "session.load", requestId: requestId(), sessionId: session.id });

    expect(session).toMatchObject({ projectId, cwd: projectPath });
    expect(loaded.messages[0]).toMatchObject({ type: "response", ok: true, result: { session: { id: session.id }, transcript: [] } });
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await Bun.sleep(5);
  }
  throw new Error("timed out waiting for backend event");
}
