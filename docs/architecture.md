# 架构说明

本文描述当前已实现的技术架构与关键决策。agent 日常约束见根 [`AGENTS.md`](../AGENTS.md)；产品范围见 [`product.md`](product.md)。

## 1. 仓库结构

仓库是 Bun workspace monorepo：前端与 Bun 后端共享协议类型、测试夹具和统一脚本。Rust 不参与 Bun workspace 依赖解析，跟随桌面 app 放在 `src-tauri`。

```text
nyan-agent/
├─ apps/
│  ├─ desktop/                 # React + Vite + HeroUI + Lexical
│  │  ├─ src/
│  │  └─ src-tauri/            # Rust supervisor / Tauri commands / Win32 glue
│  └─ agent/                   # Bun + AI SDK agent 后端
│     └─ src/
├─ packages/
│  └─ protocol/                # 双端消息 TS 类型、codec、golden fixtures
├─ docs/                       # 长期产品与架构文档
├─ .agents/docs/               # 仅复杂需求的临时工作区（见 docs/README.md）
├─ package.json                # private=true + workspaces + 聚合脚本
└─ bun.lock
```

当前三个 workspace 为 `apps/desktop`、`apps/agent`、`packages/protocol`，不提前拆 `agent-core`、`tools`、`ui`。Rust 不能直接消费 TypeScript 类型；两侧用共享 golden fixtures 保证协议一致。

## 2. 运行时边界

```text
React/WebView2
  ├─ invoke：短命令（项目/任务 CRUD、提交、取消、选择目录）
  └─ Tauri Channel：有序 turn 事件流
          │
Rust/Tauri supervisor
  ├─ 窗口、系统目录选择、应用生命周期
  ├─ 检测/启动/停止 Bun agent
  ├─ NDJSON 编解码、请求关联、stderr 日志
  └─ 将 Bun 事件映射到 Channel
          │ stdin/stdout (NDJSON) + stderr (log)
Bun agent
  ├─ 会话与 turn 编排
  ├─ AI SDK ToolLoopAgent
  ├─ shell / edit / subagent
  └─ provider/model 配置、JSONL 会话持久化
```

前端不直接连接 Bun，也不直接启动系统进程。Rust 是唯一的 Bun 进程 owner。Tauri Channel 承载有序、高吞吐的 token/tool 事件流。

## 3. Bun workspace 与构建

根 `package.json`：

- `workspaces: ["apps/*", "packages/*"]`
- `dev`：构建/监听协议，再启动 `apps/desktop` 的 Tauri dev。
- `check`：各 workspace typecheck + Rust `cargo check`。
- `test`：Bun 单测 + Rust 单测。
- `build:agent`：用 `bun build --target=bun` 产出单文件后端入口。
- `build:desktop`：Tauri build 前先构建 protocol、agent artifact、desktop frontend。

发布包把 agent artifact 作为 Tauri resource。运行时由用户全局 Bun 执行该 artifact。开发模式可直接运行 `apps/agent/src/main.ts`；生产路径必须经过打包 smoke。

AI SDK 只属于 `apps/agent`；HeroUI、Lexical、Lucide、React 只属于 `apps/desktop`；协议包不依赖 UI 或 AI SDK。

### 配置、数据、状态与缓存路径

Windows 不使用 `%APPDATA%`。路径解析允许测试通过环境变量隔离真实用户目录：

| 类别 | 环境变量覆盖 | Windows 默认路径 | 内容 |
| --- | --- | --- | --- |
| config | `XDG_CONFIG_HOME` | `~/.config/nyan` | `config.toml` |
| data | `XDG_DATA_HOME` | `~/.local/share/nyan` | projects、sessions、transcript JSONL |
| state | `XDG_STATE_HOME` | `~/.local/state/nyan` | 最近模型、最近页面、UI 状态 |
| cache | `XDG_CACHE_HOME` | `~/.cache/nyan` | 动态模型列表 |

