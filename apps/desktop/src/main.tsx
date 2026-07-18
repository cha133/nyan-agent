import React from "react";
import ReactDOM from "react-dom/client";
import "./globals.css";
import App from "./App";

async function bootstrap() {
  if (import.meta.env.MODE === "e2e") await import("@wdio/tauri-plugin");

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
