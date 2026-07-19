import type { LanguageModel, ModelMessage } from "ai";
import type { ClientMessage, ProtocolError, ServerMessage, SessionId, TurnEvent, TurnId } from "@nyan/protocol";
import { homedir } from "node:os";
import { AgentRunner, fallbackTitle, type RunResult, type RunnerEvent } from "./agent-runner";
import { type ModelLimits, type NyanConfig, ConfigError, loadConfig } from "./config";
import { ModelCatalog } from "./models";
import { type NyanPaths, resolveNyanPaths } from "./paths";
import { ProviderRegistry } from "./providers";
import { ProjectStore } from "./projects";
import { SessionStore } from "./sessions";
import { RuntimeStateStore } from "./state";

type HandleResult = {
  messages: ServerMessage[];
  start?: () => void;
  beforeExit?: () => Promise<void>;
  shouldExit?: boolean;
};

type Runner = {
  run(options: { cwd: string; messages: ModelMessage[]; abortSignal: AbortSignal; onEvent: (event: RunnerEvent) => void | Promise<void> }): Promise<RunResult>;
  title(prompt: string): Promise<string>;
};

type BackendOptions = {
  paths?: NyanPaths;
  config?: NyanConfig;
  runnerFactory?: (model: LanguageModel, limits?: ModelLimits) => Runner;
  emit?: (message: ServerMessage) => void | Promise<void>;
};

type ActiveTurn = { sessionId: SessionId; turnId: TurnId; controller: AbortController; done: Promise<void> };
type TurnEventPayload = TurnEvent extends infer Event ? Event extends TurnEvent ? Omit<Event, "v" | "sessionId" | "turnId" | "seq"> : never : never;

export class AgentBackend {
  private readonly paths: NyanPaths;
  private readonly store: SessionStore;
  private readonly projects: ProjectStore;
  private readonly state: RuntimeStateStore;
  private readonly runnerFactory: (model: LanguageModel, limits?: ModelLimits) => Runner;
  private readonly emit: (message: ServerMessage) => void | Promise<void>;
  private config?: NyanConfig;
  private registry?: ProviderRegistry;
  private catalog?: ModelCatalog;
  private booted = false;
  private configError?: ProtocolError;
  private active?: ActiveTurn;

  constructor(options: BackendOptions = {}) {
    this.paths = options.paths ?? resolveNyanPaths();
    this.store = new SessionStore(this.paths);
    this.projects = new ProjectStore(this.paths);
    this.state = new RuntimeStateStore(this.paths);
    this.config = options.config;
    this.runnerFactory = options.runnerFactory ?? ((model, limits) => new AgentRunner(model, limits?.maxOutputTokens));
    this.emit = options.emit ?? (() => {});
  }

