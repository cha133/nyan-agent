import { useEffect, useRef, useState } from "react";
import { Button, ListBox, Select } from "@heroui/react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { ServerMessage } from "@nyan/protocol";
import { Folder, FolderPlus, MessageSquare, Plus, Send, Square, Trash2 } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PromptEditor } from "./PromptEditor";
import { failureStatusFromMessage, formatBackendError, type BackendStatus } from "./backendState";
import { INITIAL_VISIBLE_ITEMS, nextVisibleLimit, resetVisibleLimits, visibleItems, visibleLimit } from "./listVisibility";
import { activeTurnFromSessions } from "./sessionState";
import { formatToolCompletion, formatToolStart, toolHeading, toTranscriptItems, updateSubagentItem, updateToolItem, type TranscriptItem, type TranscriptRecord } from "./transcript";
import "./App.css";

type Project = { id: string; name: string; path: string; createdAt: string; updatedAt: string };
type Session = { id: string; projectId?: string; cwd: string; title: string; model: string; status: string; createdAt: string; updatedAt: string; activeTurnId?: string };
type AvailableModel = { key: string; providerId: string; modelId: string; source: "static" | "discovered"; stale: boolean; unavailable?: boolean };

function App() {
  const [status, setStatus] = useState<BackendStatus>({ state: "starting" });
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [draftModelKey, setDraftModelKey] = useState<string>();
  const [selectedSession, setSelectedSession] = useState<Session>();
  const selectedSessionRef = useRef<string | undefined>(undefined);
  const projectContextHydrated = useRef(false);
  const [draftProjectId, setDraftProjectId] = useState<string>();
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [prompt, setPrompt] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeTurn, setActiveTurn] = useState<{ sessionId: string; turnId: string }>();
  const [visibleLimits, setVisibleLimits] = useState<Record<string, number>>({});

  useEffect(() => {
    let active = true;
    const channel = new Channel<ServerMessage>();
    channel.onmessage = (message) => {
      if (!active) return;
      const failureStatus = failureStatusFromMessage(message);
      if (failureStatus) {
        setSubmitting(false);
        setActiveTurn(undefined);
        setStatus(failureStatus);
        return;
      }
      if (message.type === "session.title.updated") {
        setSessions((current) => current.map((session) => session.id === message.sessionId ? { ...session, title: message.title } : session));
        setSelectedSession((current) => current?.id === message.sessionId ? { ...current, title: message.title } : current);
        return;
      }
      if (!("sessionId" in message)) return;
      if (message.type === "turn.started") {
        setSubmitting(false);
        setActiveTurn({ sessionId: message.sessionId, turnId: message.turnId });
        setSessions((current) => current.map((session) => session.id === message.sessionId ? { ...session, status: "running", activeTurnId: message.turnId } : session));
        setSelectedSession((current) => current?.id === message.sessionId ? { ...current, status: "running", activeTurnId: message.turnId } : current);
      }
      if (message.type === "assistant.text.delta" && message.sessionId === selectedSessionRef.current) {
        setStreamingText((current) => current + message.text);
      }
      if (message.type === "assistant.block.completed" && message.sessionId === selectedSessionRef.current) {
        setStreamingText("");
        setTranscript((current) => [...current, { id: `${message.turnId}-${message.seq}`, role: "assistant", text: message.text }]);
      }
      if (message.type === "tool.started" && message.sessionId === selectedSessionRef.current) {
        setTranscript((current) => [...current, { id: message.toolExecutionId, role: "tool", text: formatToolStart(message.toolName, message.input) }]);
      }
      if (message.type === "tool.output" && message.sessionId === selectedSessionRef.current) {
        setTranscript((current) => updateToolItem(current, message.toolExecutionId, (text) => `${toolHeading(text)}\n\n${message.preview}`));
      }
      if (message.type === "tool.completed" && message.sessionId === selectedSessionRef.current) {
        setTranscript((current) => updateToolItem(current, message.toolExecutionId, (text) => formatToolCompletion(toolHeading(text), message.output)));
      }
      if (message.type === "subagent.activity" && message.sessionId === selectedSessionRef.current) {
        setTranscript((current) => updateSubagentItem(current, message.subagentId, message.taskId, message.status, message.kind, message.preview));
      }
      if (message.type === "turn.completed" || message.type === "turn.cancelled" || message.type === "turn.failed") {
        const terminalStatus = message.type === "turn.completed" ? "completed" : message.type === "turn.cancelled" ? "cancelled" : "failed";
        setSubmitting(false);
        setActiveTurn((current) => current?.turnId === message.turnId ? undefined : current);
        setSessions((current) => current.map((session) => session.id === message.sessionId ? { ...session, status: terminalStatus, activeTurnId: undefined } : session));
        setSelectedSession((current) => current?.id === message.sessionId ? { ...current, status: terminalStatus, activeTurnId: undefined } : current);
        void refreshLists();
      }
      if (message.type === "turn.failed") setError(message.error.message);
    };

    const subscriptionTimer = window.setTimeout(() => {
      Promise.all([
        invoke<void>("backend_subscribe", { onEvent: channel }),
        invoke<BackendStatus>("backend_status").then((nextStatus) => {
          if (active) setStatus(nextStatus);
        }),
      ]).catch((reason: unknown) => {
        if (active) setError(formatBackendError(reason));
      });
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(subscriptionTimer);
    };
  }, []);

  useEffect(() => {
    if (status.state === "ready") void refreshLists();
  }, [status.state]);

  async function refreshLists() {
    const [projectResult, sessionResult, modelResult] = await Promise.allSettled([
        invoke<{ projects: Project[]; recentProjectId: string | null }>("list_projects"),
        invoke<{ sessions: Session[] }>("list_sessions"),
        invoke<{ models: AvailableModel[]; selectedModel: string }>("list_models"),
      ]);
    if (projectResult.status === "fulfilled") {
      setProjects(projectResult.value.projects);
      if (!projectContextHydrated.current) {
        setDraftProjectId(projectResult.value.recentProjectId ?? undefined);
        projectContextHydrated.current = true;
      }
    }
    if (sessionResult.status === "fulfilled") {
      const nextSessions = sessionResult.value.sessions;
      setSessions(nextSessions);
      setSelectedSession((current) => current ? nextSessions.find((session) => session.id === current.id) ?? current : current);
      const restoredTurn = activeTurnFromSessions(nextSessions);
      setActiveTurn((current) => restoredTurn ?? current);
    }
    if (modelResult.status === "fulfilled") {
      setModels(modelResult.value.models);
      setDraftModelKey((current) => current && modelResult.value.models.some((model) => model.key === current) ? current : modelResult.value.selectedModel);
    }
    const failure = [projectResult, sessionResult, modelResult].find((result) => result.status === "rejected");
    if (failure?.status === "rejected") setError(formatBackendError(failure.reason));
  }

  async function restartBackend() {
    setError("");
    setStatus({ state: "starting" });
    try {
      setStatus(await invoke<BackendStatus>("backend_restart"));
    } catch (reason) {
      setError(formatBackendError(reason));
      setStatus(await invoke<BackendStatus>("backend_status"));
    }
  }

  function startDraft(projectId?: string) {
    selectedSessionRef.current = undefined;
    setSelectedSession(undefined);
    setDraftProjectId(projectId);
    setTranscript([]);
    setStreamingText("");
    setError("");
    void rememberProjectContext(projectId);
  }

  async function rememberProjectContext(projectId?: string) {
    try {
      await invoke("set_project_context", { projectId: projectId ?? null });
    } catch (reason) {
      setError(formatBackendError(reason));
    }
  }

  async function addProject() {
    const selected = await open({ directory: true, multiple: false, title: "选择项目文件夹" });
    if (!selected) return;
    try {
      const result = await invoke<{ project: Project }>("add_project", { path: selected });
      await refreshLists();
      startDraft(result.project.id);
    } catch (reason) {
      setError(formatBackendError(reason));
    }
  }

  async function removeProject(project: Project) {
    if (submitting || activeTurn) return;
    if (!window.confirm(`从 nyan 中移除项目“${project.name}”？项目文件不会被删除。`)) return;
    try {
      await invoke("remove_project", { projectId: project.id });
      if (draftProjectId === project.id) startDraft();
      await refreshLists();
    } catch (reason) {
      setError(formatBackendError(reason));
    }
  }

  async function loadSession(session: Session) {
    try {
      const result = await invoke<{ session: Session; transcript: TranscriptRecord[] }>("load_session", { sessionId: session.id });
      selectedSessionRef.current = session.id;
      setSelectedSession(result.session);
      setDraftProjectId(result.session.projectId);
      void rememberProjectContext(result.session.projectId);
      setTranscript(toTranscriptItems(result.transcript));
      setStreamingText("");
      setError("");
    } catch (reason) {
      setError(formatBackendError(reason));
    }
  }

  async function removeSession(session: Session) {
    if (submitting || activeTurn) return;
    if (!window.confirm(`删除任务“${session.title}”？该任务记录将被永久删除。`)) return;
    try {
      await invoke("remove_session", { sessionId: session.id });
      if (selectedSession?.id === session.id) startDraft(session.projectId);
      await refreshLists();
    } catch (reason) {
      setError(formatBackendError(reason));
    }
  }

  async function changeModel(key: string) {
    if (submitting || activeTurn || !key) return;
    setError("");
    if (!selectedSession) {
      setDraftModelKey(key);
      return;
    }
    try {
      const result = await invoke<{ session: Session }>("set_session_model", { sessionId: selectedSession.id, model: key });
      setSelectedSession(result.session);
      setSessions((current) => current.map((session) => session.id === result.session.id ? result.session : session));
      setDraftModelKey(key);
    } catch (reason) {
      setError(formatBackendError(reason));
    }
  }

  async function submitPrompt() {
    const text = prompt.trim();
    if (!text || submitting || activeTurn) return;
    setSubmitting(true);
    setError("");
    try {
      let session = selectedSession;
      if (!session) {
        const result = await invoke<Session>("create_session", { projectId: draftProjectId ?? null, model: draftModelKey ?? null });
        session = result;
        selectedSessionRef.current = session.id;
        setSelectedSession(session);
      }
      setTranscript((current) => [...current, { id: crypto.randomUUID(), role: "user", text }]);
      setPrompt("");
      setEditorKey((current) => current + 1);
      const response = await invoke<{ result: { sessionId: string; turnId: string } }>("submit_prompt", { sessionId: session.id, prompt: text });
      setActiveTurn(response.result);
      setSubmitting(false);
      await refreshLists();
    } catch (reason) {
      setError(formatBackendError(reason));
      setSubmitting(false);
    }
  }

  async function stopTurn() {
    if (!activeTurn) return;
    try {
      await invoke("cancel_turn", { sessionId: activeTurn.sessionId, turnId: activeTurn.turnId });
    } catch (reason) {
      setError(formatBackendError(reason));
    }
  }

  if (status.state === "unavailable" || status.state === "crashed" || status.state !== "ready") {
    return <BackendScreen status={status} error={error} restart={restartBackend} />;
  }

  const projectIds = new Set(projects.map((project) => project.id));
  const unboundSessions = sessions.filter((session) => !session.projectId || !projectIds.has(session.projectId));
  const title = selectedSession?.title ?? "新任务";
  const activeProject = projects.find((project) => project.id === (selectedSession?.projectId ?? draftProjectId));
  const activeModelKey = selectedSession?.model ?? draftModelKey;
  const displayModels = selectedSession && !models.some((model) => model.key === selectedSession.model)
    ? [{ key: selectedSession.model, providerId: "不可用", modelId: selectedSession.model, source: "static" as const, stale: false, unavailable: true }, ...models]
    : models;
  const isBusy = submitting || Boolean(activeTurn);
  const selectedIsActive = Boolean(selectedSession && activeTurn?.sessionId === selectedSession.id);
  const viewingOtherWhileRunning = Boolean(activeTurn && !selectedIsActive);

  return (
    <main className="product-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">N</span><strong>nyan-agent</strong></div>
        <Button fullWidth onPress={() => startDraft(draftProjectId)}><Plus size={17} />新建任务</Button>

        <SidebarHeading label="项目" onAdd={addProject} isDisabled={isBusy} />
        <div className="nav-list">
          {visibleItems(projects, visibleLimit(visibleLimits, "projects")).map((project) => (
            <div className="project-group" key={project.id}>
              <div className="nav-row">
                <button className="nav-item project-item" onClick={() => startDraft(project.id)} title={project.path}><Folder size={16} /><span>{project.name}</span></button>
                <button className="icon-action" onClick={() => startDraft(project.id)} aria-label={`在 ${project.name} 新建任务`}><Plus size={14} /></button>
                <button className="icon-action danger-action" disabled={isBusy} onClick={() => removeProject(project)} aria-label={`移除 ${project.name}`}><Trash2 size={14} /></button>
              </div>
              <SessionList sessions={sessions.filter((session) => session.projectId === project.id)} selectedId={selectedSession?.id} visibleLimit={visibleLimit(visibleLimits, `project:${project.id}`)} isReadOnly={isBusy} onToggle={(total) => toggleList(`project:${project.id}`, total)} onOpen={loadSession} onRemove={removeSession} />
            </div>
          ))}
          <ExpandButton total={projects.length} visibleLimit={visibleLimit(visibleLimits, "projects")} onPress={() => toggleProjectList(projects.length)} />
        </div>

        <SidebarHeading label="任务" onAdd={() => startDraft()} />
        <SessionList sessions={unboundSessions} selectedId={selectedSession?.id} visibleLimit={visibleLimit(visibleLimits, "tasks")} isReadOnly={isBusy} onToggle={(total) => toggleList("tasks", total)} onOpen={loadSession} onRemove={removeSession} />
        <div className="sidebar-runtime" title={status.bunPath}><span /> Bun {status.bunVersion}</div>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div><p>{activeProject?.name ?? "无项目任务"}</p><h1>{title}</h1></div>
          {selectedSession && <span className={`task-status status-${selectedSession.status}`}>{statusLabel(selectedSession.status)}</span>}
        </header>

        <div className="transcript" aria-live="polite">
          {transcript.length === 0 && !streamingText ? (
            <div className="welcome"><div className="welcome-icon"><MessageSquare size={24} /></div><h2>今天想做点什么？</h2><p>选择项目后发送任务，nyan 会在对应目录中工作。</p></div>
          ) : transcript.map((item) => (
            <article className={`message message-${item.role}`} key={item.id}>
              {item.role === "assistant" ? <Markdown remarkPlugins={[remarkGfm]}>{item.text}</Markdown> : item.role === "tool" || item.role === "subagent" ? <pre>{item.text}</pre> : <p>{item.text}</p>}
            </article>
          ))}
          {streamingText && <article className="message message-assistant streaming"><p>{streamingText}</p></article>}
        </div>

        <footer className="composer-wrap">
          <div className="composer">
            <PromptEditor key={editorKey} onChange={setPrompt} disabled={isBusy} />
            <div className="composer-toolbar">
              <div className="composer-field model-field">
                <span className="composer-field-label">模型</span>
                <Select className="model-select" aria-label="任务模型" placeholder="无可用模型" selectedKey={activeModelKey ?? null} disabledKeys={displayModels.filter((model) => model.unavailable).map((model) => model.key)} onSelectionChange={(key) => void changeModel(String(key))} isDisabled={isBusy || models.length === 0}>
                  <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                  <Select.Popover><ListBox>
                    {displayModels.map((model) => <ListBox.Item id={model.key} key={model.key} textValue={`${model.providerId} ${model.modelId}`}>
                      <span className="model-option"><strong>{model.modelId}</strong><small>{model.providerId}{model.stale ? " · 缓存已过期" : ""}</small></span>
                      <ListBox.ItemIndicator />
                    </ListBox.Item>)}
                  </ListBox></Select.Popover>
                </Select>
              </div>
              <div className="composer-field project-field">
                <span className="composer-field-label">项目</span>
                <Select className="project-select" aria-label="任务项目" selectedKey={draftProjectId ?? "none"} onSelectionChange={(key) => {
                  const projectId = key === "none" ? undefined : String(key);
                  setDraftProjectId(projectId);
                  void rememberProjectContext(projectId);
                }} isDisabled={Boolean(selectedSession) || isBusy}>
                  <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                  <Select.Popover><ListBox>
                    <ListBox.Item id="none" textValue="无项目">无项目<ListBox.ItemIndicator /></ListBox.Item>
                    {projects.map((project) => <ListBox.Item id={project.id} key={project.id} textValue={project.name}>{project.name}<ListBox.ItemIndicator /></ListBox.Item>)}
                  </ListBox></Select.Popover>
                </Select>
              </div>
              <div className="composer-spacer" />
              {selectedIsActive
                ? <Button isIconOnly variant="danger" onPress={stopTurn} isDisabled={!activeTurn} aria-label="停止"><Square size={16} fill="currentColor" /></Button>
                : <Button isIconOnly onPress={submitPrompt} isDisabled={isBusy || !prompt.trim()} aria-label="发送"><Send size={17} /></Button>}
            </div>
          </div>
          {viewingOtherWhileRunning && <p className="composer-state">另一任务正在运行；当前任务仅供查看。</p>}
          {error && <p className="error-text">{error}</p>}
        </footer>
      </section>
    </main>
  );

  function toggleList(key: string, total: number) {
    setVisibleLimits((current) => ({
      ...current,
      [key]: nextVisibleLimit(visibleLimit(current, key), total),
    }));
  }

  function toggleProjectList(total: number) {
    setVisibleLimits((current) => {
      const currentLimit = visibleLimit(current, "projects");
      const nextLimit = nextVisibleLimit(currentLimit, total);
      if (nextLimit !== INITIAL_VISIBLE_ITEMS) return { ...current, projects: nextLimit };

      return resetVisibleLimits(current, "projects", "project:");
    });
  }
}