环境变量值是父目录，运行时再追加 `nyan`。测试设置这些变量到临时目录；不提供第二套仅测试使用的路径算法。

示例 `config.toml`：

```toml
version = 1
default_model = "openai-main/gpt-example"
model_cache_ttl_seconds = 3600

[[providers]]
id = "openai-main"
kind = "openai-compatible"
base_url = "https://example.com/v1"
api_key = "..."
models = ["gpt-example"]
discover_models = true

[[providers]]
id = "anthropic-main"
kind = "anthropic-compatible"
base_url = "https://example.com/v1"
auth_token_env = "ANTHROPIC_TOKEN"
models = ["claude-example"]
discover_models = false
```

静态 `models` 与动态发现结果取稳定去重后的并集。`provider id + model id` 构成 UI 和持久化中的稳定模型键。凭据可直接写 `api_key`/`auth_token`，也可用 `api_key_env`/`auth_token_env` 引用环境变量；同一凭据不得同时使用两种来源。兼容端点的未知模型可在 `model_limits` 中显式提供 `context_window` 与 `max_output_tokens`。`config.toml` 由用户维护，程序只读；最近选择写入 state 文件。

## 4. Rust supervisor

启动流程：

1. 应用 setup 阶段通过 `PATH` 解析 `bun`，可运行 `bun --version` 作为诊断，但不设置最低版本门槛。
2. 解析开发/生产 agent 入口的绝对路径。
3. 用 piped stdin/stdout/stderr 启动 Bun；Windows 下禁止额外控制台窗口。
4. 启动三个独立任务：stdout frame reader、stderr line reader、child exit watcher。
5. 完成 `initialize`/`initialized` 握手后才把后端标记为 ready。
6. 异常退出时终止当前 turn，向 UI 发送结构化 `backend.crashed`；只允许用户显式重启，不做无限自动拉起。
7. Bun 启动后立即关联启用 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 的独立 Windows Job Object；应用退出时先发 `shutdown`，短暂等待后结束 backend generation 并关闭 job handle，确保 Bun 自身 crash、受控 kill 或正常关闭均不遗留其后代进程。

找不到或无法启动 Bun 时不创建 agent 子进程，前端进入专用错误页。错误页展示检测失败原因、手动安装说明和重新检测/重启入口；应用不下载或安装 Bun。

平台相关内容放在 `platform/windows.rs` 与抽象接口中：Bun 查找、无窗口启动、进程树终止、home/app-data 路径、窗口材质。

## 5. NDJSON 协议

### framing

- UTF-8；一条消息为一个 `JSON.stringify` 结果加 `\n`。
- reader 支持半帧、多帧同 chunk 和多字节 UTF-8 跨 chunk。
- 接受 `\n` 和 `\r\n`；忽略纯空行。
- 单帧上限 16 MiB，按原始字节计；超限立即报协议错误并终止后端。
- EOF 时若存在非空残帧，报告 `unexpected_eof`。
- 写端处理 backpressure；stdout 严禁日志，stderr 不参与协议解析。

### envelope

所有消息都有：

```ts
type Envelope = {
  v: 1;
  type: string;
};
```

命令带 `requestId`，turn 流带 `sessionId` 和 `turnId`，tool 事件再带 nyan 内部的 `toolExecutionId`。消息包括：

- lifecycle：`initialize`、`initialized`、`shutdown`、`backend.error`
- command：`session.create`、`session.load`、`prompt.submit`、`turn.cancel`
- response：统一 `response`，包含 `requestId`、`ok`、`result` 或结构化 `error`
- product commands：`project.list`、`project.add`、`project.remove`、`project.context.set`、`model.list`、`session.list`、`session.create`、`session.load`、`session.model.set`、`session.remove`
- events：`session.title.updated`、`turn.started`、`assistant.text.delta`、`assistant.block.completed`、`reasoning.delta`、`tool.started`、`tool.output`、`tool.completed`、`subagent.activity`、`turn.completed`、`turn.failed`、`turn.cancelled`

