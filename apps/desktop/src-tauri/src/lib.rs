mod backend;
mod ndjson;
mod platform;
mod protocol;

use backend::{development_agent_entry, BackendManager, BackendStatus};
use serde_json::Value;
use tauri::{ipc::Channel, Manager, State};

#[tauri::command]
async fn backend_status(manager: State<'_, BackendManager>) -> Result<BackendStatus, String> {
    Ok(manager.status().await)
}

#[tauri::command]
async fn backend_subscribe(
    manager: State<'_, BackendManager>,
    on_event: Channel<Value>,
) -> Result<(), String> {
    manager.subscribe(on_event).await;
    Ok(())
}

#[tauri::command]
async fn backend_restart(manager: State<'_, BackendManager>) -> Result<BackendStatus, String> {
    manager.restart().await?;
    Ok(manager.status().await)
}

#[tauri::command]
async fn submit_prompt(
    manager: State<'_, BackendManager>,
    session_id: String,
    prompt: String,
) -> Result<Value, String> {
    manager.submit_prompt(session_id, prompt).await
}

#[tauri::command]
async fn list_projects(manager: State<'_, BackendManager>) -> Result<Value, String> {
    manager.list_projects().await
}

#[tauri::command]
async fn add_project(manager: State<'_, BackendManager>, path: String) -> Result<Value, String> {
    manager.add_project(path).await
}

#[tauri::command]
async fn remove_project(
    manager: State<'_, BackendManager>,
    project_id: String,
) -> Result<Value, String> {
    manager.remove_project(project_id).await
}

#[tauri::command]
async fn list_sessions(manager: State<'_, BackendManager>) -> Result<Value, String> {
    manager.list_sessions().await
}

#[tauri::command]
async fn list_models(
    manager: State<'_, BackendManager>,
    refresh: Option<bool>,
) -> Result<Value, String> {
    manager.list_models(refresh.unwrap_or(false)).await
}

#[tauri::command]
async fn create_session(
    manager: State<'_, BackendManager>,
    project_id: Option<String>,
    model: Option<String>,
) -> Result<Value, String> {
    manager.create_session(project_id, model).await
}

#[tauri::command]
async fn load_session(
    manager: State<'_, BackendManager>,
    session_id: String,
) -> Result<Value, String> {
    manager.load_session(session_id).await
}

#[tauri::command]
async fn set_session_model(
    manager: State<'_, BackendManager>,
    session_id: String,
    model: String,
) -> Result<Value, String> {
    manager.set_session_model(session_id, model).await
}

#[tauri::command]
async fn remove_session(
    manager: State<'_, BackendManager>,
    session_id: String,
) -> Result<Value, String> {
    manager.remove_session(session_id).await
}

#[tauri::command]
async fn cancel_turn(
    manager: State<'_, BackendManager>,
    session_id: String,
    turn_id: String,
) -> Result<Value, String> {
    manager.cancel_turn(session_id, turn_id).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let manager = BackendManager::new(development_agent_entry());
    let startup_manager = manager.clone();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(manager)
        .setup(move |_| {
            let _ = tauri::async_runtime::block_on(startup_manager.start());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backend_status,
            backend_subscribe,
            backend_restart,
            list_projects,
            add_project,
            remove_project,
            list_sessions,
            list_models,
            create_session,
            load_session,
            set_session_model,
            remove_session,
            submit_prompt,
            cancel_turn
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let manager = app_handle.state::<BackendManager>();
            tauri::async_runtime::block_on(manager.shutdown());
        }
    });
}
