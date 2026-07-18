# nyan-agent

Windows-first desktop coding agent built with Tauri, React, Bun, and the AI SDK.

## Workspace

- `apps/desktop`: Tauri 2 + React/Vite desktop application
- `apps/agent`: Bun agent backend
- `packages/protocol`: shared desktop/backend protocol package

## Commands

```powershell
bun install
bun run dev
bun run dev:inspect
bun run check
bun run test
bun run build
```

Run commands from the repository root. `bun run dev` starts the Tauri desktop application.

Use `bun run dev:inspect` when an agent needs to inspect the live Tauri WebView2 page. It starts the same development app with a process-local random CDP port; regular development and production builds do not expose the debugging endpoint. After reproducing an issue, keep the window open and ask the agent to connect specifically to Tauri.

## Model configuration

Create `%USERPROFILE%\.config\nyan\config.toml` before starting a model turn:

```toml
version = 1
default_model = "openai-main/gpt-example"
model_cache_ttl_seconds = 3600

[[providers]]
id = "openai-main"
kind = "openai-compatible"
base_url = "https://example.com/v1"
api_key = "replace-me"
models = ["gpt-example"]
discover_models = true
```

Provider `kind` may be `openai-compatible` or `anthropic-compatible`. The latter accepts exactly one of `api_key` or `auth_token`. Optional `headers`, `discovery_url`, and `discovery_headers` fields support compatible gateways. Nyan reads this file but never rewrites it; discovered models and the recent model are stored separately under the XDG cache and state directories.