  async handle(message: ClientMessage): Promise<HandleResult> {
    await this.boot();
    switch (message.type) {
      case "initialize":
        return { messages: [{ v: 1, type: "initialized", requestId: message.requestId, backend: { name: "nyan-agent", version: "0.1.0", bunVersion: Bun.version } }] };
      case "shutdown": {
        this.active?.controller.abort();
        return {
          messages: [ok(message.requestId, { status: "shutting_down" })],
          shouldExit: true,
          beforeExit: async () => { await this.active?.done; },
        };
      }
      case "project.list": {
        const projects = await this.projects.list();
        const recentProjectId = (await this.state.read()).recentProjectId;
        const validRecentProjectId = projects.some((project) => project.id === recentProjectId) ? recentProjectId : null;
        if (recentProjectId && !validRecentProjectId) await this.state.update({ recentProjectId: null });
        return { messages: [ok(message.requestId, { projects, recentProjectId: validRecentProjectId })] };
      }
      case "project.add":
        try {
          return { messages: [ok(message.requestId, { project: await this.projects.add(message.path) })] };
        } catch (error) {
          return { messages: [failed(message.requestId, publicError(error))] };
        }
      case "project.remove": {
        const removed = await this.projects.remove(message.projectId);
        if (removed && (await this.state.read()).recentProjectId === message.projectId) {
          await this.state.update({ recentProjectId: null });
        }
        return { messages: [removed ? ok(message.requestId, { removed: true }) : failed(message.requestId, projectNotFound())] };
      }
      case "project.context.set": {
        if (message.projectId && !await this.projects.get(message.projectId)) {
          return { messages: [failed(message.requestId, projectNotFound())] };
        }
        await this.state.update({ recentProjectId: message.projectId });
        return { messages: [ok(message.requestId, { projectId: message.projectId })] };
      }
      case "model.list": {
        if (this.configError) return { messages: [failed(message.requestId, this.configError)] };
        try {
          const models = await this.catalog!.list({ refresh: message.refresh });
          const selectedModel = await this.catalog!.selectedModel(models);
          return { messages: [ok(message.requestId, { models, selectedModel })] };
        } catch (error) {
          return { messages: [failed(message.requestId, publicError(error))] };
        }
      }
      case "session.list":
        return { messages: [ok(message.requestId, { sessions: await this.store.list() })] };
      case "session.create": {
        if (this.configError) return { messages: [failed(message.requestId, this.configError)] };
        try {
          const model = await this.resolveModel(message.model);
          const project = message.projectId ? await this.projects.get(message.projectId) : undefined;
          if (message.projectId && !project) return { messages: [failed(message.requestId, projectNotFound())] };
          const session = await this.store.create(project?.path ?? message.cwd ?? homedir(), model, project?.id);
          await this.catalog!.rememberModel(model);
          return { messages: [ok(message.requestId, { ...session, sessionId: session.id })] };
        } catch (error) {
          return { messages: [failed(message.requestId, publicError(error))] };
        }
      }
      case "session.load": {
        const session = await this.store.load(message.sessionId);
        return { messages: [session ? ok(message.requestId, { session, transcript: await this.store.readTranscript(message.sessionId) }) : failed(message.requestId, notFound())] };
      }
      case "session.model.set": {
        if (this.configError) return { messages: [failed(message.requestId, this.configError)] };
        if (this.active?.sessionId === message.sessionId) {
          return { messages: [failed(message.requestId, { code: "turn_in_progress", message: "The running task model cannot be changed" })] };
        }
        try {
          const session = await this.store.load(message.sessionId);
          if (!session) return { messages: [failed(message.requestId, notFound())] };
          const model = await this.resolveModel(message.model);
          const updated = await this.store.update(message.sessionId, { model });
          await this.catalog!.rememberModel(model);
          return { messages: [ok(message.requestId, { session: updated })] };
        } catch (error) {
          return { messages: [failed(message.requestId, publicError(error))] };
        }
      }
      case "session.remove": {
        if (this.active?.sessionId === message.sessionId) {
          return { messages: [failed(message.requestId, { code: "turn_in_progress", message: "The running task cannot be removed" })] };
        }
        const removed = await this.store.remove(message.sessionId);
        return { messages: [removed ? ok(message.requestId, { removed: true }) : failed(message.requestId, notFound())] };
      }
      case "prompt.submit":
        return this.submit(message);
      case "turn.cancel": {
        if (!this.active || this.active.sessionId !== message.sessionId || this.active.turnId !== message.turnId) {
          return { messages: [ok(message.requestId, { status: "already_completed", turnId: message.turnId })] };
        }
        this.active.controller.abort();
        return { messages: [ok(message.requestId, { status: "cancelling", turnId: message.turnId })] };
      }
    }
  }

  private async submit(message: Extract<ClientMessage, { type: "prompt.submit" }>): Promise<HandleResult> {
    if (this.configError) return { messages: [failed(message.requestId, this.configError)] };
    if (this.active) return { messages: [failed(message.requestId, { code: "turn_in_progress", message: "Another turn is already running" })] };
    const session = await this.store.load(message.sessionId);
    if (!session) return { messages: [failed(message.requestId, notFound())] };
    if (!message.prompt.trim()) return { messages: [failed(message.requestId, { code: "prompt_empty", message: "Prompt cannot be empty" })] };

    const turnId = crypto.randomUUID() as TurnId;
    const controller = new AbortController();
    await this.store.append(session.id, "user.message", { itemId: crypto.randomUUID(), text: message.prompt }, turnId);
    await this.store.append(session.id, "model.messages", [{ role: "user", content: message.prompt } satisfies ModelMessage], turnId);
    await this.store.update(session.id, { status: "running", activeTurnId: turnId });

    const active: ActiveTurn = { sessionId: session.id, turnId, controller, done: Promise.resolve() };
    this.active = active;
    return {
      messages: [ok(message.requestId, { accepted: true, sessionId: session.id, turnId })],
      start: () => { active.done = this.execute(session.id, turnId, controller, message.prompt); },
    };
  }

  private async resolveModel(requested?: string): Promise<string> {
    const models = await this.catalog!.list();
    if (!requested) return this.catalog!.selectedModel(models);
    if (!models.some((model) => model.key === requested)) throw new Error("invalid_model_key: The selected model is not available");
    return requested;
  }

