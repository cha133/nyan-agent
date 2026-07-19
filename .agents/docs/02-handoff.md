# 跨会话交接

状态：2026-07-19。阶段 1–5 已完成，阶段 6 进行中。本轮完成首批恢复/故障语义加固、production agent artifact、NSIS 隔离安装运行，以及 Bun 缺失→重新检测真实桌面 E2E。下一主线是 crash/非法协议/配置错误的桌面故障注入和真实 provider 三工具综合验收。

## 新会话目标

继续 [01-state.md](01-state.md) 的阶段 6，不需要重新讨论已审批的 [03-product.md](03-product.md) 和 [04-technical-plan.md](04-technical-plan.md)：

1. 把 Bun 子进程 crash、非法 NDJSON、配置错误和恢复场景扩展到真实桌面 E2E，确保 UI 只消费结构化故障，不解析错误字符串。
2. 使用本机现有 provider 配置完成真实桌面 shell/edit/subagent 综合回合、长进程轮询和停止验收；自动化测试不得读取真实密钥。
3. 完成剩余 MVP 验收后，把 `.agents/docs` 中仍有效的约束沉淀为正式详细 `AGENTS.md`。

## 仓库现场

- 工作区：`C:\Dev\nyan-agent`；分支：`main`，跟踪 `origin/main`。
- 本轮恢复、故障语义、打包、安装和 E2E 改动以 `feat: harden recovery and release packaging` 提交；用户要求本轮提交但不要求 push。
- 包管理器和 agent 运行时为 Bun，本机实测 `1.3.14`；WebdriverIO 通过根 `mise.toml` 固定 Node 24。
- Tauri `2.11.5`、AI SDK `7.0.31`、HeroUI `3.2.2`。

## 当前实现

### 阶段 1–5

- workspace 为 `apps/desktop`、`apps/agent`、`packages/protocol`；Rust 与桌面 app 共置于 `apps/desktop/src-tauri`。
- TS/Rust v1 协议、NDJSON codec、Rust supervisor、Tauri Channel、Bun 探测与生命周期已完成。
- Bun 后端使用 AI SDK v7 `ToolLoopAgent`，支持 Anthropic/OpenAI-compatible provider、模型发现/cache、停止、标题、JSONL 持久化和异常恢复；全局只允许一个活动主 turn。
- 项目/任务 CRUD、项目 cwd、白色双栏外壳、Catppuccin Latte、Lexical、静态 Markdown transcript、增量侧栏、运行中只读切换、模型/项目最近状态均已完成。
- shell 固定 PowerShell 7，支持 UTF-8、长命令回退、长进程 poll/write/kill、超时/取消和进程树清理。
- edit 支持 exact、line-trimmed、indentation-flexible、whitespace-normalized、block-anchor，多匹配拒绝、跨度保护、原子写和 diff。
- subagent 一次并发 1–3 项，只有 shell/edit，阻塞聚合、兄弟失败隔离、父取消级联；UI 每项只展示一行最新活动。

### 阶段 6：恢复与结构化故障

- `SessionStore.recover()` 除截断尾部半行外，还会逐行验证 UTF-8、record shape 和单调 seq；单条完整坏记录通过原子重写清理，坏记录前后的合法历史继续保留。
- Rust supervisor 新增独立 `protocol_error` 状态。非法 backend stdout 会发结构化 `backend.error`、终止 Bun，并保持协议错误，不再被随后发生的受控退出覆盖成通用 crash。
- 真正的 Bun 意外退出仍是独立 `backend.crashed`；现有真实 Bun kill 集成测试继续覆盖。
- Tauri command rejection 保留 `{ code, message, details }`；桌面 `backendState.ts` 直接投影 protocol error/crash，并按结构化 command error 格式化 UI，不解析字符串获取错误类别。

### 阶段 6：production artifact 与安装

- `bun run build:agent` 生成 `apps/agent/dist/main.js` 后立即运行 `scripts/smoke-agent-artifact.ts`，在四套隔离 XDG 父目录中验证 bundled artifact 的 `initialize → shutdown`。
- debug 和 E2E 构建继续使用 `apps/agent/src/main.ts`；release 使用 Tauri `$RESOURCE/agent/main.js`。
- `tauri.conf.json` 将 `../../agent/dist/main.js` 映射到 `agent/main.js`，Tauri production build 也会先构建并 smoke artifact。
- `tauri build --no-bundle` release 分支通过；Win11 x64 NSIS 已生成并确认清单包含 `nyan-agent.exe` 与 `agent/main.js`。
- 安装包：`apps/desktop/src-tauri/target/release/bundle/nsis/nyan-agent_0.1.0_x64-setup.exe`，2,644,393 bytes，SHA-256 `5E1EC52412739BF985C59B54E6C69CA4981D3208070029D440905E60810101FD`。
- 仓库 target 下完成隔离静默安装/运行/卸载：安装版实际以安装目录 artifact 启动全局 Bun；关闭窗口后 Bun 子进程退出；uninstaller 返回 0；测试目录已清理。

