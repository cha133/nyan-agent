# 跨会话交接

状态：2026-07-19。阶段 1–4 已形成可运行垂直切片；阶段 5 的 shell 与 edit 已完成并贯通 AI SDK、领域事件、JSONL 和桌面 transcript，下一主线是 subagent。真实 provider 的底层流式请求已经验证，真实桌面 shell/edit 完整回合仍待验收。

## 新会话目标

继续 [01-state.md](01-state.md) 的阶段 5，不需要重新讨论已审批的 [03-product.md](03-product.md) 和 [04-technical-plan.md](04-technical-plan.md)：

1. 实现 subagent 阻塞工具：一次接受 1–3 个独立任务，并发上限 3，同模型、独立上下文，只提供 shell/edit，不允许递归 subagent。
2. 将父 turn 的 AbortSignal 传给所有 subagent；停止主 turn 时级联停止子 agent 和它们启动的 PowerShell 进程树，使用 `Promise.allSettled` 保留部分成功结果。
3. 接入 `subagent.activity`：每个子任务在 UI 只保留状态和一行最新 reasoning/tool/text 活动，详细过程不展开，最终结果只作为 tool result 返回主模型。
4. 如本机真实模型配置可用，用真实桌面回合验收 shell/edit、长进程轮询和停止；自动化测试不得读取真实密钥。

## 仓库现场

- 工作区：`C:\Dev\nyan-agent`；分支：`main`，跟踪 `origin/main`。
- 最近功能提交：`64c5437 feat: add PowerShell shell tool`；edit 与本交接文档会在当前会话结束前一并提交，提交后工作区应干净。
- 包管理器和 agent 运行时为 Bun，本机实测 `1.3.14`；WebdriverIO 通过根 `mise.toml` 固定 Node 24。
- Tauri `2.11.5`、AI SDK `7.0.31`、HeroUI `3.2.2`。
- 本次会话没有 push；是否推送由下一会话或用户决定。

## 当前实现

### 阶段 1–4

- workspace 为 `apps/desktop`、`apps/agent`、`packages/protocol`；Rust 与桌面 app 共置于 `apps/desktop/src-tauri`。
- TS/Rust v1 协议、NDJSON codec、golden fixtures、Rust supervisor、Tauri Channel、Bun 探测与生命周期已完成。
- Bun 后端使用 AI SDK v7 `ToolLoopAgent`，支持 Anthropic/OpenAI-compatible provider、模型发现/cache、停止、标题生成、JSONL 持久化和异常恢复；MVP 全局只允许一个活动主 turn。
- 项目/任务 CRUD、项目 cwd、历史恢复、白色双栏外壳、Catppuccin Latte、Lexical、静态 Markdown transcript、增量侧栏和运行中只读任务切换均已完成。
- `session.title.updated` 独立事件即时更新标题；模型选择、最近模型和最近项目上下文均已持久化。
- WebdriverIO Tauri Service embedded provider 已接入；Win11 Mica 保留原生标题栏，透明只用于侧栏材质。

### 阶段 5：shell

- `apps/agent/src/shell.ts` 固定启动 `pwsh.exe -NoLogo -NonInteractive`，默认加载 Profile；短命令使用单层 UTF-16LE `-EncodedCommand`，长命令回退到受控 UTF-8 临时 `.ps1`。
- 环境设置 `TERM=dumb`、`NYAN_AGENT=1`、no-color 和 pager 变量；只在用户未设置时补 `PYTHONIOENCODING=utf-8`，不设置通用 `CI=1`。
- 同一个模型工具支持启动、`processId` poll/write/kill、stdin 和关闭 stdin；stdout/stderr 并发读取并按 UTF-8 字节预算保留头尾。
- 默认超时、turn 取消和 turn 收尾均清理进程树；Windows 使用 `taskkill /T /F`，真实孙进程延迟写文件测试确认没有遗留。

### 阶段 5：edit

- `apps/agent/src/edit.ts` 先统一 CRLF/LF，再按 exact、line-trimmed、indentation-flexible、whitespace-normalized、block-anchor 顺序匹配。
- 默认要求唯一匹配；`replaceAll` 只使用不重叠候选；block-anchor 始终要求唯一并通过中间内容相似度阈值。
- 模糊候选有行数和字符跨度比例保护；已有文件拒绝空 `oldText`，不存在文件仅允许空 `oldText` 创建。
- 只编辑 UTF-8 常规文件，保留 BOM、原换行风格和文件 mode；同文件 mutex 覆盖读/匹配/写，同目录临时文件 flush 后原子 rename。
- 返回策略、替换次数、增删行统计和有上限的实际 replacement diff。AI SDK 工具生命周期生成独立 nyan `toolExecutionId`，开始/完成写入 JSONL，桌面可实时显示并恢复 diff 卡片。