function BackendScreen({ status, error, restart }: { status: BackendStatus; error: string; restart: () => void }) {
  const unavailable = status.state === "unavailable";
  const crashed = status.state === "crashed";
  const protocolError = status.state === "protocol_error";
  return <main className="centered-shell"><section className={`status-card ${unavailable || crashed || protocolError ? "error-card" : ""}`}>
    <p className="eyebrow">{unavailable ? "后端不可用" : crashed ? "后端已停止" : protocolError ? "协议故障" : "正在启动"}</p>
    <h1>{unavailable ? "未找到 Bun" : crashed ? "Agent 后端意外退出" : protocolError ? "Agent 通信协议错误" : "正在连接 Agent…"}</h1>
    {unavailable && <p>nyan-agent 使用全局安装的 Bun 运行后端。安装后可重新检测。</p>}
    {crashed && <p>{status.message}</p>}
    {protocolError && <p>{status.error.message}</p>}
    {(unavailable || crashed) && <pre>{unavailable ? status.reason : `退出代码：${status.exitCode ?? "未知"}`}</pre>}
    {protocolError && <pre>错误代码：{status.error.code}</pre>}
    {error && <p className="error-text">{error}</p>}
    {(unavailable || crashed || protocolError) && <Button onPress={restart}>重新检测</Button>}
  </section></main>;
}