## E2E 与调试

- 稳定回归：`bun run e2e`；只构建用 `bun run e2e:build`，类型检查用 `bun run check:e2e`。首次运行先执行 `mise install`。
- E2E 使用 WebdriverIO Tauri Service `embedded` provider 驱动真实 Tauri/WebView2；测试专用 Rust/前端插件、权限和 global Tauri API 不进入 production bundle。
- `bun run e2e` 现在顺序启动两次真实 app：第一轮覆盖 ready、产品外壳、Tauri command bridge 和项目上下文刷新恢复；第二轮以隔离 PATH 验证 Bun unavailable，运行中把当前 Bun 硬链接进测试 bin 后点击“重新检测”，同一 app 恢复 ready。
- E2E 临时 XDG、项目和 fake Bun bin 在结束后清理，不读取真实配置或凭据。
- renderer 现场诊断继续使用 `bun run dev:inspect` 和 `chrome-cdp --browser tauri`；普通开发使用 `bun run dev`。
- `@wdio/native-utils` 固定为 `2.5.0`；production bundle 的大于 500 KiB Vite chunk warning 当前不阻塞 MVP。

## 真实模型配置

- 本机配置：`C:\Users\Admin\.config\nyan\config.toml`，不属于仓库，绝不能提交。
- 默认模型：`ark/minimax-m3`；Anthropic-compatible base URL 为 `https://ark.cn-beijing.volces.com/api/coding/v1`。
- 凭据使用 `auth_token_env = "ARK_TOKEN"`；配置只保存环境变量名。日志、文档和提交不得记录 token 值。
- limits：`context_window = 1000000`、`max_output_tokens = 128000`；`maxOutputTokens` 已显式传给 AgentRunner。
- 真实 AgentRunner 流式请求已返回 `NYAN_OK`；尚未完成真实桌面 shell/edit/subagent、长进程轮询、停止和工具卡片综合验收。

## 配置与数据路径

- 用户配置：`~/.config/nyan/config.toml`，程序只读；凭据优先使用环境变量引用。
- Windows 默认路径：`~/.config/nyan`、`~/.local/share/nyan`、`~/.local/state/nyan`、`~/.cache/nyan`，不使用 `%APPDATA%`。
- `XDG_CONFIG_HOME`、`XDG_DATA_HOME`、`XDG_STATE_HOME`、`XDG_CACHE_HOME` 都是父目录覆盖，隔离测试必须四者一起设置。
- 数据布局：`projects.json`、`state.json`、`sessions/<uuid>/meta.json`、`sessions/<uuid>/transcript.jsonl`。

## 最近验证

- `bun run check` 通过。
- `bun run test` 通过：protocol 7 项、agent 53 项、desktop 12 项、Rust 10 项。
- `bun run build` 通过并包含 production agent artifact smoke；desktop production build 只有既有大 chunk warning。
- `cargo fmt --check`、`git diff --check` 通过。
- `tauri build --no-bundle` release 通过；NSIS 构建、资源清单、隔离安装/运行/卸载通过。
- `bun run e2e` 通过：同一 spec 顺序覆盖正常恢复和 Bun 缺失→重新检测两次真实 app 运行。
- shell 真实孙进程清理、app 关闭后的 Bun 子进程清理均已验证。

## 下一会话建议执行顺序

1. 检查 `git status`，按 [00-index.md](00-index.md) 顺序阅读产品、技术方案、状态和本文件。
2. 设计测试专用 fault-injector 入口或 supervisor 注入点，把 crash、非法 NDJSON、配置错误和恢复场景带到真实桌面 E2E；不要让测试开关进入 production bundle。
3. 用真实 provider 在桌面创建隔离测试项目，依次验收 shell、edit、subagent、长进程 poll 和停止，完成后清理测试文件与会话；不得输出或持久化 token。
4. 每个阶段 6 切片完成后运行根级 check/test/build/e2e 并更新 [01-state.md](01-state.md)。
5. MVP 验收完成后，将临时文档沉淀为正式详细 `AGENTS.md`。

## 新会话开场建议

工作区干净后，直接从“为真实桌面 E2E 增加 crash/非法协议/配置错误 fault injection”开始。production artifact、NSIS、Bun 缺失→重新检测、JSONL 坏行恢复和结构化错误链路已经完成，不要重复实现。