## 真实模型配置

- 本机配置文件：`C:\Users\Admin\.config\nyan\config.toml`，不属于仓库，也不要提交。
- 默认模型：`ark/minimax-m3`；Anthropic-compatible base URL 为 `https://ark.cn-beijing.volces.com/api/coding/v1`。
- 凭据使用 `auth_token_env = "ARK_TOKEN"`；配置文件只保存变量名。任何日志、文档和提交都不得记录 token 值。
- 模型 limits：`context_window = 1000000`、`max_output_tokens = 128000`。上下文窗口目前作为配置元数据保留；`maxOutputTokens` 已显式传给 AgentRunner。
- 已用真实 AgentRunner 流式请求验证，模型成功返回 `NYAN_OK`。尚未完成真实桌面 shell/edit 完整回合、停止和工具卡片交互验收。

## 配置与数据路径

- 用户配置：`~/.config/nyan/config.toml`，程序只读；凭据可直接写入，优先使用 `api_key_env`/`auth_token_env`。
- Windows 默认路径为 `~/.config/nyan`、`~/.local/share/nyan`、`~/.local/state/nyan`、`~/.cache/nyan`，不使用 `%APPDATA%`。
- `XDG_CONFIG_HOME`、`XDG_DATA_HOME`、`XDG_STATE_HOME`、`XDG_CACHE_HOME` 都是父目录覆盖，隔离测试必须四者一起设置。
- 数据布局：`projects.json`、`state.json`、`sessions/<uuid>/meta.json`、`sessions/<uuid>/transcript.jsonl`。

## E2E 与调试

- 稳定回归：`bun run e2e`；只构建用 `bun run e2e:build`，类型检查用 `bun run check:e2e`。首次运行先 `mise install`。
- E2E 专用 Rust/前端插件、权限和 global Tauri API 不进入普通 production bundle；测试临时目录结束后会清理。
- renderer 现场诊断使用 `bun run dev:inspect` 和 `chrome-cdp --browser tauri`；普通开发使用 `bun run dev`。
- `@wdio/native-utils` 固定为 `2.5.0`，避免 Tauri service `1.2.0` 与其旧版本导出不兼容。
- production bundle 仍有大于 500 KiB 的 Vite chunk warning，目前不阻塞 MVP。

## 最近验证

- `bun run check` 通过。
- `bun run test` 通过：protocol 7 项、agent 48 项、desktop 9 项、Rust 7 项。
- `bun run build`、`cargo fmt --check`、`git diff --check` 通过；production build 只有已知大 chunk warning。
- `bun run e2e` 通过：真实 Tauri/WebView2，1 个 spec、1 个测试。
- shell 测试覆盖中文/UTF-8、长命令、截断、轮询、超时、AbortSignal 和真实进程树清理。
- edit 测试覆盖五种实际 matcher、CRLF/BOM、新建、唯一性、`replaceAll`、跨度保护、并发 mutex、失败不写盘及 AI SDK/桌面集成。
- 真实 `ark/minimax-m3` AgentRunner 流式请求通过。

## 下一会话建议执行顺序

1. 检查 `git status`，按 [00-index.md](00-index.md) 顺序阅读产品、技术方案、状态和本文件。
2. 阅读锁定版本 `apps/agent/node_modules/ai/docs` 中 ToolLoopAgent 嵌套 agent、tool execute 的 `abortSignal` 和 lifecycle callback 文档，不凭记忆编写 AI SDK 代码。
3. 先实现可独立测试的 subagent runner/并发聚合，再注册主 agent 的第三个工具；subagent 工具集合只复用 shell/edit。
4. 增加 1–3 任务并发、部分失败、活动预览覆盖、step limit、输出上限和父取消级联测试，然后接入 JSONL/UI。
5. 运行根级 check/test/build/e2e，更新 [01-state.md](01-state.md) 并提交；不要提交本机 `config.toml`、密钥或真实会话数据。

## 新会话开场建议

工作区干净后，直接从“实现最多三个并行、阻塞聚合、不可递归且可级联取消的 subagent 工具”开始。无需重新实现 shell、edit、增量侧栏、运行态恢复、标题事件、环境变量凭据或 Mica。
