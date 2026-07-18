import { useEffect, useRef, useState } from "react";
import { Button, ListBox, Select } from "@heroui/react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { ServerMessage } from "@nyan/protocol";
import { Folder, FolderPlus, MessageSquare, Plus, Send, Square, Trash2 } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PromptEditor } from "./PromptEditor";
import "./App.css";

type BackendStatus =
  | { state: "starting" }
  | { state: "ready"; bunPath: string; bunVersion: string }
  | { state: "unavailable"; reason: string }
  | { state: "crashed"; exitCode: number | null; message: string }
  | { state: "stopped" };

type Project = { id: string; name: string; path: string; createdAt: string; updatedAt: string };
type Session = { id: string; projectId?: string; cwd: string; title: string; model: string; status: string; createdAt: string; updatedAt: string };
type TranscriptRecord = { seq: number; createdAt: string; turnId?: string; kind: string; payload: unknown };
type TranscriptItem = { id: string; role: "user" | "assistant" | "status"; text: string };

const FIRST_PAGE_SIZE = 5;

function App() {
  const [status, setStatus] = useState<BackendStatus>({ state: "starting" });
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session>();
  const selectedSessionRef = useRef<string | undefined>(undefined);
  const [draftProjectId, setDraftProjectId] = useState<string>();
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [prompt, setPrompt] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeTurn, setActiveTurn] = useState<{ sessionId: string; turnId: string }>();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const channel = new Channel<ServerMessage>();
    channel.onmessage = (message) => {
      if (message.type === "backend.crashed") {
        setStatus({ state: "crashed", exitCode: message.exitCode, message: message.message });
        return;
      }
      if (!("sessionId" in message)) return;
      if (message.type === "assistant.text.delta" && message.sessionId === selectedSessionRef.current) {
        setStreamingText((current) => current + message.text);
      }
      if (message.type === "assistant.block.completed" && message.sessionId === selectedSessionRef.current) {
        setStreamingText("");
        setTranscript((current) => [...current, { id: `${message.turnId}-${message.seq}`, role: "assistant", text: message.text }]);
      }
      if (message.type === "turn.completed" || message.type === "turn.cancelled" || message.type === "turn.failed") {
        setSubmitting(false);
        setActiveTurn(undefined);
        void refreshLists();
      }
      if (message.type === "turn.failed") setError(message.error.message);
    };

    Promise.all([
      invoke<void>("backend_subscribe", { onEvent: channel }),
      invoke<BackendStatus>("backend_status").then(setStatus),
    ]).catch((reason: unknown) => setError(String(reason)));
  }, []);

  useEffect(() => {
    if (status.state === "ready") void refreshLists();
  }, [status.state]);

  async function refreshLists() {
    try {
      const [projectResult, sessionResult] = await Promise.all([
        invoke<{ projects: Project[] }>("list_projects"),
        invoke<{ sessions: Session[] }>("list_sessions"),
      ]);
      setProjects(projectResult.projects);
      setSessions(sessionResult.sessions);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function restartBackend() {
    setError("");
    setStatus({ state: "starting" });
    try {
      setStatus(await invoke<BackendStatus>("backend_restart"));
    } catch (reason) {
      setError(String(reason));
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
  }

  async function addProject() {
    const selected = await open({ directory: true, multiple: false, title: "选择项目文件夹" });
    if (!selected) return;
    try {
      const result = await invoke<{ project: Project }>("add_project", { path: selected });
      await refreshLists();
      startDraft(result.project.id);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function removeProject(project: Project) {
    if (!window.confirm(`从 nyan 中移除项目“${project.name}”？项目文件不会被删除。`)) return;
    try {
      await invoke("remove_project", { projectId: project.id });
      if (draftProjectId === project.id) startDraft();
      await refreshLists();
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function loadSession(session: Session) {
    try {
      const result = await invoke<{ session: Session; transcript: TranscriptRecord[] }>("load_session", { sessionId: session.id });
      selectedSessionRef.current = session.id;
      setSelectedSession(result.session);
      setDraftProjectId(result.session.projectId);
      setTranscript(toTranscriptItems(result.transcript));
      setStreamingText("");
      setError("");
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function removeSession(session: Session) {
    if (!window.confirm(`删除任务“${session.title}”？该任务记录将被永久删除。`)) return;
    try {
      await invoke("remove_session", { sessionId: session.id });
      if (selectedSession?.id === session.id) startDraft(session.projectId);
      await refreshLists();
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function submitPrompt() {
    const text = prompt.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      let session = selectedSession;
      if (!session) {
        const result = await invoke<Session>("create_session", { projectId: draftProjectId ?? null });
        session = result;
        selectedSessionRef.current = session.id;
        setSelectedSession(session);
      }
      setTranscript((current) => [...current, { id: crypto.randomUUID(), role: "user", text }]);
      setPrompt("");
      setEditorKey((current) => current + 1);
      const response = await invoke<{ result: { sessionId: string; turnId: string } }>("submit_prompt", { sessionId: session.id, prompt: text });
      setActiveTurn(response.result);
      await refreshLists();
    } catch (reason) {
      setError(String(reason));
      setSubmitting(false);
    }
  }

  async function stopTurn() {
    if (!activeTurn) return;
    try {
      await invoke("cancel_turn", { sessionId: activeTurn.sessionId, turnId: activeTurn.turnId });
    } catch (reason) {
      setError(String(reason));
    }
  }

  if (status.state === "unavailable" || status.state === "crashed" || status.state !== "ready") {
    return <BackendScreen status={status} error={error} restart={restartBackend} />;
  }

  const projectIds = new Set(projects.map((project) => project.id));
  const unboundSessions = sessions.filter((session) => !session.projectId || !projectIds.has(session.projectId));
  const title = selectedSession?.title ?? "新任务";
  const activeProject = projects.find((project) => project.id === (selectedSession?.projectId ?? draftProjectId));

  return (
    <main className="product-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">N</span><strong>nyan-agent</strong></div>
        <Button fullWidth onPress={() => startDraft(draftProjectId)}><Plus size={17} />新建任务</Button>

        <SidebarHeading label="项目" onAdd={addProject} />
        <div className="nav-list">
          {limited(projects, expanded.projects).map((project) => (
            <div className="project-group" key={project.id}>
              <div className="nav-row">
                <button className="nav-item project-item" onClick={() => startDraft(project.id)} title={project.path}><Folder size={16} /><span>{project.name}</span></button>
                <button className="icon-action" onClick={() => startDraft(project.id)} aria-label={`在 ${project.name} 新建任务`}><Plus size={14} /></button>
                <button className="icon-action danger-action" onClick={() => removeProject(project)} aria-label={`移除 ${project.name}`}><Trash2 size={14} /></button>
              </div>
              <SessionList sessions={sessions.filter((session) => session.projectId === project.id)} selectedId={selectedSession?.id} expanded={expanded[`project:${project.id}`]} onToggle={() => toggleExpanded(`project:${project.id}`)} onOpen={loadSession} onRemove={removeSession} />
            </div>
          ))}
          <ExpandButton total={projects.length} isExpanded={expanded.projects} onPress={() => toggleExpanded("projects")} />
        </div>

        <SidebarHeading label="任务" onAdd={() => startDraft()} />
        <SessionList sessions={unboundSessions} selectedId={selectedSession?.id} expanded={expanded.tasks} onToggle={() => toggleExpanded("tasks")} onOpen={loadSession} onRemove={removeSession} />
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
              {item.role === "assistant" ? <Markdown remarkPlugins={[remarkGfm]}>{item.text}</Markdown> : <p>{item.text}</p>}
            </article>
          ))}
          {streamingText && <article className="message message-assistant streaming"><p>{streamingText}</p></article>}
        </div>

        <footer className="composer-wrap">
          <div className="composer">
            <PromptEditor key={editorKey} onChange={setPrompt} disabled={submitting} />
            <div className="composer-toolbar">
              <div className="project-field">
                <span className="composer-field-label">项目</span>
                <Select className="project-select" aria-label="任务项目" selectedKey={draftProjectId ?? "none"} onSelectionChange={(key) => setDraftProjectId(key === "none" ? undefined : String(key))} isDisabled={Boolean(selectedSession)}>
                  <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                  <Select.Popover><ListBox>
                    <ListBox.Item id="none" textValue="无项目">无项目<ListBox.ItemIndicator /></ListBox.Item>
                    {projects.map((project) => <ListBox.Item id={project.id} key={project.id} textValue={project.name}>{project.name}<ListBox.ItemIndicator /></ListBox.Item>)}
                  </ListBox></Select.Popover>
                </Select>
              </div>
              <div className="composer-model">{selectedSession?.model ?? "自动选择模型"}</div>
              {submitting
                ? <Button isIconOnly variant="danger" onPress={stopTurn} isDisabled={!activeTurn} aria-label="停止"><Square size={16} fill="currentColor" /></Button>
                : <Button isIconOnly onPress={submitPrompt} isDisabled={!prompt.trim()} aria-label="发送"><Send size={17} /></Button>}
            </div>
          </div>
          {error && <p className="error-text">{error}</p>}
        </footer>
      </section>
    </main>
  );

  function toggleExpanded(key: string) {
    setExpanded((current) => ({ ...current, [key]: !current[key] }));
  }
}

function BackendScreen({ status, error, restart }: { status: BackendStatus; error: string; restart: () => void }) {
  const unavailable = status.state === "unavailable";
  const crashed = status.state === "crashed";
  return <main className="centered-shell"><section className={`status-card ${unavailable || crashed ? "error-card" : ""}`}>
    <p className="eyebrow">{unavailable ? "后端不可用" : crashed ? "后端已停止" : "正在启动"}</p>
    <h1>{unavailable ? "未找到 Bun" : crashed ? "Agent 后端意外退出" : "正在连接 Agent…"}</h1>
    {unavailable && <p>nyan-agent 使用全局安装的 Bun 运行后端。安装后可重新检测。</p>}
    {crashed && <p>{status.message}</p>}
    {(unavailable || crashed) && <pre>{unavailable ? status.reason : `退出代码：${status.exitCode ?? "未知"}`}</pre>}
    {error && <p className="error-text">{error}</p>}
    {(unavailable || crashed) && <Button onPress={restart}>重新检测</Button>}
  </section></main>;
}

function SidebarHeading({ label, onAdd }: { label: string; onAdd: () => void }) {
  return <div className="sidebar-heading"><span>{label}</span><button className="icon-action" onClick={onAdd} aria-label={`添加${label}`}><FolderPlus size={15} /></button></div>;
}

function SessionList({ sessions, selectedId, expanded, onToggle, onOpen, onRemove }: { sessions: Session[]; selectedId?: string; expanded?: boolean; onToggle: () => void; onOpen: (session: Session) => void; onRemove: (session: Session) => void }) {
  return <div className="session-list">
    {limited(sessions, expanded).map((session) => <div className={`nav-row nested ${selectedId === session.id ? "selected" : ""}`} key={session.id}>
      <button className="nav-item" onClick={() => onOpen(session)}><MessageSquare size={14} /><span>{session.title}</span></button>
      <button className="icon-action danger-action" onClick={() => onRemove(session)} aria-label={`删除 ${session.title}`}><Trash2 size={13} /></button>
    </div>)}
    <ExpandButton total={sessions.length} isExpanded={expanded} onPress={onToggle} />
  </div>;
}

function ExpandButton({ total, isExpanded, onPress }: { total: number; isExpanded?: boolean; onPress: () => void }) {
  if (total <= FIRST_PAGE_SIZE) return null;
  return <button className="expand-button" onClick={onPress}>{isExpanded ? "折叠显示" : `展开显示（${total}）`}</button>;
}

function limited<T>(items: T[], expanded?: boolean): T[] { return expanded ? items : items.slice(0, FIRST_PAGE_SIZE); }

function toTranscriptItems(records: TranscriptRecord[]): TranscriptItem[] {
  return records.flatMap((record): TranscriptItem[] => {
    const payload = record.payload as { itemId?: string; text?: string; reason?: string } | undefined;
    if (record.kind === "user.message" && payload?.text) return [{ id: payload.itemId ?? `record-${record.seq}`, role: "user" as const, text: payload.text }];
    if (record.kind === "assistant.block" && payload?.text) return [{ id: payload.itemId ?? `record-${record.seq}`, role: "assistant" as const, text: payload.text }];
    if (record.kind === "turn.interrupted") return [{ id: `record-${record.seq}`, role: "status" as const, text: "上次运行因后端重启而中断。" }];
    return [];
  });
}

function statusLabel(status: string): string {
  return ({ idle: "未开始", running: "运行中", completed: "已完成", failed: "失败", cancelled: "已停止", interrupted: "已中断" } as Record<string, string>)[status] ?? status;
}

export default App;
