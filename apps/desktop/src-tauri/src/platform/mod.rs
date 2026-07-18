#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "windows")]
pub use windows::{apply_window_effects, configure_no_window, detect_bun};
