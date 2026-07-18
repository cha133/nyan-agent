# 跨会话交接

状态：2026-07-19，产品与技术方案已审批，准备开始实现。

## 目标

从已审批的 MVP 文档基线开始开发 nyan-agent。下一会话只完成阶段 1：把现有 Tauri 模板迁移为 Bun workspace monorepo，并保持模板可构建、可启动；不要同时实现业务协议或 agent。

## 已完成

- 建立简版 [AGENTS.md](../../AGENTS.md) 与临时文档入口 [00-index.md](00-index.md)。
- 在 [03-product.md](03-product.md) 固化平台、三个工具、YOLO、provider/model、配置路径、GUI 和非目标。
- 在 [04-technical-plan.md](04-technical-plan.md) 固化 monorepo、Rust/Bun 边界、NDJSON、JSONL、PowerShell UTF-8、subagent 和实施顺序。
- 用户已明确审批上述方案。
- 本轮只改文档，没有移动模板、修改依赖或写业务代码。

## 当前现场

- 工作区：`C:\Dev\nyan-agent`。
- 当前仓库仍是根目录单包 Tauri 2 模板：React/Vite 源码在 `src`，Rust 在 `src-tauri`。
- 当前关键版本：AI SDK `7.0.31`、HeroUI `3.2.2`、Tailwind CSS `4.3.3`、Lexical `0.48.0`。
- 当前文档新增为未跟踪文件，本次交接完成后会一并提交；交给下一会话时应为干净工作区。
- 没有运行中的开发服务，也没有已知失败测试。迁移前仍应重新记录 build/check 基线。

## 关键决定

- 目标结构为 `apps/desktop`、`apps/agent`、`packages/protocol`；Rust 保留在 `apps/desktop/src-tauri`，不作为 Bun workspace 包。
- Rust 只做 Tauri、窗口和 Bun supervisor；AI SDK、工具与持久化在 Bun 后端。
- Rust/Bun 使用自行实现的 UTF-8 NDJSON；前端流式 IPC 使用 Tauri Channel。
- provider 只做 Anthropic-compatible 与 OpenAI-compatible；配置在 `~/.config/nyan/config.toml`，动态模型缓存 1 小时。
- Windows 默认不使用 `%APPDATA%`；保留 XDG 环境变量覆盖以隔离测试。
- 会话使用每 session 的 `meta.json + transcript.jsonl`，MVP 不用 SQLite。
- 全局只运行一个主 turn，但可以查看其他历史任务。
- Markdown 只在完整 block 结束后静态渲染，不做流式 Markdown parser。
- PowerShell 7 使用单层 UTF-16LE Base64 `-EncodedCommand` 和明确的 UTF-8 初始化。

## 下一步

严格执行 [01-state.md](01-state.md) 的“阶段 1 — workspace 骨架”：

1. 先运行并记录现有 `bun run build` 与 `cargo check --manifest-path src-tauri/Cargo.toml`。
2. 迁移桌面模板到 `apps/desktop`，同步修正 Vite 和 Tauri build/dev 相对路径。
3. 创建最小 `apps/agent` 与 `packages/protocol` package；只做占位入口/导出。
4. 根包改为 workspace 聚合脚本，按边界重新分配 dependencies/devDependencies。
5. `bun install` 更新 lockfile，然后从根目录验证 typecheck、build、Cargo check 和 Tauri dev smoke test。
6. 更新 `01-state.md`，提交一个只包含 monorepo 骨架迁移的原子 commit。

阶段 1 不需要重新讨论产品方案；遇到目录/脚本小问题按 [04-technical-plan.md](04-technical-plan.md) 的既定边界自行处理。

## 风险与注意事项

- 现有 `tauri.conf.json` 的 `beforeDevCommand`、`beforeBuildCommand`、`devUrl`、`frontendDist` 都是按根目录模板写的，移动后必须实测相对路径解析基准。
- 不要从 `C:\Dev\nyan-agent-tui` 复制代码；它只用于理解旧需求。
- AI SDK API 只能按本项目安装版本的 bundled docs/source 实现；不要凭记忆写 v6/v7 API。
- HeroUI 必须使用 v3 compound API、Tailwind v4 和 `onPress`，不能引入 v2 Provider 写法。
- 不要在阶段 1 顺手实现完整 protocol、配置、provider、shell 或 UI，以免骨架迁移难以审查和回退。
- 用户已有改动始终优先保留；每次提交前检查 `git status` 和 diff，避免带入无关文件。
