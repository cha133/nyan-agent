use crate::{
    ndjson::{encode, NdjsonDecoder},
    platform::{configure_no_window, detect_bun},
    protocol::{RequestId, ServerEnvelope, PROTOCOL_VERSION},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};
use tauri::ipc::Channel;
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{ChildStdin, Command},
    sync::{mpsc, oneshot, Mutex, Notify, RwLock},
    time::{timeout, Duration},
};

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum BackendStatus {
    Starting,
    Ready {
        #[serde(rename = "bunPath")]
        bun_path: String,
        #[serde(rename = "bunVersion")]
        bun_version: String,
    },
    Unavailable {
        reason: String,
    },
    Crashed {
        #[serde(rename = "exitCode")]
        exit_code: Option<i32>,
        message: String,
    },
    ProtocolError {
        error: ProtocolFailure,
    },
    Stopped,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ProtocolFailure {
    code: String,
    message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendCommandError {
    code: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<Value>,
}

impl From<String> for BackendCommandError {
    fn from(message: String) -> Self {
        Self {
            code: "backend_transport_error".to_owned(),
            message,
            details: None,
        }
    }
}

enum ProcessControl {
    Kill,
}

struct BackendInner {
    status: RwLock<BackendStatus>,
    writer: Mutex<Option<ChildStdin>>,
    pending: Mutex<HashMap<RequestId, oneshot::Sender<Value>>>,
    subscribers: Mutex<Vec<Channel<Value>>>,
    control: Mutex<Option<mpsc::Sender<ProcessControl>>>,
    lifecycle: Mutex<()>,
    generation: AtomicU64,
    exit_notify: Notify,
}

#[derive(Clone)]
pub struct BackendManager {
    inner: Arc<BackendInner>,
    agent_entry: PathBuf,
}

impl BackendManager {
    pub fn new(agent_entry: PathBuf) -> Self {
        Self {
            inner: Arc::new(BackendInner {
                status: RwLock::new(BackendStatus::Stopped),
                writer: Mutex::new(None),
                pending: Mutex::new(HashMap::new()),
                subscribers: Mutex::new(Vec::new()),
                control: Mutex::new(None),
                lifecycle: Mutex::new(()),
                generation: AtomicU64::new(0),
                exit_notify: Notify::new(),
            }),
            agent_entry,
        }
    }

    pub async fn status(&self) -> BackendStatus {
        self.inner.status.read().await.clone()
    }

    pub async fn subscribe(&self, channel: Channel<Value>) {
        self.inner.subscribers.lock().await.push(channel);
    }

    pub async fn start(&self) -> Result<(), String> {
        let _lifecycle = self.inner.lifecycle.lock().await;
        if matches!(
            self.status().await,
            BackendStatus::Ready { .. } | BackendStatus::Starting
        ) {
            return Ok(());
        }
        self.set_status(BackendStatus::Starting).await;

        let runtime = match detect_bun() {
            Ok(runtime) => runtime,
            Err(reason) => {
                self.set_status(BackendStatus::Unavailable {
                    reason: reason.clone(),
                })
                .await;
                return Err(reason);
            }
        };
        let agent_entry = match self.agent_entry.canonicalize() {
            Ok(path) => path,
            Err(error) => {
                let reason = format!(
                    "Agent entry was not found at {}: {error}",
                    self.agent_entry.display()
                );
                self.set_status(BackendStatus::Unavailable {
                    reason: reason.clone(),
                })
                .await;
                return Err(reason);
            }
        };

        let mut command = Command::new(&runtime.executable);
        command
            .arg(agent_entry)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_no_window(&mut command);
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let reason = format!("Failed to start Bun backend: {error}");
                self.set_status(BackendStatus::Unavailable {
                    reason: reason.clone(),
                })
                .await;
                return Err(reason);
            }
        };
        let generation = self.inner.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Bun stdin pipe was unavailable".to_owned())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Bun stdout pipe was unavailable".to_owned())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Bun stderr pipe was unavailable".to_owned())?;

        *self.inner.writer.lock().await = Some(stdin);
        let (control_tx, mut control_rx) = mpsc::channel(1);
        *self.inner.control.lock().await = Some(control_tx);

        let stdout_manager = self.clone();
        tauri::async_runtime::spawn(async move {
            stdout_manager.read_stdout(stdout, generation).await;
        });
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[nyan-agent backend] {line}");
            }
        });
        let exit_manager = self.clone();
        tauri::async_runtime::spawn(async move {
            let exit = tokio::select! {
                result = child.wait() => result,
                control = control_rx.recv() => {
                    if matches!(control, Some(ProcessControl::Kill)) {
                        let _ = child.kill().await;
                    }
                    child.wait().await
                }
            };
            exit_manager
                .handle_exit(generation, exit.ok().and_then(|status| status.code()))
                .await;
        });

        let request_id = RequestId::new();
        let initialized = self
            .request(
                json!({
                    "v": PROTOCOL_VERSION,
                    "type": "initialize",
                    "requestId": request_id,
                    "client": { "name": "nyan-desktop", "version": env!("CARGO_PKG_VERSION") }
                }),
                request_id,
            )
            .await;

        match initialized {
            Ok(message) if message["type"] == "initialized" => {
                let mut status = self.inner.status.write().await;
                if matches!(*status, BackendStatus::Starting) {
                    *status = BackendStatus::Ready {
                        bun_path: runtime.executable.display().to_string(),
                        bun_version: runtime.version,
                    };
                    Ok(())
                } else {
                    Err("Bun backend failed during initialization.".to_owned())
                }
            }
            Ok(_) => {
                let reason = "Bun backend returned an invalid initialize response.".to_owned();
                self.fail_protocol(generation, reason.clone()).await;
                Err(reason)
            }
            Err(reason) => {
                self.fail_protocol(generation, reason.clone()).await;
                Err(reason)
            }
        }
    }

    pub async fn restart(&self) -> Result<(), String> {
        self.shutdown().await;
        self.start().await
    }

    pub async fn list_projects(&self) -> Result<Value, BackendCommandError> {
        self.command("project.list", json!({})).await
    }

    pub async fn add_project(&self, path: String) -> Result<Value, BackendCommandError> {
        self.command("project.add", json!({ "path": path })).await
    }

    pub async fn remove_project(&self, project_id: String) -> Result<Value, BackendCommandError> {
        self.command("project.remove", json!({ "projectId": project_id }))
            .await
    }

    pub async fn set_project_context(
        &self,
        project_id: Option<String>,
    ) -> Result<Value, BackendCommandError> {
        self.command("project.context.set", json!({ "projectId": project_id }))
            .await
    }

    pub async fn list_sessions(&self) -> Result<Value, BackendCommandError> {
        self.command("session.list", json!({})).await
    }

    pub async fn list_models(&self, refresh: bool) -> Result<Value, BackendCommandError> {
        self.command("model.list", json!({ "refresh": refresh }))
            .await
    }

    pub async fn create_session(
        &self,
        project_id: Option<String>,
        model: Option<String>,
    ) -> Result<Value, BackendCommandError> {
        let mut payload = json!({});
        if let Some(project_id) = project_id {
            payload["projectId"] = json!(project_id);
        }
        if let Some(model) = model {
            payload["model"] = json!(model);
        }
        self.command("session.create", payload).await
    }

    pub async fn load_session(&self, session_id: String) -> Result<Value, BackendCommandError> {
        self.command("session.load", json!({ "sessionId": session_id }))
            .await
    }

    pub async fn set_session_model(
        &self,
        session_id: String,
        model: String,
    ) -> Result<Value, BackendCommandError> {
        self.command(
            "session.model.set",
            json!({ "sessionId": session_id, "model": model }),
        )
        .await
    }

    pub async fn remove_session(&self, session_id: String) -> Result<Value, BackendCommandError> {
        self.command("session.remove", json!({ "sessionId": session_id }))
            .await
    }

    pub async fn submit_prompt(
        &self,
        session_id: String,
        prompt: String,
    ) -> Result<Value, BackendCommandError> {
        if !matches!(self.status().await, BackendStatus::Ready { .. }) {
            return Err("Bun backend is not ready.".to_owned().into());
        }
        let prompt_request_id = RequestId::new();
        let response = self
            .request(
                json!({
                    "v": PROTOCOL_VERSION,
                    "type": "prompt.submit",
                    "requestId": prompt_request_id,
                    "sessionId": session_id,
                    "prompt": prompt
                }),
                prompt_request_id,
            )
            .await?;
        ensure_ok(&response)?;
        Ok(response)
    }

    async fn command(
        &self,
        message_type: &str,
        payload: Value,
    ) -> Result<Value, BackendCommandError> {
        if !matches!(self.status().await, BackendStatus::Ready { .. }) {
            return Err("Bun backend is not ready.".to_owned().into());
        }
        let request_id = RequestId::new();
        let mut message = payload.as_object().cloned().unwrap_or_default();
        message.insert("v".to_owned(), json!(PROTOCOL_VERSION));
        message.insert("type".to_owned(), json!(message_type));
        message.insert("requestId".to_owned(), json!(request_id));
        let response = self.request(Value::Object(message), request_id).await?;
        ensure_ok(&response)?;
        Ok(response["result"].clone())
    }

    pub async fn cancel_turn(
        &self,
        session_id: String,
        turn_id: String,
    ) -> Result<Value, BackendCommandError> {
        let request_id = RequestId::new();
        let response = self
            .request(
                json!({
                    "v": PROTOCOL_VERSION,
                    "type": "turn.cancel",
                    "requestId": request_id,
                    "sessionId": session_id,
                    "turnId": turn_id
                }),
                request_id,
            )
            .await?;
        ensure_ok(&response)?;
        Ok(response)
    }

    pub async fn shutdown(&self) {
        if self.inner.writer.lock().await.is_none() {
            self.set_status(BackendStatus::Stopped).await;
            return;
        }
        self.set_status(BackendStatus::Stopped).await;
        let request_id = RequestId::new();
        let shutdown = self.request(
            json!({ "v": PROTOCOL_VERSION, "type": "shutdown", "requestId": request_id }),
            request_id,
        );
        let exited = self.inner.exit_notify.notified();
        let _ = timeout(Duration::from_millis(750), shutdown).await;
        if timeout(Duration::from_millis(750), exited).await.is_err()
            && self.inner.writer.lock().await.is_some()
        {
            if let Some(control) = self.inner.control.lock().await.as_ref() {
                let _ = control.send(ProcessControl::Kill).await;
            }
            let _ = timeout(Duration::from_secs(1), self.inner.exit_notify.notified()).await;
        }
    }

    async fn request(&self, message: Value, request_id: RequestId) -> Result<Value, String> {
        let (sender, receiver) = oneshot::channel();
        self.inner.pending.lock().await.insert(request_id, sender);
        let bytes = encode(&message).map_err(|error| error.to_string())?;
        let write_result = async {
            let mut writer = self.inner.writer.lock().await;
            let writer = writer
                .as_mut()
                .ok_or_else(|| "Bun backend stdin is unavailable.".to_owned())?;
            writer
                .write_all(&bytes)
                .await
                .map_err(|error| error.to_string())?;
            writer.flush().await.map_err(|error| error.to_string())
        }
        .await;
        if let Err(error) = write_result {
            self.inner.pending.lock().await.remove(&request_id);
            return Err(error);
        }

        match timeout(Duration::from_secs(5), receiver).await {
            Ok(Ok(response)) => Ok(response),
            Ok(Err(_)) => Err("Bun backend response channel closed.".to_owned()),
            Err(_) => {
                self.inner.pending.lock().await.remove(&request_id);
                Err("Timed out waiting for Bun backend response.".to_owned())
            }
        }
    }

    async fn read_stdout(&self, mut stdout: tokio::process::ChildStdout, generation: u64) {
        let mut decoder = NdjsonDecoder::default();
        let mut chunk = [0_u8; 8192];
        loop {
            match stdout.read(&mut chunk).await {
                Ok(0) => {
                    if let Err(error) = decoder.finish() {
                        self.fail_protocol(generation, error.to_string()).await;
                    }
                    break;
                }
                Ok(size) => match decoder.push(&chunk[..size]) {
                    Ok(messages) => {
                        for message in messages {
                            if let Err(error) = self.dispatch(message).await {
                                self.fail_protocol(generation, error).await;
                                return;
                            }
                        }
                    }
                    Err(error) => {
                        self.fail_protocol(generation, error.to_string()).await;
                        return;
                    }
                },
                Err(error) => {
                    self.fail_protocol(generation, format!("Failed reading Bun stdout: {error}"))
                        .await;
                    return;
                }
            }
        }
    }

    async fn dispatch(&self, message: Value) -> Result<(), String> {
        let envelope: ServerEnvelope = serde_json::from_value(message.clone())
            .map_err(|error| format!("Invalid backend envelope: {error}"))?;
        if envelope.v != PROTOCOL_VERSION || !envelope.is_known_type() {
            return Err(format!(
                "Unsupported backend message type: {}",
                envelope.message_type
            ));
        }
        if envelope.message_type == "backend.error" {
            let error = serde_json::from_value::<ProtocolFailure>(message["error"].clone())
                .map_err(|error| format!("Invalid backend.error payload: {error}"))?;
            self.record_protocol_failure(error).await;
        }
        self.publish(message.clone()).await;
        if let Some(request_id) = envelope.request_id {
            if let Some(sender) = self.inner.pending.lock().await.remove(&request_id) {
                let _ = sender.send(message);
            }
        }
        Ok(())
    }

    async fn publish(&self, message: Value) {
        self.inner
            .subscribers
            .lock()
            .await
            .retain(|subscriber| subscriber.send(message.clone()).is_ok());
    }

    async fn fail_protocol(&self, generation: u64, reason: String) {
        if self.inner.generation.load(Ordering::SeqCst) != generation {
            return;
        }
        let error = ProtocolFailure {
            code: "protocol_error".to_owned(),
            message: reason,
        };
        self.record_protocol_failure(error.clone()).await;
        self.publish(json!({
            "v": PROTOCOL_VERSION,
            "type": "backend.error",
            "error": error
        }))
        .await;
    }

    async fn record_protocol_failure(&self, error: ProtocolFailure) {
        self.set_status(BackendStatus::ProtocolError { error })
            .await;
        if let Some(control) = self.inner.control.lock().await.as_ref() {
            let _ = control.send(ProcessControl::Kill).await;
        }
    }

    async fn handle_exit(&self, generation: u64, exit_code: Option<i32>) {
        if self.inner.generation.load(Ordering::SeqCst) != generation {
            return;
        }
        *self.inner.writer.lock().await = None;
        *self.inner.control.lock().await = None;
        self.inner.pending.lock().await.clear();
        let previous = self.status().await;
        if matches!(previous, BackendStatus::ProtocolError { .. }) {
            // The supervisor intentionally killed a corrupt protocol stream.
            // Preserve that structured cause instead of reporting a crash.
        } else if matches!(
            previous,
            BackendStatus::Ready { .. } | BackendStatus::Starting
        ) {
            let message = "Bun backend exited unexpectedly.".to_owned();
            self.set_status(BackendStatus::Crashed {
                exit_code,
                message: message.clone(),
            })
            .await;
            self.publish(json!({
                "v": PROTOCOL_VERSION,
                "type": "backend.crashed",
                "exitCode": exit_code,
                "message": message
            }))
            .await;
        } else {
            self.set_status(BackendStatus::Stopped).await;
        }
        self.inner.exit_notify.notify_waiters();
    }

    async fn set_status(&self, status: BackendStatus) {
        *self.inner.status.write().await = status;
    }
}

