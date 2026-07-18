# 跨会话交接

状态：2026-07-19，阶段 1–3 已完成，下一会话从阶段 4“产品外壳”继续。

## 新会话目标

按照 [01-state.md](01-state.md) 推进阶段 4，不需要重新讨论已经审批的产品范围与技术方案。阶段 4 的目标是把当前“单页模型回合验证界面”升级为正式产品外壳：项目/任务 CRUD、侧栏与任务导航、模型选择、Lexical 纯文本输入、静态 Markdown transcript，以及 Win11 窗口视觉验证。

## 仓库现场

- 工作区：`C:\Dev\nyan-agent`。
- 分支：`main`。
- 最近功能基线：`a3abcb9 chore: add inspectable Tauri dev mode`；本交接文档会作为后续独立提交。
- `origin/main` 已包含上述功能基线；交接文档提交尚需在新会话前后按用户习惯推送。交接完成后本地工作区应保持干净。
- 最近两个功能提交：
  - `4ab6db5 feat: add configurable model turns and persistence`
  - `9dec731 feat: connect backend protocol vertical slice`
- 包管理器和脚本运行时为 Bun；当前实测 Bun `1.3.14`，Tauri crate 解析为 `2.11.5`，AI SDK 为 `7.0.31`。

## 已完成

### 阶段 1：workspace 骨架

- 已形成 `apps/desktop`、`apps/agent`、`packages/protocol` 三个包边界；Rust 与桌面 app 共置在 `apps/desktop/src-tauri`。
- 根目录提供统一的 `dev`、`check`、`test`、`build` 和 `tauri` 脚本。

### 阶段 2：协议与进程垂直切片

- TypeScript/Rust 已实现共享 v1 envelope、UUIDv4 领域 ID、请求响应、turn/tool/subagent 事件与 golden fixtures。
- 双端 NDJSON 覆盖半帧、多帧、CRLF、UTF-8 跨 chunk、16 MiB 上限和 EOF 半包。
- Rust supervisor 已实现全局 Bun 检测、无窗口子进程、stdin/stdout/stderr、握手、请求关联、Tauri Channel、异常退出与 shutdown 回退。
- 阶段 2 的 echo 记录仍保留在状态文档中，属于历史验收，不代表当前 backend 仍在 echo。

### 阶段 3：配置、provider 与最小 turn

- `apps/agent` 已接入 AI SDK v7 `ToolLoopAgent`，当前主 agent 无工具，`stopWhen` 为 50 steps。
- 支持 Anthropic-compatible 与 OpenAI-compatible provider、静态模型、动态发现、TTL cache、稳定去重和最近模型。
- 全局只允许一个活动 turn；支持幂等停止、文本/reasoning delta、完整 block 边界、同主模型并行标题生成与本地标题回退。
- 会话使用原子 `meta.json` + append-only `transcript.jsonl`；展示记录与规范化 model messages 分层，JSONL 使用单调 `seq`，支持半行截断和运行中 turn 恢复为 interrupted。
- Rust 已把 `submit_prompt` / `cancel_turn` 暴露给 React，并在进程存活期间复用当前 session。
- 当前 React 页面可以提交真实模型回合、显示纯文本回答、停止回合、显示底层事件与 backend 错误；它仍是阶段 3 验证 UI，不是正式任务界面。

## 配置与数据路径

- 程序只读用户维护的 `~/.config/nyan/config.toml`，不自动改写或重排。
- Windows 默认路径仍遵循技术方案，不使用 `%APPDATA%`：
  - config：`~/.config/nyan`
  - data：`~/.local/share/nyan`
  - state：`~/.local/state/nyan`
  - cache：`~/.cache/nyan`
- `XDG_CONFIG_HOME`、`XDG_DATA_HOME`、`XDG_STATE_HOME`、`XDG_CACHE_HOME` 的值是父目录，运行时再追加 `nyan`；测试全部使用同一套算法隔离到临时目录。
- provider schema 示例在仓库根 [README.md](../../README.md) 和 [04-technical-plan.md](04-technical-plan.md)。
- 模型选择顺序：最近有效模型 → `default_model` → 第一个可用模型。阶段 4 需要增加模型选择 UI。
- 尚未使用用户真实凭据做外部模型验收；自动化测试使用 mock model/provider fetch。不要读取、打印或改写用户真实凭据。

## 可观察开发闭环

