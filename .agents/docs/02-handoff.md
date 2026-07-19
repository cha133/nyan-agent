# 跨会话交接

状态：2026-07-19。阶段 1–3 已完成；阶段 4 已进入收尾，产品外壳、项目/任务数据层、增量侧栏、运行中只读切换、异步标题事件、真实 Tauri E2E 基础和 Win11 Mica 均已落地。阶段 5 的 shell/edit/subagent 尚未实现，但 shell 的 Profile/非交互启动策略已经确定。

## 新会话目标

继续 [01-state.md](01-state.md) 的阶段 4 收尾，不需要重新讨论已审批的 [03-product.md](03-product.md) 和 [04-technical-plan.md](04-technical-plan.md)：

1. 在真实桌面 UI 中用已配置的 `ark/minimax-m3` 验收完整回合、异步标题刷新、切换到其他任务的只读状态、返回活动任务和停止。
2. 扩展现有 WebdriverIO E2E，覆盖至少两个任务、活动 turn 切换、停止和标题更新；测试继续使用隔离 XDG 数据，不读取真实用户配置或密钥。
3. 完成阶段 4 交互验收后进入阶段 5，优先实现 shell，不要重复实现 Mica、侧栏分页或标题事件。

## 仓库现场

- 工作区：`C:\Dev\nyan-agent`；分支：`main`，跟踪 `origin/main`。
- 本轮功能提交：`063481a feat: refine sidebar and running task state`、`bc2d63e feat: support environment provider credentials`；本次交接提交完成后工作区应干净。
- 包管理器和 agent 运行时为 Bun，本机实测 `1.3.14`；WebdriverIO 通过根 `mise.toml` 固定 Node 24。
- Tauri `2.11.5`、AI SDK `7.0.31`、HeroUI `3.2.2`。
- 本次会话没有 push；是否推送由下一会话或用户决定。

## 当前实现

### 阶段 1–3

- workspace 为 `apps/desktop`、`apps/agent`、`packages/protocol`；Rust 与桌面 app 共置于 `apps/desktop/src-tauri`。
- TS/Rust v1 协议、NDJSON codec、golden fixtures、Rust supervisor、Tauri Channel、Bun 探测与生命周期已完成。
- Bun 后端使用 AI SDK v7 `ToolLoopAgent`，支持 Anthropic/OpenAI-compatible provider、模型发现/cache、停止、标题生成、JSONL 持久化和异常恢复。
- MVP 全局只允许一个活动主 turn。

### 阶段 4

- 项目/任务 CRUD、项目 cwd、历史恢复、白色双栏外壳、Catppuccin Latte 语义主题、Lexical 输入和静态 Markdown transcript 已完成。
- 项目、无项目任务和每个项目任务列表独立维护可见上限：初始 5 条，每次增加 10 条，全部显示后折叠；项目列表折叠会递归重置后代。
- 运行态可从 session `activeTurnId` 恢复；活动任务以外的页面只读并提示，活动任务显示停止按钮，后端崩溃会清理前端运行态。
- 协议新增 `session.title.updated`；标题调用不阻塞主 turn，完成后即时更新侧栏和标题栏。
- 模型选择、最近模型和最近项目上下文均已持久化；运行中禁止模型切换和破坏性 CRUD。
- WebdriverIO Tauri Service embedded provider 已接入，当前 smoke flow 覆盖后端 ready、外壳、命令桥和项目上下文刷新恢复。
- Win11 Mica 保留原生标题栏与系统三按钮，透明只用于侧栏材质，主内容保持不透明。

## 真实模型配置

- 本机配置文件：`C:\Users\Admin\.config\nyan\config.toml`，不属于仓库，也不要提交。
- 默认模型：`ark/minimax-m3`；Anthropic-compatible base URL 为 `https://ark.cn-beijing.volces.com/api/coding/v1`。
- 凭据使用 `auth_token_env = "ARK_TOKEN"`；配置文件只保存变量名。当前会话确认环境变量存在，任何日志、文档和提交都不得记录其值。
- 模型 limits：`context_window = 1000000`、`max_output_tokens = 128000`。上下文窗口目前作为配置元数据保留；`maxOutputTokens` 已显式传给 AgentRunner，避免 Anthropic SDK 对未知模型使用 4,096 默认值。
- 已用真实 AgentRunner 流式请求验证，模型成功返回 `NYAN_OK`。尚未完成真实桌面 UI 的完整回合/停止/标题交互验收。

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

## 阶段 5 shell 已定约束

- 使用 `pwsh.exe -NoLogo -NonInteractive -EncodedCommand ...`，默认加载 Profile，不添加 `-NoProfile`。
- 启动前设置 `TERM=dumb`、`NYAN_AGENT=1`、`NO_COLOR=1` 和无分页器环境；不设置通用 `CI=1`。
- UTF-8 初始化、合并输出、字节截断、长进程 handle、超时/取消和进程树清理按 [04-technical-plan.md](04-technical-plan.md) 实现。

## 最近验证

- `bun run check` 通过。
- `bun run test` 通过：protocol 7 项、agent 21 项、desktop 7 项、Rust 7 项。
- `bun run build`、`cargo fmt --check`、`git diff --check` 通过；production build 只有已知大 chunk warning。
- `bun run e2e` 通过：真实 Tauri/WebView2，1 个 spec、1 个测试。
- 真实 `ark/minimax-m3` AgentRunner 流式请求通过。

## 下一会话建议执行顺序

1. 检查 `git status`，按 [00-index.md](00-index.md) 顺序阅读产品、技术方案、状态和本文件。
2. 确认启动进程能继承 `ARK_TOKEN`，使用 `bun run dev:inspect` 完成真实桌面回合、标题、切换、停止和 console/errors 验收。
3. 设计不接触真实密钥的稳定 E2E provider stub，补任务切换、停止和标题更新回归。
4. 更新 [01-state.md](01-state.md) 并完成阶段 4 验收；随后开始 shell 工具。
5. 运行根级 check/test/build/e2e，提交原子 commit；不要提交本机 `config.toml`、密钥或真实会话数据。

## 新会话开场建议

工作区干净后，直接从“真实桌面完整回合验收 + 任务切换/停止/标题 E2E”开始。无需重新实现增量侧栏、运行态恢复、标题事件、环境变量凭据或 Mica。