### ID 格式

nyan 自己生成的领域 ID 统一使用无前缀的原始 UUIDv4。Bun 端通过 `crypto.randomUUID()` 生成。

| 领域 | 格式 |
| --- | --- |
| session | `<uuid-v4>` |
| turn | `<uuid-v4>` |
| request | `<uuid-v4>` |
| nyan 内部 tool execution | `<uuid-v4>` |
| subagent | `<uuid-v4>` |

- ID 是不透明标识，不从中解析时间或其他业务信息。
- TypeScript 使用 branded types，Rust 使用对应 newtype；不能因为底层都是 UUID 字符串就互相混用。
- 字段名和类型表达领域语义；协议、JSONL 和磁盘路径使用同一种原始 UUID 表示。
- session/turn 排序使用显式 `createdAt`；transcript 事件顺序使用单调递增的 `seq`。
- `toolExecutionId` 只用于 nyan 的 NDJSON 事件、UI、日志、取消和运行时追踪，不写入模型可见的 prompt、tool arguments 或 tool result。
- AI SDK/provider 的 `providerToolCallId` 是另一套标识；运行时可以维护映射，但领域协议和模型消息必须保持两者语义分离。

不要把完整 shell 大输出反复塞进增量事件；UI 收到摘要，完整但已截断的 tool result 在完成事件中只发一次。

## 6. AI SDK agent harness

以安装树中与 lockfile 匹配的 AI SDK docs/source 为准，采用 `ToolLoopAgent`，不手写模型 tool-call 循环。

- `ToolLoopAgent.stream()` 驱动主 turn。
- 显式设置 `stopWhen`：主 turn step 上限 50，subagent step 上限 30；UI 明确显示 step-limit 错误。
- 每个 turn 创建一个 `AbortController`；停止按钮、后端关闭和进程异常都触发同一信号。
- 通过 agent/tool lifecycle 回调产生领域事件，不把 AI SDK 的 UIMessage wire format 直接暴露给 Rust/React。
- 历史恢复保存规范化的 model messages 与展示 transcript；两者分层。
- system prompt 分为稳定 base prompt、Windows/pwsh 工具指导、cwd/项目上下文、subagent 委派指导。
- AI SDK warning 等默认 console 输出必须显式重定向或关闭，避免污染 Bun stdout。

### provider 与模型发现

- Anthropic-compatible 通过 `createAnthropic({ baseURL, apiKey/authToken, headers, name })` 创建；OpenAI-compatible 通过 `createOpenAICompatible({ baseURL, apiKey, headers, name })` 创建。
- 动态发现由 nyan 按 provider kind 调用兼容端点，默认请求 `<baseURL>/models`，并允许覆盖 discovery URL/headers。
- cache 写入 `XDG_CACHE_HOME` 对应的 `nyan/models.json`；默认 TTL 3600 秒；过期时优先后台刷新，失败则保留静态列表或已过期缓存。
- 最近模型跨项目共享；若 provider/model 被删除，回退到 `default_model`，再回退到配置中第一个有效模型。
- 首条用户消息提交后并行发起一次同主模型的短标题调用；失败时回退为本地截断标题，不影响主 turn。

## 7. shell 工具

输入：

```ts
{
  command: string;
  cwd?: string;
  timeoutMs?: number;
  yieldTimeMs?: number;
  maxOutputBytes?: number;
}
```

第一次调用在 `yieldTimeMs` 后可返回 `{ status: "running", processId, output }`；后续通过同一个 shell 工具的 `processId` + 可选 stdin/poll/kill 动作继续。工具数量在模型视角仍是三个。

实现要点：

