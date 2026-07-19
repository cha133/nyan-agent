# nyan-agent 工程指南

本文是仓库级长期约束。开始工作前先读本文；详细产品与架构见 [`docs/product.md`](docs/product.md)、[`docs/architecture.md`](docs/architecture.md)。若文档与用户最新明确指令冲突，以用户指令为准，并同步修正文档。

## 产品边界

- 产品是开发者本人使用的单用户 Windows 桌面 agent；只支持 Windows 11 26H1 及以上版本。
- 采用 YOLO 权限模型：模型与 subagent 对文件系统有完整读写能力，不实现 tool approval、sandbox、workspace 限制或多用户权限。
- 模型工具固定为 `shell`、`edit`、`subagent`。能可靠由 PowerShell 7 完成的能力不新增内置工具；MCP、skill、浏览器与附件输入不属于当前产品范围。
- 全局只允许运行一个主 agent turn。运行中可以切换查看其他任务，但不能并行启动第二个主 turn。
- UI 只实现白色主题；不做深色主题、主题切换、远程后端、登录同步、移动端或 macOS/Linux 构建。
- 文本流不做流式 Markdown 解析：未闭合 block 以纯文本预览，完整 block 再交给 Markdown renderer。

## 仓库与运行时边界

```text
apps/desktop/                  React + Vite + HeroUI + Lexical
  src-tauri/                   Rust/Tauri supervisor 与 Windows 平台胶水
apps/agent/                    Bun + AI SDK agent 后端
packages/protocol/             双端协议类型、NDJSON codec 与 fixtures
docs/                          长期产品与架构文档
.agents/docs/                  仅复杂需求的临时工作区（见 docs/README.md）
```

- 根目录是 Bun workspace；包管理器与后端运行时均为 Bun。不要用 npm/pnpm/yarn 改锁文件。
- React/WebView2 只通过 Tauri commands 和 Channel 与 Rust 通信，不能直接连接或启动 Bun。
- Rust 是 Bun 后端的唯一进程 owner，负责检测、启动、停止、crash/protocol-error 状态和进程树清理；AI SDK、工具、provider、session 逻辑留在 Bun 后端。
- Windows 相关逻辑集中在 `apps/desktop/src-tauri/src/platform/windows.rs` 等平台边界，不能散落到业务层。
- production 运行 `apps/agent/dist/main.js` 的 bundled resource；debug/E2E 可以运行源码入口。修改启动或构建路径时必须同时验证 production artifact。

## 常用命令

- `bun run check`：所有 TypeScript typecheck 与 Rust `cargo check`。
- `bun run test`：protocol、agent、desktop 与 Rust 测试。
- `bun run build`：protocol、agent artifact、desktop production build。
- `bun run e2e`：真实 Tauri/WebView2 的隔离桌面回归；根 `mise.toml` 固定 Node 24，首次使用先执行 `mise install`。
- `bun run dev`：普通 Tauri 开发。
- `bun run dev:inspect`：需要检查 renderer 或做真实桌面验收时使用；仅该子进程启用随机 CDP 端口。
- Rust 变更额外运行 `cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml`；所有改动运行 `git diff --check`。

不得用普通 `bun run dev` 代替需要 CDP 的流程。结束 `dev:inspect` 后停止父进程，并确认 Tauri、Vite、Bun 与工具子进程一起退出。

## 协议与进程不变量

- Rust↔Bun framing 固定为 UTF-8 NDJSON：一帧一个 JSON 加换行，支持半帧、多帧、跨 chunk UTF-8、`\n`/`\r\n` 和空行；原始单帧上限 16 MiB。
- Bun stdout **只能**写协议帧。日志、SDK warning、未捕获错误全部写 stderr；任何依赖的默认 console 输出都必须显式重定向或关闭。
- 所有 envelope 带 `v: 1` 与 `type`。命令用 `requestId`，turn 流用 `sessionId`/`turnId`，工具事件用 nyan 的 `toolExecutionId`。
- nyan 生成的 session、turn、request、tool execution、subagent ID 都是无前缀原始 UUIDv4；TS 使用 branded types，Rust 使用 newtypes。排序依赖 `createdAt` 与单调 `seq`，不能依赖 UUID。
- `toolExecutionId` 与 provider/AI SDK 的 tool-call ID 语义独立；前者不能进入模型 prompt、tool arguments 或 tool result。
- protocol error 与 process crash 是不同状态，不能让随后发生的受控 kill 把 `protocol_error` 覆盖为通用 crash。
- Windows 后端 generation 必须关联带 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 的独立 Job Object；正常退出、crash、取消和 app 关闭都不得遗留后代进程。

## Provider、配置与敏感信息

- 仅支持 Anthropic-compatible 和 OpenAI-compatible provider，分别使用 `@ai-sdk/anthropic` 与 `@ai-sdk/openai-compatible`。
- 用户配置为 `~/.config/nyan/config.toml`；程序只读，不自动重排或回写。最近模型写 state，动态模型写 cache。
- Windows 默认目录：config `~/.config/nyan`、data `~/.local/share/nyan`、state `~/.local/state/nyan`、cache `~/.cache/nyan`。`XDG_*_HOME` 表示父目录，运行时再追加 `nyan`。
- 测试必须用临时 XDG 父目录隔离真实配置和数据；自动化测试不得读取真实 API key、token 或 provider 配置。
- 凭据可以直接配置或通过 `api_key_env`/`auth_token_env` 引用环境变量，但日志、文档、fixture、截图和提交绝不能记录 token 值。
- AI SDK 版本以 `apps/agent/node_modules`/Bun 安装树中与 lockfile 匹配的 docs 和源码为准，不凭记忆使用 API。主 agent 使用 `ToolLoopAgent`，主 turn step 上限 50，subagent step 上限 30。