pub fn development_agent_entry() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .join("apps/agent/src/main.ts")
}

pub fn packaged_agent_entry(resource_dir: &Path) -> PathBuf {
    resource_dir.join("agent").join("main.js")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use uuid::Uuid;

    #[tokio::test]
    async fn bun_backend_initializes_and_stops_cleanly() {
        let manager = BackendManager::new(development_agent_entry());
        manager.start().await.unwrap();
        assert!(matches!(
            manager.status().await,
            BackendStatus::Ready { .. }
        ));

        manager.shutdown().await;
        assert!(matches!(manager.status().await, BackendStatus::Stopped));
    }

    #[tokio::test]
    async fn unexpected_backend_exit_becomes_crashed() {
        let manager = BackendManager::new(development_agent_entry());
        manager.start().await.unwrap();
        manager
            .inner
            .control
            .lock()
            .await
            .as_ref()
            .unwrap()
            .send(ProcessControl::Kill)
            .await
            .unwrap();

        timeout(Duration::from_secs(2), async {
            loop {
                if matches!(manager.status().await, BackendStatus::Crashed { .. }) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert!(manager.inner.writer.lock().await.is_none());
    }

    #[tokio::test]
    async fn invalid_backend_ndjson_remains_a_structured_protocol_error() {
        let script =
            std::env::temp_dir().join(format!("nyan-invalid-protocol-{}.js", Uuid::new_v4()));
        fs::write(
            &script,
            r#"
let input = "";
for await (const chunk of Bun.stdin.stream()) {
  input += new TextDecoder().decode(chunk);
  const newline = input.indexOf("\n");
  if (newline < 0) continue;
  const request = JSON.parse(input.slice(0, newline));
  process.stdout.write(JSON.stringify({
    v: 1,
    type: "initialized",
    requestId: request.requestId,
    backend: { name: "fault-injector", version: "0", bunVersion: Bun.version }
  }) + "\n");
  process.stdout.write("{invalid json}\n");
  await Bun.sleep(10_000);
}
"#,
        )
        .unwrap();

        let manager = BackendManager::new(script.clone());
        let _ = manager.start().await;
        timeout(Duration::from_secs(2), async {
            loop {
                if matches!(manager.status().await, BackendStatus::ProtocolError { .. }) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();

        match manager.status().await {
            BackendStatus::ProtocolError { error } => {
                assert_eq!(error.code, "protocol_error");
                assert!(error.message.contains("invalid_json"));
            }
            status => panic!("expected protocol error, got {status:?}"),
        }
        timeout(Duration::from_secs(2), async {
            while manager.inner.writer.lock().await.is_some() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert!(matches!(
            manager.status().await,
            BackendStatus::ProtocolError { .. }
        ));
        let _ = fs::remove_file(script);
    }

    #[test]
    fn rejected_commands_preserve_backend_error_codes() {
        let error = ensure_ok(&json!({
            "v": 1,
            "type": "response",
            "ok": false,
            "error": {
                "code": "config_invalid",
                "message": "default_model is missing",
                "details": { "field": "default_model" }
            }
        }))
        .unwrap_err();

        assert_eq!(error.code, "config_invalid");
        assert_eq!(error.message, "default_model is missing");
        assert_eq!(error.details, Some(json!({ "field": "default_model" })));
    }

    #[test]
    fn packaged_agent_uses_the_tauri_resource_layout() {
        assert_eq!(
            packaged_agent_entry(Path::new("C:\\Program Files\\nyan-agent")),
            PathBuf::from("C:\\Program Files\\nyan-agent\\agent\\main.js")
        );
    }
}

fn ensure_ok(response: &Value) -> Result<(), BackendCommandError> {
    if response["ok"] == true {
        return Ok(());
    }
    Err(BackendCommandError {
        code: response
            .pointer("/error/code")
            .and_then(Value::as_str)
            .unwrap_or("backend_command_failed")
            .to_owned(),
        message: response
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("The backend rejected the request.")
            .to_owned(),
        details: response.pointer("/error/details").cloned(),
    })
}
