# 跨会话交接

状态：2026-07-19。MVP 阶段 1–6 已全部完成；真实 provider 桌面综合验收、AI SDK warning stdout 污染修复、React StrictMode Channel 重复订阅修复，以及正式 `AGENTS.md` 沉淀均已完成。

## MVP 完成摘要

- 真实 Tauri/WebView2 综合验收：shell 读文件 → edit 精确替换 → 两个只读 subagent 并行 → shell 复验；长进程 poll 与 UI 停止均通过。
- 修复 AI SDK warning 经 `console.info` 污染 Bun stdout、触发 NDJSON `protocol_error` 的发布阻断问题；`configureRuntimeLogging()` 通过官方 `AI_SDK_LOG_WARNINGS` 把 warning 写入 stderr，并新增回归测试。
- 修复 React StrictMode 导致 Tauri Channel 双订阅、assistant block 与工具卡片重复显示；订阅延迟到 StrictMode 首轮 cleanup 之后，handler 带失活保护。
- 根 `AGENTS.md` 已从临时入口扩充为正式工程指南；`.agents/docs/00-index.md` 与 `01-state.md` 已同步为 MVP 完成状态。

## 仓库现场

- 工作区：`C:\Dev\nyan-agent`；分支：`main`，领先 `origin/main` 1 个提交（`94625d7 feat: supervise backend process tree`）。
- 本轮待提交改动：`AGENTS.md`、`.agents/docs/00-index.md`、`.agents/docs/01-state.md`、`.agents/docs/02-handoff.md`、`apps/agent/src/runtime-logging.ts`、`apps/agent/src/runtime-logging.test.ts`、`apps/agent/src/main.ts`、`apps/desktop/src/App.tsx`。
- 包管理器和 agent 运行时为 Bun；WebdriverIO 通过根 `mise.toml` 固定 Node 24。

## 最近验证（2026-07-19 收尾）

- `bun run check`
- protocol 7 项、agent 54 项、desktop 12 项、Rust 10 项
- `bun run build` 与 production agent artifact smoke
- `cargo fmt --check`、`git diff --check`
- 六次隔离真实 Tauri `bun run e2e`
- production Vite bundle 仍只有既有 >500 KiB chunk warning，当前不阻塞 MVP

## 真实模型配置（本机，勿提交）

- 配置路径：`C:\Users\Admin\.config\nyan\config.toml`
- 默认模型：`ark/minimax-m3`；Anthropic-compatible base URL 为 `https://ark.cn-beijing.volces.com/api/coding/v1`
- 凭据使用 `auth_token_env = "ARK_TOKEN"`；日志、文档、fixture 和提交不得记录 token 值
- limits：`context_window = 1000000`、`max_output_tokens = 128000`

## 已知未做 / 后续方向

- 没有接入 CI E2E；当前稳定桌面 E2E 仍是本机 Windows 回归入口。
- 没有从参考仓库复制实现。
- post-MVP 方向未在本轮定义；新工作开始前先读根 `AGENTS.md` 与 `01-state.md`，并与用户确认范围。

## 调试与 chrome-cdp

- 普通开发：`bun run dev`；renderer/真实桌面验收：`bun run dev:inspect`。
- 本机技能：`C:\Users\Admin\.agents\skills\chrome-cdp`。本地 Tauri/WebView2 可直接连接；Chrome/Edge 仍需明确批准。
- 用 `node C:\Users\Admin\.agents\skills\chrome-cdp\scripts\cdp.mjs --browser tauri list` 发现 target，后续始终传 `--browser tauri`。
- 结束时停止 `dev:inspect` 父进程，并确认 Tauri、Vite、Bun 及工具子进程均退出。

## 新会话建议顺序

1. 按 [00-index.md](00-index.md) 顺序阅读产品、技术方案、状态和本文件；运行 `git status --short --branch` 核对工作区。
2. 若继续 post-MVP 开发，先与用户确认目标，再更新 `01-state.md`。
3. 涉及 renderer 或真实桌面行为时，用 `bun run dev:inspect` + chrome-cdp；稳定回归用 `bun run e2e`。
