use std::{
    path::PathBuf,
    process::{Command, Stdio},
};

use std::os::windows::process::CommandExt;
use tauri::{Runtime, WebviewWindow};
use windows::UI::Composition::Compositor;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::WinRT::{
    CreateDispatcherQueueController, DispatcherQueueOptions, RoInitialize, DQTAT_COM_NONE,
    DQTYPE_THREAD_CURRENT, RO_INIT_SINGLETHREADED,
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

use super::bootstrap::Bootstrap;
use super::mica::MicaBackdrop;

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

/// Keeps WASDK bootstrap + MicaController alive for the process lifetime.
pub struct SystemMicaHost {
    _bootstrap: Bootstrap,
    _dispatcher: windows::System::DispatcherQueueController,
    _compositor: Compositor,
    _mica: MicaBackdrop,
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

/// Attach WASDK Mica with forced IsInputActive. Do not also call Tauri Effect::Mica.
pub fn attach_system_mica<R: Runtime>(window: &WebviewWindow<R>) -> Result<SystemMicaHost, String> {
    let hwnd = window.hwnd().map_err(|err| err.to_string())?;
    let hwnd = HWND(hwnd.0);

    let _ = unsafe { RoInitialize(RO_INIT_SINGLETHREADED) };

    let bootstrap = Bootstrap::initialize().map_err(|err| format!("WASDK bootstrap failed: {err}"))?;
    let dispatcher = create_dispatcher_queue()
        .map_err(|err| format!("DispatcherQueue failed: {err}"))?;
    let compositor =
        Compositor::new().map_err(|err| format!("Compositor::new failed: {err}"))?;
    let mica = MicaBackdrop::attach_locked(&compositor, hwnd)
        .map_err(|err| format!("MicaController attach failed: {err}"))?;

    Ok(SystemMicaHost {
        _bootstrap: bootstrap,
        _dispatcher: dispatcher,
        _compositor: compositor,
        _mica: mica,
    })
}

fn create_dispatcher_queue() -> windows::core::Result<windows::System::DispatcherQueueController>
{
    let options = DispatcherQueueOptions {
        dwSize: std::mem::size_of::<DispatcherQueueOptions>() as u32,
        threadType: DQTYPE_THREAD_CURRENT,
        apartmentType: DQTAT_COM_NONE,
    };
    unsafe { CreateDispatcherQueueController(options) }
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
