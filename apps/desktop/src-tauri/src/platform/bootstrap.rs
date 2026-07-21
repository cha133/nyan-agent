//! Unpackaged Windows App SDK bootstrap via Microsoft.WindowsAppRuntime.Bootstrap.dll.
//! Proven in C:\\Dev\\mica-demos\\mica-tauri.

use std::path::PathBuf;
use windows::core::{HRESULT, PCWSTR};
use windows::Win32::Foundation::{FreeLibrary, HMODULE};
use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

type MddBootstrapInitialize2Fn = unsafe extern "system" fn(
    major_minor_version: u32,
    version_tag: PCWSTR,
    min_version: PACKAGE_VERSION,
    options: i32,
) -> HRESULT;

type MddBootstrapShutdownFn = unsafe extern "system" fn();

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct PACKAGE_VERSION {
    version: u64,
}

pub struct Bootstrap {
    module: HMODULE,
    shutdown: MddBootstrapShutdownFn,
}

// HMODULE is a raw handle; Tauri managed state requires Send + Sync.
unsafe impl Send for Bootstrap {}
unsafe impl Sync for Bootstrap {}

impl Bootstrap {
    /// Initialize Windows App SDK runtime for an unpackaged process (major=2).
    pub fn initialize() -> windows::core::Result<Self> {
        let dll_path = bootstrap_dll_path();
        let wide = path_to_wide(&dll_path);
        let module = unsafe { LoadLibraryW(PCWSTR(wide.as_ptr())) }?;

        let init = unsafe {
            GetProcAddress(module, windows_core::s!("MddBootstrapInitialize2"))
                .ok_or_else(|| windows::core::Error::from_win32())?
        };
        let shutdown = unsafe {
            GetProcAddress(module, windows_core::s!("MddBootstrapShutdown"))
                .ok_or_else(|| windows::core::Error::from_win32())?
        };

        let init: MddBootstrapInitialize2Fn = unsafe { std::mem::transmute(init) };
        let shutdown: MddBootstrapShutdownFn = unsafe { std::mem::transmute(shutdown) };

        const OPTIONS_SHOW_UI: i32 = 0x0008;
        unsafe {
            init(
                0x0002_0000,
                PCWSTR::null(),
                PACKAGE_VERSION::default(),
                OPTIONS_SHOW_UI,
            )
        }
        .ok()?;

        Ok(Self { module, shutdown })
    }
}

impl Drop for Bootstrap {
    fn drop(&mut self) {
        unsafe {
            (self.shutdown)();
            let _ = FreeLibrary(self.module);
        }
    }
}

fn bootstrap_dll_path() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("Microsoft.WindowsAppRuntime.Bootstrap.dll");
            if candidate.is_file() {
                return candidate;
            }
        }
    }

    let user = std::env::var("USERPROFILE").expect("USERPROFILE");
    let base = PathBuf::from(user)
        .join(".nuget")
        .join("packages")
        .join("microsoft.windowsappsdk.foundation");
    let version = std::fs::read_dir(&base)
        .ok()
        .and_then(|rd| {
            let mut dirs: Vec<_> = rd
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect();
            dirs.sort();
            dirs.pop()
        })
        .unwrap_or_else(|| panic!("foundation package missing at {}", base.display()));

    version
        .join("runtimes")
        .join("win-x64")
        .join("native")
        .join("Microsoft.WindowsAppRuntime.Bootstrap.dll")
}

fn path_to_wide(path: &std::path::Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}