function SidebarHeading({ label, onAdd, isDisabled = false }: { label: string; onAdd: () => void; isDisabled?: boolean }) {
  return <div className="sidebar-heading"><span>{label}</span><button className="icon-action" disabled={isDisabled} onClick={onAdd} aria-label={`添加${label}`}><FolderPlus size={15} /></button></div>;
}

function SessionList({ sessions, selectedId, visibleLimit: limit, isReadOnly, onToggle, onOpen, onRemove }: { sessions: Session[]; selectedId?: string; visibleLimit: number; isReadOnly: boolean; onToggle: (total: number) => void; onOpen: (session: Session) => void; onRemove: (session: Session) => void }) {
  return <div className="session-list">
    {visibleItems(sessions, limit).map((session) => <div className={`nav-row nested ${selectedId === session.id ? "selected" : ""}`} key={session.id}>
      <button className="nav-item" onClick={() => onOpen(session)}><MessageSquare size={14} /><span>{session.title}</span></button>
      <button className="icon-action danger-action" disabled={isReadOnly} onClick={() => onRemove(session)} aria-label={`删除 ${session.title}`}><Trash2 size={13} /></button>
    </div>)}
    <ExpandButton total={sessions.length} visibleLimit={limit} onPress={() => onToggle(sessions.length)} />
  </div>;
}

function ExpandButton({ total, visibleLimit: limit, onPress }: { total: number; visibleLimit: number; onPress: () => void }) {
  if (total <= INITIAL_VISIBLE_ITEMS) return null;
  return <button className="expand-button" onClick={onPress}>{limit >= total ? "折叠显示" : `展开显示（${total}）`}</button>;
}

function statusLabel(status: string): string {
  return ({ idle: "未开始", running: "运行中", completed: "已完成", failed: "失败", cancelled: "已停止", interrupted: "已中断" } as Record<string, string>)[status] ?? status;
}

export default App;