- 只启动 PowerShell 7 的 `pwsh.exe`。短命令使用单层 UTF-16LE `-EncodedCommand`；超过 Windows 安全命令行阈值时回退到受控 UTF-8 临时 `.ps1`。默认不添加 `-NoProfile`。
- 子进程创建前强制设置 `TERM=dumb`、`NYAN_AGENT=1`、`NO_COLOR=1`、空 `COLORTERM` 以及 `PAGER/GIT_PAGER/GH_PAGER=cat`。
- `-NonInteractive` 只负责让输入提示失败；`NYAN_AGENT` 是精确标志，`TERM=dumb` 用于生态兼容。
- 不设置通用 `CI=1`。
- 初始化脚本设置无 BOM UTF-8 的控制台编码；Bun 端用流式 UTF-8 decoder 读取 stdout/stderr。
- 子进程环境仅在用户未设置时补 `PYTHONIOENCODING=utf-8`。
- cwd 必须规范化为绝对路径；缺省为当前 turn cwd。
- `maxOutputBytes` 默认约 1 MiB；内存中保留前 50% 和后 50%，中间插入省略标记。
- stdout/stderr 并发读取；模型与 transcript 默认接收合并输出，内部事件保留 `stream` 字段；总预算竞争时为 stderr 保留更高份额。
- 超时/取消用 `taskkill /T /F` 终止整个命令进程树。
- 提示词明确 Windows 安全规则、`-LiteralPath`、以及优先 `rg`。

## 8. edit 工具

输入：

```ts
{
  filePath: string;
  oldText: string;
  newText: string;
  replaceAll?: boolean;
}
```

匹配流水线：

1. 规范化请求的 CRLF/LF，但写回时保留原文件换行风格和 BOM。
2. exact match。
3. line-trimmed match。
4. indentation-flexible match。
5. whitespace-normalized match。
6. block-anchor fallback：至少三行，首尾行作为锚点，中间内容做相似度检查；只接受唯一且过阈值的候选。

安全规则：

- 非 `replaceAll` 必须唯一；多个候选拒绝。`replaceAll` 只接受不重叠候选。
- `oldText === newText` 拒绝。
- 已有文件的空 `oldText` 拒绝；不存在的文件允许 `oldText: ""` 创建。
- 模糊匹配 span 若行数或字符数远大于输入，拒绝。
- 读、匹配、写在每文件 mutex 内完成；写入采用同目录临时文件 flush 后 rename。
- 返回实际 diff、增删行数和使用的 match strategy。

## 9. subagent 工具

主 agent 在 tool execute 内调用另一个 `ToolLoopAgent.generate()`，并传递 `abortSignal`：

```ts
{
  tasks: Array<{
    id: string;
    prompt: string;
  }>;
}
```

- schema 限制 `tasks.length` 为 1–3，执行层并发上限 3。
- `Promise.allSettled` 等待全部结束；一项失败不丢失其他成功结果。
- subagent 用同模型配置和独立上下文，tools 只注入 shell/edit。
- 每个 subagent 继承 turn cwd 和父 `AbortSignal`，有独立 step limit 和最终输出字节上限。
- UI 为每个 subagent 只保留一行最新活动；详细过程不展开。tool result 仍完整返回主模型。
- harness 提醒主模型：任务要相互独立，写清可否修改、范围、交付格式，并避免多个写 subagent 修改同一文件。

## 10. 持久化模型

Bun 后端拥有持久化，Rust 不维护业务数据。采用文件存储，不引入 SQLite：

```text
~/.local/share/nyan/
├─ projects.json
└─ sessions/
   └─ <session-id>/
      ├─ meta.json
      └─ transcript.jsonl
```

- `projects.json` 保存项目 id/name/path、排序和最近访问时间，采用临时文件 + rename 原子替换。
- `meta.json` 保存 session id、project id、cwd、标题、模型、状态和时间；列表页只读 metadata。
- `transcript.jsonl` 每行是一条带 `schemaVersion`、`seq`、`turnId`、`kind`、payload 和时间戳的完整事件。
- 恢复允许清理尾部半行或单条完整坏记录，同时保留之后的合法历史；运行中的 turn 恢复为 `interrupted`。
- text/reasoning delta 不逐 token 落盘：内存中按 block 聚合，在边界写完整记录。
- subagent 详细过程不单独持久化；主 transcript 记录开始、最新状态快照、完成/失败和返回主模型的 tool result。

