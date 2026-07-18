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
async fn echo_prompt(manager: State<'_, BackendManager>, prompt: String) -> Result<Value, String> {
    manager.echo_prompt(prompt).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let manager = BackendManager::new(development_agent_entry());
    let startup_manager = manager.clone();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(manager)
        .setup(move |_| {
            let _ = tauri::async_runtime::block_on(startup_manager.start());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backend_status,
            backend_subscribe,
            backend_restart,
            echo_prompt
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
