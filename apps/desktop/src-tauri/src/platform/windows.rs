use std::{
    path::PathBuf,
    process::{Command, Stdio},
};

use std::os::windows::process::CommandExt;
use tauri::{
    window::{Effect, EffectsBuilder},
    Runtime, WebviewWindow,
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn apply_window_effects<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    window.set_effects(EffectsBuilder::new().effect(Effect::Mica).build())
}

#[derive(Clone, Debug)]
pub struct BunRuntime {
    pub executable: PathBuf,
    pub version: String,
}

pub fn detect_bun() -> Result<BunRuntime, String> {
    let output = Command::new("where.exe")
        .arg("bun")
        .stdin(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| format!("Failed to inspect PATH for Bun: {error}"))?;

    if !output.status.success() {
        return Err("Bun was not found on the PATH inherited by nyan-agent.".to_owned());
    }

    let executable = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| "Bun lookup returned no executable path.".to_owned())?;
    let version = Command::new(&executable)
        .arg("--version")
        .stdin(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| format!("Bun was found but could not be started: {error}"))?;

    if !version.status.success() {
        return Err(format!(
            "Bun version check failed with exit code {:?}.",
            version.status.code()
        ));
    }

    Ok(BunRuntime {
        executable,
        version: String::from_utf8_lossy(&version.stdout).trim().to_owned(),
    })
}

pub fn configure_no_window(command: &mut tokio::process::Command) {
    command.as_std_mut().creation_flags(CREATE_NO_WINDOW);
}
