# nyan-agent MVP 文档索引

## 阅读顺序

1. [03-product.md](03-product.md)：已经确定的产品范围、交互规则与非目标。
2. [04-technical-plan.md](04-technical-plan.md)：已审批的 MVP 技术方案与关键决策。
3. [01-state.md](01-state.md)：当前进度和下一步任务。
4. [02-handoff.md](02-handoff.md)：用户要求跨会话交接时维护的上下文摘要。

若文档与用户的最新明确指令冲突，以最新指令为准，并在本轮同步修正文档。

## 当前工程

- 工作区：`C:\Dev\nyan-agent`
- 当前状态：阶段 4 进行中；项目/任务数据层、正式白色产品外壳、侧栏导航、Lexical/Markdown transcript 和跨项目最近模型选择已形成可运行垂直切片。
- 包管理器与脚本运行时：Bun。
- 已安装的关键依赖：AI SDK `7.0.31`、HeroUI `3.2.2`、Tailwind CSS `4.3.3`、Lexical `0.48.0`、Lucide React `1.25.0`。

## 本地参考仓库

这些仓库只用于阅读、比较与验证设计，不能直接复制实现：

| 参考 | 绝对路径 | 主要用途 |
| --- | --- | --- |
| Codex | `C:\Dev\codex` | GUI 产品交互、shell/进程工具、输出截断、agent harness |
| AI SDK | `C:\Dev\ai` | 与已安装版本对应的 agent loop、tool、stream、abort、subagent API |
| HeroUI | `C:\Dev\heroui` | HeroUI v3 组件、样式和主题实现 |
| OpenCode | `C:\Dev\opencode` | edit 工具的多级匹配与安全校验 |
| 已放弃的 TUI 原型 | `C:\Dev\nyan-agent-tui` | 仅用于理解旧需求和测试面；不可抄代码 |

优先读取当前工程 `node_modules` 中与安装版本完全匹配的 AI SDK/HeroUI 文档；本地源码仓库用于补充追踪实现。

## 开发与调试

- `bun run dev`：普通 Tauri 开发模式。
- `bun run dev:inspect`：需要调试 renderer 时必须使用此入口；它只在本次开发子进程启用随机 CDP 端口（`--remote-debugging-port=0`），不会污染普通启动或全局环境。
- 本机 `chrome-cdp` 技能位于 `C:\Users\Admin\.agents\skills\chrome-cdp`；已增加 `console`、`errors`、`console-watch`、`console-clear`。它不属于本仓库，重新安装技能可能覆盖本地增强。
- 启动完成后运行 `node C:\Users\Admin\.agents\skills\chrome-cdp\scripts\cdp.mjs --browser tauri list`。脚本会从 nyan-agent 的 WebView2 用户数据目录发现 `DevToolsActivePort`；复制输出中的唯一 target ID 前缀，并在后续所有命令中始终传 `--browser tauri`。
- 常用检查：`snap <target> --compact` 读取无障碍树，`shot <target> <absolute.png>` 截图，`console <target> warning 100` 读取 console，`errors <target> 100` 读取未处理异常。复现时序问题前先运行 `console-watch <target> <ms> warning 100`；需要重新采集时使用 `console-clear <target>`。
- 交互调试优先用 `click <target> <selector>` 和 `type <target> <text>`；富文本/`contenteditable` 若 selector 点击未取得焦点，可根据 `shot` 输出的 DPR 换算 CSS 坐标后使用 `clickxy`，再用 `eval` 验证 `document.activeElement` 与 DOM 状态。
- `nav`/页面重载会主动丢弃旧页面的 Tauri 异步 callback，紧邻重载出现 “Couldn't find callback id” warning 属于调试操作副作用；页面稳定后先 `console-clear`，再用 `console-watch` 复查，不能把旧 warning 当成应用运行时故障。
- 结束时停止 `dev:inspect` 启动的父进程，确认 Tauri、Vite 与 Bun 子进程一起退出。不要用普通 `bun run dev` 代替本流程，否则不会生成可发现的 CDP 端点。
- WebdriverIO Tauri Service 已使用 embedded provider 接入真实桌面 E2E；`bun run e2e` 通过测试专用 Tauri 配置构建并启动真实 WebView2，不需要外置 `tauri-driver`。Node 24 由仓库根 `mise.toml` 固定，首次运行前执行 `mise install`。
- E2E 数据通过临时 XDG 父目录与真实用户配置隔离，测试结束后清理；WDIO 插件权限、global Tauri API 和前端 guest plugin 只进入 E2E 构建。当前 smoke flow 覆盖后端 ready、产品外壳、Tauri command bridge 和默认项目上下文的刷新恢复。
- `dev:inspect` + CDP 继续用于现场诊断；WebdriverIO 用于稳定回归，两者职责不变。

## 用户提供的参考材料

- NDJSON 讨论：`C:\Users\Admin\Documents\gpt-reply-of-ndjson.md`
- 产品决策：`C:\Users\Admin\Documents\Agent 产品决策.md`
- PowerShell 7 中文编码分析：`C:\Users\Admin\Documents\pwsh-UTF8-中文乱码解决方案.md`
- Codex GUI 截图：`C:\Users\Admin\Documents\codex-screenshot.png`

截图是视觉参考，不要求逐像素复刻。

## 外部技术资料

- [Tauri 2：从前端调用 Rust（含 Channel）](https://v2.tauri.app/develop/calling-rust/)
- [Tauri 2：从 Rust 调用前端](https://v2.tauri.app/develop/calling-frontend/)
- [Tauri 2 Window API（Mica/windowEffects）](https://v2.tauri.app/reference/javascript/api/namespacewindow/)
- [Tauri 2 窗口定制](https://v2.tauri.app/learn/window-customization/)
- [AI SDK 文档](https://ai-sdk.dev/docs)
- [HeroUI v3 文档](https://heroui.com/docs/react/getting-started/installation)
- [Tauri 2 WebDriver 测试](https://v2.tauri.app/develop/tests/webdriver/)
- [Microsoft：让 agent 通过 CDP 检查 WebView2](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/devtools-mcp-server)
