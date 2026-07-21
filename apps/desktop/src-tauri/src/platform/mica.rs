//! WASDK MicaController for Tauri WebView2 HWND.
//! Same lock path as C:\\Dev\\mica-demos\\mica-tauri (SetTarget then IsInputActive).

use crate::platform::wasdk::Microsoft::UI::Composition::SystemBackdrops::{
    MicaController, MicaKind, SystemBackdropConfiguration, SystemBackdropTheme,
};
use crate::platform::wasdk::Microsoft::UI::WindowId;
use windows::core::Interface;
use windows::UI::Composition::Desktop::DesktopWindowTarget;
use windows::UI::Composition::{CompositionTarget, Compositor, ContainerVisual};
use windows::Win32::Foundation::HWND;
use windows::Win32::System::WinRT::Composition::ICompositorDesktopInterop;

pub struct MicaBackdrop {
    _target: DesktopWindowTarget,
    _root: ContainerVisual,
    controller: MicaController,
    _config: SystemBackdropConfiguration,
}

impl MicaBackdrop {
    /// Attach system Mica under the WebView layer (`is_topmost=false`).
    pub fn attach_locked(compositor: &Compositor, hwnd: HWND) -> windows::core::Result<Self> {
        if !MicaController::IsSupported()? {
            return Err(windows::core::Error::new(
                windows::core::HRESULT(0x80004001u32 as i32),
                "MicaController::IsSupported() returned false",
            ));
        }

        let interop: ICompositorDesktopInterop = compositor.cast()?;
        let target = unsafe { interop.CreateDesktopWindowTarget(hwnd, false)? };
        let root = compositor.CreateContainerVisual()?;
        target.SetRoot(&root)?;

        let controller = MicaController::new()?;
        controller.SetKind(MicaKind::Base)?;

        let window_id = WindowId {
            Value: hwnd.0 as usize as u64,
        };
        let composition_target: CompositionTarget = target.cast()?;
        let ok = controller.SetTargetWithWindowId(window_id, &composition_target)?;
        if !ok {
            return Err(windows::core::Error::new(
                windows::core::HRESULT(0x80004005u32 as i32),
                "MicaController::SetTargetWithWindowId returned false",
            ));
        }

        // Order matters: SetTarget first, then configuration. Force IsInputActive
        // so wallpaper tint stays when the window is unfocused.
        let config = SystemBackdropConfiguration::new()?;
        config.SetIsInputActive(true)?;
        config.SetTheme(SystemBackdropTheme::Default)?;
        controller.SetSystemBackdropConfiguration(&config)?;

        Ok(Self {
            _target: target,
            _root: root,
            controller,
            _config: config,
        })
    }
}

impl Drop for MicaBackdrop {
    fn drop(&mut self) {
        let _ = self.controller.Close();
    }
}
