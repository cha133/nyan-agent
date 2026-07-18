import { useEffect, useMemo, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import type { ServerMessage } from "@nyan/protocol";
import "./App.css";

type BackendStatus =
  | { state: "starting" }
  | { state: "ready"; bunPath: string; bunVersion: string }
  | { state: "unavailable"; reason: string }
  | { state: "crashed"; exitCode: number | null; message: string }
  | { state: "stopped" };

function App() {
  const [status, setStatus] = useState<BackendStatus>({ state: "starting" });
  const [events, setEvents] = useState<ServerMessage[]>([]);
  const [prompt, setPrompt] = useState("你好，nyan");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const channel = new Channel<ServerMessage>();
    channel.onmessage = (message) => {
      setEvents((current) => [...current.slice(-19), message]);
      if (message.type === "backend.crashed") {
        setStatus({ state: "crashed", exitCode: message.exitCode, message: message.message });
      }
    };

    Promise.all([
      invoke<void>("backend_subscribe", { onEvent: channel }),
      invoke<BackendStatus>("backend_status").then(setStatus),
    ]).catch((reason: unknown) => setError(String(reason)));
  }, []);

  const turnEvents = useMemo(
    () => events.filter((event) => "turnId" in event),
    [events],
  );

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

  async function submitEcho() {
    const text = prompt.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await invoke("echo_prompt", { prompt: text });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSubmitting(false);
    }
  }

  if (status.state === "unavailable") {
    return (
      <main className="centered-shell">
        <section className="status-card error-card">
          <p className="eyebrow">Backend unavailable</p>
          <h1>Bun was not found</h1>
          <p>nyan-agent uses your globally installed Bun runtime to run the agent backend.</p>
          <pre>{status.reason}</pre>
          {error && <p className="error-text">{error}</p>}
          <div className="actions">
            <button onClick={restartBackend}>Check again</button>
            <a href="https://bun.sh/docs/installation" target="_blank" rel="noreferrer">Installation guide</a>
          </div>
          <p className="hint">After installing Bun, restart the app or choose “Check again”.</p>
        </section>
      </main>
    );
  }

  if (status.state === "crashed") {
    return (
      <main className="centered-shell">
        <section className="status-card error-card">
          <p className="eyebrow">Backend stopped</p>
          <h1>The agent backend exited</h1>
          <p>{status.message}</p>
          <pre>Exit code: {status.exitCode ?? "unavailable"}</pre>
          {error && <p className="error-text">{error}</p>}
          <button onClick={restartBackend}>Restart backend</button>
        </section>
      </main>
    );
  }

  if (status.state !== "ready") {
    return (
      <main className="centered-shell">
        <section className="status-card">
          <p className="eyebrow">Starting</p>
          <h1>Connecting to the Bun backend…</h1>
          {error && <p className="error-text">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header>
        <div>
          <p className="eyebrow">Protocol vertical slice</p>
          <h1>nyan-agent</h1>
        </div>
        <div className="runtime-badge">
          <span className="status-dot" /> Bun {status.bunVersion}
        </div>
      </header>

      <section className="echo-panel">
        <label htmlFor="echo-prompt">Echo prompt</label>
        <div className="prompt-row">
          <textarea id="echo-prompt" value={prompt} onChange={(event) => setPrompt(event.currentTarget.value)} />
          <button onClick={submitEcho} disabled={submitting || !prompt.trim()}>
            {submitting ? "Sending…" : "Send"}
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
        <p className="hint" title={status.bunPath}>Runtime: {status.bunPath}</p>
      </section>

      <section className="events-panel">
        <div className="section-heading">
          <h2>Ordered Channel events</h2>
          <span>{turnEvents.length} turn events</span>
        </div>
        {events.length === 0 ? (
          <p className="empty-state">Send an echo prompt to verify the Rust ↔ Bun ↔ React path.</p>
        ) : (
          <ol>
            {events.map((event, index) => (
              <li key={`${event.type}-${index}`}>
                <strong>{event.type}</strong>
                {"seq" in event && <span>seq {event.seq}</span>}
                <code>{JSON.stringify(event)}</code>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

export default App;