  private async execute(sessionId: SessionId, turnId: TurnId, controller: AbortController, prompt: string): Promise<void> {
    let seq = 0;
    const send = async (event: TurnEventPayload) => {
      await this.emit({ v: 1, sessionId, turnId, seq: seq++, ...event } as TurnEvent);
    };
    try {
      const session = await this.store.load(sessionId);
      if (!session) throw new Error("session_not_found");
      const runner = this.runnerFactory(this.registry!.model(session.model), this.registry!.limits(session.model));
      const messages = await this.store.messages(sessionId);
      await this.store.append(sessionId, "turn.started", {}, turnId);
      await send({ type: "turn.started" });

      if (session.title === "New session") {
        void runner.title(prompt)
          .catch(() => fallbackTitle(prompt))
          .then(async (title) => {
            await this.store.setTitle(sessionId, title);
            await this.emit({ v: 1, type: "session.title.updated", sessionId, title });
          })
          .catch(() => {});
      }

      const subagentsStarted = new Set<string>();
      const result = await runner.run({
        cwd: session.cwd,
        messages,
        abortSignal: controller.signal,
        onEvent: async (event) => {
          if (event.type === "text.delta") await send({ type: "assistant.text.delta", text: event.text });
          else if (event.type === "text.completed") {
            await this.store.append(sessionId, "assistant.block", { itemId: crypto.randomUUID(), text: event.text }, turnId);
            await send({ type: "assistant.block.completed", text: event.text });
          } else if (event.type === "reasoning.delta") {
            await send({ type: "reasoning.delta", text: event.text });
          } else if (event.type === "reasoning.completed") {
            await this.store.append(sessionId, "assistant.reasoning", { itemId: crypto.randomUUID(), text: event.text }, turnId);
          } else if (event.type === "tool.started") {
            const payload = { toolExecutionId: event.toolExecutionId, toolName: event.toolName, input: event.input };
            await this.store.append(sessionId, "tool.started", payload, turnId);
            await send({ type: "tool.started", ...payload });
          } else if (event.type === "tool.output") {
            await send({ type: "tool.output", toolExecutionId: event.toolExecutionId, preview: event.preview });
          } else if (event.type === "subagent.activity") {
            const payload = { subagentId: event.subagentId, taskId: event.taskId, status: event.status, kind: event.kind, preview: event.preview };
            if (event.status !== "running" || !subagentsStarted.has(event.subagentId)) {
              await this.store.append(sessionId, "subagent.activity", payload, turnId);
              subagentsStarted.add(event.subagentId);
            }
            await send({ type: "subagent.activity", ...payload });
          } else {
            const payload = { toolExecutionId: event.toolExecutionId, output: event.output };
            await this.store.append(sessionId, "tool.completed", payload, turnId);
            await send({ type: "tool.completed", ...payload });
          }
        },
      });

      if (result.status === "cancelled") {
        await this.store.append(sessionId, "turn.cancelled", {}, turnId);
        await this.store.update(sessionId, { status: "cancelled", activeTurnId: undefined });
        await send({ type: "turn.cancelled" });
      } else {
        await this.store.append(sessionId, "model.messages", result.responseMessages, turnId);
        await this.store.append(sessionId, "turn.completed", {}, turnId);
        await this.store.update(sessionId, { status: "completed", activeTurnId: undefined });
        await send({ type: "turn.completed" });
      }
    } catch (error) {
      const detail = publicError(error);
      const cancelled = controller.signal.aborted;
      await this.store.append(sessionId, cancelled ? "turn.cancelled" : "turn.failed", cancelled ? {} : detail, turnId).catch(() => {});
      await this.store.update(sessionId, { status: cancelled ? "cancelled" : "failed", activeTurnId: undefined }).catch(() => {});
      await send(cancelled ? { type: "turn.cancelled" } : { type: "turn.failed", error: detail });
    } finally {
      if (this.active?.turnId === turnId) this.active = undefined;
    }
  }

  private async boot(): Promise<void> {
    if (this.booted) return;
    await this.store.recover();
    try {
      this.config ??= await loadConfig(this.paths);
      this.registry = new ProviderRegistry(this.config);
      this.catalog = new ModelCatalog(this.config, this.paths, undefined, undefined, this.state);
    } catch (error) {
      this.configError = publicError(error);
    }
    this.booted = true;
  }
}

function ok(requestId: Extract<ClientMessage, { requestId: unknown }>["requestId"], result: unknown): ServerMessage {
  return { v: 1, type: "response", requestId, ok: true, result };
}

function failed(requestId: Extract<ClientMessage, { requestId: unknown }>["requestId"], error: ProtocolError): ServerMessage {
  return { v: 1, type: "response", requestId, ok: false, error };
}

function notFound(): ProtocolError { return { code: "session_not_found", message: "Session was not found" }; }
function projectNotFound(): ProtocolError { return { code: "project_not_found", message: "Project was not found" }; }

function publicError(error: unknown): ProtocolError {
  if (error instanceof ConfigError) return { code: error.code, message: error.message };
  const message = error instanceof Error ? error.message : "Unknown error";
  const [candidate] = message.split(":", 1);
  const known = new Set(["config_missing", "config_invalid", "model_not_configured", "model_discovery_failed", "provider_not_found", "invalid_model_key", "session_not_found", "project_not_found", "project_path_invalid"]);
  const code = known.has(candidate) ? candidate : "model_request_failed";
  return { code, message: code === "model_request_failed" ? "The model request failed" : message };
}
