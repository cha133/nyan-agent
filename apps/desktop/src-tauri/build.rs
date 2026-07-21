use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    tauri_build::build();

    if env::var("CARGO_CFG_TARGET_OS").unwrap_or_default() != "windows" {
        return;
    }

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let profile = env::var("PROFILE").unwrap();

    let winmd = nuget_winmd();
    println!("cargo:rerun-if-changed={}", winmd.display());

    let bindings = out_dir.join("wasdk_bindings.rs");
    windows_bindgen::bindgen([
        "--out",
        bindings.to_str().unwrap(),
        "--in",
        winmd.to_str().unwrap(),
        "default",
        "--filter",
        "Microsoft.UI.Composition.SystemBackdrops",
        "Microsoft.UI.WindowId",
        "--reference",
        "windows",
    ]);

    let raw = fs::read_to_string(&bindings).expect("read generated bindings");
    let fixed = raw.replacen("#![allow(", "#[allow(", 1);
    fs::write(&bindings, fixed).expect("rewrite generated bindings");

    let bootstrap_dll = nuget_bootstrap_dll();
    println!("cargo:rerun-if-changed={}", bootstrap_dll.display());

    let exe_dir = manifest_dir.join("target").join(&profile);
    fs::create_dir_all(&exe_dir).ok();
    let dest = exe_dir.join("Microsoft.WindowsAppRuntime.Bootstrap.dll");
    if let Err(err) = fs::copy(&bootstrap_dll, &dest) {
        println!(
            "cargo:warning=failed to copy Bootstrap.dll to {}: {err}",
            dest.display()
        );
    }

    if let Some(profile_dir) = out_dir.ancestors().nth(3) {
        let dest2 = profile_dir.join("Microsoft.WindowsAppRuntime.Bootstrap.dll");
        let _ = fs::copy(&bootstrap_dll, dest2);
    }
}

fn nuget_packages() -> PathBuf {
    PathBuf::from(env::var("USERPROFILE").expect("USERPROFILE"))
        .join(".nuget")
        .join("packages")
}

fn nuget_winmd() -> PathBuf {
    let base = nuget_packages().join("microsoft.windowsappsdk.interactiveexperiences");
    let version_dir = newest_subdir(&base).unwrap_or_else(|| {
        panic!(
            "Windows App SDK interactiveexperiences package not found at {}",
            base.display()
        )
    });
    let winmd = version_dir
        .join("metadata")
        .join("10.0.18362.0")
        .join("Microsoft.UI.winmd");
    if !winmd.is_file() {
        let alt = version_dir
            .join("metadata")
            .join("10.0.17763.0")
            .join("Microsoft.UI.winmd");
        if alt.is_file() {
            return alt;
        }
        panic!("Microsoft.UI.winmd not found under {}", version_dir.display());
    }
    winmd
}

fn nuget_bootstrap_dll() -> PathBuf {
    let base = nuget_packages().join("microsoft.windowsappsdk.foundation");
    let version_dir = newest_subdir(&base).unwrap_or_else(|| {
        panic!(
            "Windows App SDK foundation package not found at {}",
            base.display()
        )
    });
    let dll = version_dir
        .join("runtimes")
        .join("win-x64")
        .join("native")
        .join("Microsoft.WindowsAppRuntime.Bootstrap.dll");
    if !dll.is_file() {
        panic!("Bootstrap.dll not found at {}", dll.display());
    }
    dll
}

fn newest_subdir(dir: &Path) -> Option<PathBuf> {
    let mut entries: Vec<_> = fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().ok().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| e.path())
        .collect();
    entries.sort();
    entries.pop()
}
