#[cfg(target_os = "windows")]
mod bootstrap;
#[cfg(target_os = "windows")]
mod mica;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "windows")]
#[allow(
    non_snake_case,
    non_camel_case_types,
    dead_code,
    unused_imports,
    clippy::all
)]
pub(crate) mod wasdk {
    include!(concat!(env!("OUT_DIR"), "/wasdk_bindings.rs"));
}

#[cfg(target_os = "windows")]
pub use windows::{
    assign_backend_process_group, attach_system_mica, configure_no_window, detect_bun,
};