## 11. 前端状态与 UI

- 仅实现白色主题（Catppuccin Latte）。
- 路由/选择状态：`new task`、`session/:id`；轻量自有 reducer。
- server state 以 Rust/Bun 为准；前端只做投影缓存，按 Channel `seq` reduce。
- transcript 使用稳定 item ID。未闭合文本 block 以纯文本更新；收到 `assistant.block.completed` 后用 `react-markdown + remark-gfm` 静态渲染。
- Lexical 只注册 plain-text 必需插件；发送时取纯文本。
- 模型选择器读取合并后的模型目录；新任务和闲置任务可切换模型并写入共享最近模型 state；运行中禁止切换。
- HeroUI v3 使用 compound components、语义 variant 和 `onPress`。
- 自绘标题栏 `decorations: false`（高 36px 独立顶栏，brand 在左侧）；窗口启用透明 WebView 与 Mica，侧栏透出材质，主内容在标题栏下方起排并保留向左投影（可渗入标题栏条带）。最大化按钮经 HTMAXBUTTON overlay 保留 Win11 Snap Layout；caption 图标使用 Segoe Fluent Icons。
- 主窗口默认 `1200×800`，最小约 `960×640`；侧栏约 `260px`。
- 各列表独立可见上限：初始 5 条，每次展开 +10，全部显示后才提供折叠；父级折叠递归重置后代。
- React StrictMode 会重复执行 effect setup/cleanup。Tauri Channel 等不可取消订阅的外部副作用必须延迟到首轮 cleanup 之后，并在 handler 中设置失活保护。
- 稳定桌面 E2E 使用 `@wdio/tauri-service` embedded provider；WDIO 插件与 `withGlobalTauri` 只在 `e2e` 构建启用；临时 XDG 隔离真实用户数据；仓库用 mise 固定 Node 24。现场诊断使用 `dev:inspect` + CDP。

## 12. 取消、并发与故障语义

- 全局同一时刻只运行一个主 turn；用户可切换到其他任务只读查看，但发送按钮禁用并提示当前运行任务。
- `prompt.submit` 先同步返回已接受和 `turnId`，后续结果走 Channel。
- `turn.cancel` 幂等；已结束 turn 返回当前终态。
- 取消顺序：AbortController → subagents → shell 进程树 → 写入 `cancelled` → 发终态事件。
- edit 一旦进入原子 rename 临界区不强制中断，完成写入后再响应取消。
- Bun crash、非法 NDJSON（`protocol_error`）、AI provider 错误、工具错误是不同 error code；受控 kill 不能把 `protocol_error` 覆盖为通用 crash。

## 13. 关键决定摘要

1. provider 为 Anthropic-compatible 与 OpenAI-compatible；配置写 `~/.config/nyan/config.toml`，凭据可直接写入或通过环境变量引用。
2. provider 可配置静态模型和动态发现；缓存 TTL 默认 1 小时；最近模型跨项目共享。
3. 每 session 的 JSONL transcript 和小型 metadata/state 文件，不使用 SQLite。
4. 运行中可查看其他任务，但全局只运行一个主 turn。
5. shell 在 UI/模型侧合并展示 stdout/stderr，内部保留 stream 来源。
6. subagent UI 只显示状态和一行最新活动；tool result 仍完整返回主模型。
7. 首条用户消息后用同一个主模型生成标题，失败时本地截断回退。
8. 只检测全局 Bun，不限制最低版本、不自动安装；缺失时显示错误页。
9. assistant Markdown 按完整 block 静态渲染。
10. nyan 内部领域 ID 使用无前缀原始 UUIDv4；排序使用时间戳和 `seq`；内部 tool execution ID 不进入模型上下文。
