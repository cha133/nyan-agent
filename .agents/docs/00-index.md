# nyan-agent MVP 文档索引

## 阅读顺序

1. [03-product.md](03-product.md)：已经确定的产品范围、交互规则与非目标。
2. [04-technical-plan.md](04-technical-plan.md)：已审批的 MVP 技术方案与关键决策。
3. [01-state.md](01-state.md)：当前进度和下一步任务。
4. [02-handoff.md](02-handoff.md)：用户要求跨会话交接时维护的上下文摘要。

若文档与用户的最新明确指令冲突，以最新指令为准，并在本轮同步修正文档。

## 当前工程

- 工作区：`C:\Dev\nyan-agent`
- 当前状态：阶段 3 已完成；桌面端已接通可配置 provider 的真实无工具模型回合、停止、标题生成、JSONL 会话持久化与中断恢复，并具备可供 agent 连接的 WebView2/CDP 开发模式。
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
- `bun run dev:inspect`：仅在本次开发子进程启用 `--remote-debugging-port=0`；agent 可通过 `DevToolsActivePort` 连接当前 Tauri WebView2，读取 DOM、无障碍树、截图、console、浏览器日志和未处理异常。
- 本机 `chrome-cdp` 技能位于 `C:\Users\Admin\.agents\skills\chrome-cdp`；已增加 `console`、`errors`、`console-watch`、`console-clear`。它不属于本仓库，重新安装技能可能覆盖本地增强。
- WebdriverIO Tauri Service 尚未接入；计划在阶段 4 UI 结构稳定后，用于固化 renderer 与真实桌面 E2E，而不是替代现场 CDP 调试。

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