- 普通开发：`bun run dev`。
- 需要 agent 检查真实 Tauri 页面时：`bun run dev:inspect`。
- `dev:inspect` 通过 [scripts/dev-inspect.ts](../../scripts/dev-inspect.ts) 只为本次子进程追加 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=0`，普通开发与 release 不暴露调试端点。
- 用户复现问题时，让窗口保持打开，并明确说“连 Tauri”。然后使用本机 `C:\Users\Admin\.agents\skills\chrome-cdp`，所有命令持续传 `--browser tauri`。
- 已实测自动发现 `C:\Users\Admin\AppData\Local\com.cha133.nyan-agent\EBWebView\DevToolsActivePort`，可读取 DOM、无障碍树、截图、连接前 console、实时对象日志和未处理异常栈。
- 本机技能新增命令：
  - `console <target> [level] [limit]`
  - `errors <target> [limit]`
  - `console-watch <target> [ms] [level] [limit]`
  - `console-clear <target>`
- 技能修改位于用户目录而非仓库，未来重新安装技能可能覆盖增强。
- WebdriverIO Tauri Service 尚未安装。已决定把 CDP 用于用户真实现场，把 WebdriverIO 留到阶段 4 UI 稳定后再建立 renderer mock E2E 和真实桌面 E2E。

## 最近验证

- `bun run check` 通过。
- `bun run test` 通过：protocol 7 项、agent 14 项、Rust 7 项；desktop 当前无独立前端测试文件。
- `bun run build` 通过。
- `cargo fmt --check` 与 `git diff --check` 通过。
- `bun run dev` 和 `bun run dev:inspect` 均完成真实 Tauri 启动冒烟；停止后未残留 nyan-agent/Bun 进程。
- `chrome-cdp` 的 Node 语法检查通过，并在当前 Tauri WebView2 上验证历史日志、对象日志、实时 watch、异常过滤和清空重置序号。
- Windows linker 会输出中文“正在创建库…”的普通 warning note，目前不是失败。

## 阶段 4 建议顺序

1. 重新阅读 [03-product.md](03-product.md) 的项目/任务、侧栏、输入区和窗口约束，以及 [04-technical-plan.md](04-technical-plan.md) 对应章节。
2. 先定义项目/任务 metadata、cwd 规则、列表/创建/加载协议和磁盘布局；Bun backend 继续拥有业务持久化，Rust 不保存业务状态。
3. 扩展 Rust/Tauri commands 与 React 状态层，支持项目/任务 CRUD、历史任务加载、运行中任务只读查看和模型选择。
4. 使用 HeroUI v3 搭建正式壳层和侧栏；开始实现前必须读取项目已安装版本的 bundled 文档，并使用 `heroui-react` skill，避免 v2 API。
5. 接入 Lexical 作为纯文本多行输入。assistant 文本在完整 block 收束后再用 `react-markdown + remark-gfm` 静态渲染；这两个 Markdown 包当前尚未安装。
6. 用 `dev:inspect` 逐步检查 DOM、截图与 console；为稳定元素增加语义和稳定选择器，UI 稳定后再接 WebdriverIO。
7. 尽早做 Win11 Mica + 原生标题栏 spike；保持 `decorations: true`，不要未经验证就改成自绘标题栏。
8. 完成阶段 4 后更新 [01-state.md](01-state.md)，重新运行根级检查/测试/构建与真实 Tauri 冒烟，再提交原子 commit。

## 不要提前做

- 阶段 5 的 shell/edit/subagent 尚未实现；不要在产品外壳阶段顺手加入工具。
- 不要引入 SQLite；MVP 继续使用 metadata + JSONL。
- 不要做流式 Markdown parser；未闭合文本只做纯文本预览。
- 不要把 WebView2 CDP 参数、WDIO 插件或调试权限带入 release。
- 不要从 `C:\Dev\nyan-agent-tui` 或参考仓库复制实现；它们只用于比较与理解。
- AI SDK API 必须依据 `apps/agent/node_modules/ai` 中与安装版本一致的 bundled docs/source，不能凭记忆。
- 用户已有改动始终优先保留；动手前检查 `git status`，提交前检查 staged diff。

## 新会话开场建议

先阅读 [00-index.md](00-index.md)、[03-product.md](03-product.md)、[04-technical-plan.md](04-technical-plan.md) 和 [01-state.md](01-state.md)，确认工作区干净，然后直接制定并执行阶段 4 的第一批原子任务。无需重新审批阶段 1–3，也无需重写本交接文档，除非用户再次明确要求跨会话交接。
