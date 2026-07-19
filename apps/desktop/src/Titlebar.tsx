import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Win11 caption glyphs from Segoe Fluent Icons / Segoe MDL2 Assets. */
const ICON = {
  minimize: "\uE921",
  maximize: "\uE922",
  restore: "\uE923",
  close: "\uE8BB",
} as const;

export function Titlebar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let active = true;

    void appWindow.isMaximized().then((value) => {
      if (active) setMaximized(value);
    });

    const unlistenPromise = appWindow.onResized(() => {
      void appWindow.isMaximized().then((value) => {
        if (active) setMaximized(value);
      });
    });

    return () => {
      active = false;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  return (
    <header className="titlebar">
      <div className="titlebar-drag" data-tauri-drag-region />
      <div className="titlebar-controls">
        <button
          type="button"
          className="titlebar-button"
          aria-label="最小化"
          onClick={() => void getCurrentWindow().minimize()}
        >
          <span className="titlebar-icon" aria-hidden="true">
            {ICON.minimize}
          </span>
        </button>
        <button
          type="button"
          id="titlebar-maximize"
          className="titlebar-button"
          aria-label={maximized ? "还原" : "最大化"}
        >
          <span className="titlebar-icon" aria-hidden="true">
            {maximized ? ICON.restore : ICON.maximize}
          </span>
        </button>
        <button
          type="button"
          className="titlebar-button titlebar-close"
          aria-label="关闭"
          onClick={() => void getCurrentWindow().close()}
        >
          <span className="titlebar-icon" aria-hidden="true">
            {ICON.close}
          </span>
        </button>
      </div>
    </header>
  );
}
