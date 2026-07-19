mod backend;
mod ndjson;
mod platform;
mod protocol;

use backend::{
    development_agent_entry, packaged_agent_entry, BackendCommandError, BackendManager,
    BackendStatus,
};
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
) -> Result<Value, BackendCommandError> {
    manager.submit_prompt(session_id, prompt).await
}

#[tauri::command]
async fn list_projects(manager: State<'_, BackendManager>) -> Result<Value, BackendCommandError> {
    manager.list_projects().await
}

#[tauri::command]
async fn add_project(
    manager: State<'_, BackendManager>,
    path: String,
) -> Result<Value, BackendCommandError> {
    manager.add_project(path).await
}

#[tauri::command]
async fn remove_project(
    manager: State<'_, BackendManager>,
    project_id: String,
) -> Result<Value, BackendCommandError> {
    manager.remove_project(project_id).await
}

#[tauri::command]
async fn set_project_context(
    manager: State<'_, BackendManager>,
    project_id: Option<String>,
) -> Result<Value, BackendCommandError> {
    manager.set_project_context(project_id).await
}

#[tauri::command]
async fn list_sessions(manager: State<'_, BackendManager>) -> Result<Value, BackendCommandError> {
    manager.list_sessions().await
}

#[tauri::command]
async fn list_models(
    manager: State<'_, BackendManager>,
    refresh: Option<bool>,
) -> Result<Value, BackendCommandError> {
    manager.list_models(refresh.unwrap_or(false)).await
}

#[tauri::command]
async fn create_session(
    manager: State<'_, BackendManager>,
    project_id: Option<String>,
    model: Option<String>,
) -> Result<Value, BackendCommandError> {
    manager.create_session(project_id, model).await
}

#[tauri::command]
async fn load_session(
    manager: State<'_, BackendManager>,
    session_id: String,
) -> Result<Value, BackendCommandError> {
    manager.load_session(session_id).await
}

#[tauri::command]
async fn set_session_model(
    manager: State<'_, BackendManager>,
    session_id: String,
    model: String,
) -> Result<Value, BackendCommandError> {
    manager.set_session_model(session_id, model).await
}

#[tauri::command]
async fn remove_session(
    manager: State<'_, BackendManager>,
    session_id: String,
) -> Result<Value, BackendCommandError> {
    manager.remove_session(session_id).await
}

#[tauri::command]
async fn cancel_turn(
    manager: State<'_, BackendManager>,
    session_id: String,
    turn_id: String,
) -> Result<Value, BackendCommandError> {
    manager.cancel_turn(session_id, turn_id).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());
    #[cfg(feature = "e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());
    let app = builder
        .setup(|app| {
            let main_window = app
                .get_webview_window("main")
                .ok_or("main window was not created")?;
            platform::apply_window_effects(&main_window)?;
            let agent_entry = if cfg!(debug_assertions) {
                development_agent_entry()
            } else {
                packaged_agent_entry(&app.path().resource_dir()?)
            };
            let manager = BackendManager::new(agent_entry);
            let startup_manager = manager.clone();
            app.manage(manager);
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
            set_project_context,
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