## 工具语义

### shell

- 固定启动全局 `pwsh.exe -NoLogo -NonInteractive`，默认加载用户 Profile；设置 `TERM=dumb`、`NYAN_AGENT=1` 与 no-color/pager 环境变量。
- 命令优先使用单层 UTF-16LE `-EncodedCommand` 传递 UTF-8 初始化脚本与用户命令；超过 Windows 安全命令行阈值时回退到受控 UTF-8 临时 `.ps1`。
- stdout/stderr 并发读取并按 UTF-8 字节预算保留头尾；支持 timeout、cancel、长进程 `processId` 的 poll/write/kill 与 stdin 关闭。
- 默认 timeout、turn cancel、turn 收尾和 app/backend 退出都必须终止完整进程树。
- agent 提示词要求搜索文本/文件时优先使用 `rg`。

### edit

- 单次调用描述一个文件的 `oldText → newText`；默认必须唯一匹配，`replaceAll` 只接受不重叠候选。
- matcher 顺序维持 exact、line-trimmed、indentation-flexible、whitespace-normalized、block-anchor；模糊匹配必须受跨度比例与相似度保护。
- 已有文件拒绝空 `oldText`；不存在文件只允许用空 `oldText` 新建。拒绝目录、非 UTF-8、无变化与提前取消。
- 每文件 mutex 覆盖读取、匹配、写入全过程；同目录临时文件 flush 后原子 rename，并保留 BOM、换行风格与 mode。

### subagent

- 一次调用接受 1–3 个互相独立的任务，并发上限 3；主 agent 阻塞直到全部 settle。
- subagent 使用同一模型与独立上下文，只能使用共享的 shell/edit，不能递归调用 subagent。
- 委派提示必须写清范围、预期结果、是否允许修改；不要让多个并行写任务修改同一文件。
- 单项失败不能丢失兄弟任务的成功结果；父 AbortSignal 必须级联到子模型和 shell 进程。
- UI 每个 subagent 只显示状态和一行最新活动；最终结果仍作为 tool result 返回主模型，不单独展开完整过程。

## 持久化与 UI 规则

- session metadata 原子写；transcript 使用 JSONL、单调 `seq`，展示 transcript 与规范化 model messages 分层保存。
- 恢复允许清理尾部半行或单条完整坏记录，同时保留之后的合法历史；运行中的 turn 恢复为 `interrupted`。
- 第一条用户消息提交后，用同一个主模型异步生成短标题，不能阻塞主 turn。
- 新任务 cwd：绑定项目使用项目目录；无项目使用用户家目录。最近项目上下文与项目行/任务分组加号的默认选择遵循 [`docs/product.md`](docs/product.md)。
- 侧栏列表初始显示 5 条，每次增加 10 条；全部显示后才出现折叠。折叠父级必须递归重置后代的可见数量和展开状态。
- transcript 中 assistant 完整 block 使用 `react-markdown + remark-gfm`；Lexical 编辑器只作为纯文本多行输入。
- React StrictMode 会重复执行 effect setup/cleanup。Tauri Channel 等不可取消订阅的外部副作用必须延迟到首轮 cleanup 之后，并在 handler 中设置失活保护，避免重复事件和 ghost callback。

## 测试与发布要求

- 协议改动必须同步 TS/Rust 类型或 fixture，并覆盖双端 golden/codec 行为。
- 工具改动至少覆盖真实进程/文件行为、取消与错误路径；不得用只返回假对象的测试替代关键边界。
- E2E 必须隔离真实 XDG 数据和 PATH；测试专用 Tauri plugin、global API、fault-agent 入口只允许进入 `e2e` feature/build。
- 当前桌面 E2E 顺序覆盖正常恢复、Bun 缺失→运行中重检、真实 crash、非法 NDJSON、后端进程树清理和非法配置。
- 发布前至少通过 `bun run check`、`bun run test`、`bun run build`、Rust fmt、`git diff --check` 与 `bun run e2e`。production Vite 的既有 >500 KiB chunk warning 当前不阻塞发布。
- NSIS/production smoke 必须确认安装版实际从 resource 启动 agent artifact，关闭 app 后 Bun 与后代进程退出。

## 开发观察与参考

- Tauri/WebView2 调试使用本机 `chrome-cdp` 技能并始终传 `--browser tauri`；目标从 `DevToolsActivePort` 自动发现。优先使用 compact accessibility snapshot、截图、console-watch 和 errors。
- 临时调试截图、CDP `shot` 输出等一次性产物默认写系统临时目录（Windows 上如 `$env:TEMP` / `%TEMP%`），不要放进仓库可跟踪路径。仅当必须用工作区相对路径时，才写到已 gitignore 的目录（例如 `.agents/tmp/`），且不得放进 `.agents/docs/` 或 `docs/`。
- 页面重载紧邻出现的 `Couldn't find callback id` 是旧 Tauri callback 的调试副作用；稳定后先清 console，再复现并判断，不能把历史 warning 当运行时故障。
- 本地参考仓库仅用于阅读比较，不能直接复制实现：`C:\Dev\codex`、`C:\Dev\ai`、`C:\Dev\heroui`、`C:\Dev\opencode`、`C:\Dev\nyan-agent-tui`。
- 实现或调整产品/架构范围后，同步更新 [`docs/`](docs/) 与本文。小需求不建临时文档；仅当开发者明确说是复杂/大型需求时，才按 [`docs/README.md`](docs/README.md) 在 `.agents/docs/` 建立临时工作文档，并在完成后沉淀再删除。
