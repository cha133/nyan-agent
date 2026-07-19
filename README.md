# nyan-agent

Windows-first desktop coding agent built with Tauri, React, Bun, and the AI SDK.

## Workspace

- `apps/desktop`: Tauri 2 + React/Vite desktop application
- `apps/agent`: Bun agent backend
- `packages/protocol`: shared desktop/backend protocol package
- `docs/`: product and architecture docs; see [docs/README.md](docs/README.md) for the index and the convention for temporary docs on complex requirements (small changes do not need temporary docs)

## Commands

```powershell
bun install
mise install
bun run dev
bun run dev:inspect
bun run e2e
bun run check
bun run test
bun run build
```

Run commands from the repository root. `bun run dev` starts the Tauri desktop application.

Use `bun run dev:inspect` when an agent needs to inspect the live Tauri WebView2 page. It starts the same development app with a process-local random CDP port; regular development and production builds do not expose the debugging endpoint. After reproducing an issue, keep the window open and ask the agent to connect specifically to Tauri.

`bun run e2e` builds a test-only desktop binary and runs the WebdriverIO smoke flow against the real Tauri/WebView2 application. Node 24 is pinned by `mise.toml`; run `mise install` once before the first E2E run. Test configuration, projects, sessions, state, and cache use a temporary isolated directory that is removed after the run. The WDIO plugins and global Tauri API are enabled only in the E2E build configuration.

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
