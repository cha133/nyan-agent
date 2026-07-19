use std::{
    path::PathBuf,
    process::{Command, Stdio},
};

use std::os::windows::process::CommandExt;
use tauri::{
    window::{Effect, EffectsBuilder},
    Runtime, WebviewWindow,
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
        Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
    },
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub struct BackendProcessGroup(HANDLE);

unsafe impl Send for BackendProcessGroup {}

impl Drop for BackendProcessGroup {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CloseHandle(self.0) };
        }
    }
}

pub fn assign_backend_process_group(pid: u32) -> Result<BackendProcessGroup, String> {
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return Err(format!(
                "Failed to create backend job object: {}",
                std::io::Error::last_os_error()
            ));
        }
        let group = BackendProcessGroup(job);
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) == 0
        {
            return Err(format!(
                "Failed to configure backend job object: {}",
                std::io::Error::last_os_error()
            ));
        }

        let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
        if process.is_null() {
            return Err(format!(
                "Failed to open Bun backend process: {}",
                std::io::Error::last_os_error()
            ));
        }
        let assigned = AssignProcessToJobObject(job, process);
        CloseHandle(process);
        if assigned == 0 {
            return Err(format!(
                "Failed to assign Bun backend to job object: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(group)
    }
}

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
