# MVP 技术方案（已审批）

状态：主要产品决策已对齐；实现细节以本文为当前基线。

## 1. 结论摘要

建议现在就改成 Bun workspace monorepo。原因不是“有三个语言就必须 monorepo”，而是前端和 Bun 后端需要共享协议类型、校验 schema、测试夹具和统一脚本；如果继续把根包同时当桌面前端和整个仓库，协议很快会出现复制。Rust 项目不参与 Bun workspace 依赖解析，只跟随桌面 app 放在其 `src-tauri` 目录。

建议目标结构：

```text
nyan-agent/
├─ apps/
│  ├─ desktop/                 # React + Vite + HeroUI + Lexical
│  │  ├─ src/
│  │  └─ src-tauri/            # Rust supervisor / Tauri commands / Win32 glue
│  └─ agent/                   # Bun + AI SDK agent 后端
│     └─ src/
├─ packages/
│  └─ protocol/                # 双端消息 TS 类型、schema、codec 测试向量
├─ .agents/docs/
├─ package.json                # private=true + workspaces + 聚合脚本
└─ bun.lock
```

第一阶段只建这三个 workspace，不提前拆 `agent-core`、`tools`、`ui` 等包。Rust 侧不能直接消费 TypeScript 类型；`protocol` 应提供机器可读 JSON Schema，Rust 在构建时生成/校验对应 serde 类型，或者先用共享 golden fixtures 保证两侧一致。MVP 更建议后者，工具链更少。

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

前端不直接连接 Bun，也不直接启动系统进程。Rust 是唯一的 Bun 进程 owner；这样应用退出、取消、崩溃恢复和未来 macOS process adapter 都有一个清晰边界。Tauri 官方将 Channel 定位为有序、高吞吐的流式 IPC，比全局 event 更适合 token/tool 事件流。

## 3. Bun workspace 与构建

根 `package.json` 建议：

- `workspaces: ["apps/*", "packages/*"]`
- 聚合 `dev`：先构建/监听协议，再启动 `apps/desktop` 的 Tauri dev。
- `check`：各 workspace typecheck + Rust `cargo check`。
- `test`：Bun 单测 + Rust 单测。
- `build:agent`：用 `bun build --target=bun` 产出单文件后端入口。
- `build:desktop`：Tauri build 前先构建 protocol、agent artifact、desktop frontend。

发布包把 agent artifact 作为 Tauri resource，而不是发布整棵 TypeScript 源码。运行时仍由用户全局 Bun 执行该 artifact。开发模式可直接运行 `apps/agent/src/main.ts`，但生产路径必须经过一次打包 smoke test。

采用 workspace 之后，AI SDK 只属于 `apps/agent`；HeroUI、Lexical、Lucide、React 只属于 `apps/desktop`；协议包不依赖 UI 或 AI SDK。

### 配置、数据、状态与缓存路径

Windows 不使用 `%APPDATA%`。路径解析采用以下优先级，并允许测试通过环境变量完全隔离真实用户目录：

| 类别 | 环境变量覆盖 | Windows 默认路径 | 内容 |
| --- | --- | --- | --- |
| config | `XDG_CONFIG_HOME` | `~/.config/nyan` | `config.toml` |
| data | `XDG_DATA_HOME` | `~/.local/share/nyan` | projects、sessions、transcript JSONL |
| state | `XDG_STATE_HOME` | `~/.local/state/nyan` | 最近模型、最近页面、UI 状态 |
| cache | `XDG_CACHE_HOME` | `~/.cache/nyan` | 动态模型列表 |

环境变量值是父目录，运行时再追加 `nyan`。测试优先设置这些变量到临时目录。不要提供第二套仅测试使用的路径算法。

`config.toml` 第一版建议：

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

静态 `models` 与动态发现结果取稳定去重后的并集。`provider id + model id` 构成 UI 和持久化中的稳定模型键。凭据可直接写 `api_key`/`auth_token`，也可用 `api_key_env`/`auth_token_env` 引用环境变量；同一凭据不得同时使用两种来源。兼容端点的未知模型可在 `model_limits` 中显式提供 `context_window` 与 `max_output_tokens`，避免 provider SDK 采用保守默认值。`config.toml` 由用户维护，程序读取但不自动重排或回写；最近选择写入 state 文件。

## 4. Rust supervisor

启动流程：

1. 应用 setup 阶段通过 `PATH` 解析 `bun`，可运行 `bun --version` 作为诊断，但不设置最低版本门槛。
2. 解析开发/生产 agent 入口的绝对路径。
3. 用 piped stdin/stdout/stderr 启动 Bun；Windows 下禁止额外控制台窗口。
4. 启动三个独立任务：stdout frame reader、stderr line reader、child exit watcher。
5. 完成 `initialize`/`initialized` 握手后才把后端标记为 ready。
6. 异常退出时终止当前 turn，向 UI 发送结构化 `backend.crashed`，MVP 只允许用户显式重启，不做无限自动拉起。
7. 应用退出时先发 `shutdown`，短暂等待后结束整个进程树，避免遗留 `pwsh`。

找不到或无法启动 Bun 时不创建 agent 子进程，前端进入专用错误页。错误页展示检测失败原因、手动安装说明和重新检测/重启入口；应用不下载或安装 Bun。

平台相关内容放进 `platform/windows.rs` 与抽象接口中：Bun 查找、无窗口启动、进程树终止、home/app-data 路径、窗口材质。未来 macOS 只需新增 adapter，不污染 agent 逻辑。

## 5. NDJSON 协议

### framing

- UTF-8；一条消息为一个 `JSON.stringify` 结果加 `\n`。
- reader 必须支持半帧、多帧同 chunk 和多字节 UTF-8 跨 chunk。
- 接受 `\n` 和 `\r\n`；忽略纯空行。
- 单帧上限先定为 16 MiB，按原始字节计；超限立即报协议错误并终止后端，避免继续错位。
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

命令带 `requestId`，turn 流带 `sessionId` 和 `turnId`，tool 事件再带 nyan 内部的 `toolExecutionId`。第一批消息建议包括：

- lifecycle：`initialize`、`initialized`、`shutdown`、`backend.error`
- command：`session.create`、`session.load`、`prompt.submit`、`turn.cancel`
- response：统一 `response`，包含 `requestId`、`ok`、`result` 或结构化 `error`
- product commands：`project.list`、`project.add`、`project.remove`、`project.context.set`、`model.list`、`session.list`、`session.create`、`session.load`、`session.model.set`、`session.remove`
- events：`session.title.updated`、`turn.started`、`assistant.text.delta`、`assistant.block.completed`、`reasoning.delta`、`tool.started`、`tool.output`、`tool.completed`、`subagent.activity`、`turn.completed`、`turn.failed`、`turn.cancelled`

### ID 格式

MVP 对 nyan 自己生成的领域 ID 统一使用无前缀的原始 UUIDv4。Bun 端通过 `crypto.randomUUID()` 生成，不引入 nanoid、ULID、UUIDv7 或自定义“时间戳 + 短 hash”方案：

| 领域 | 格式 |
| --- | --- |
| session | `<uuid-v4>` |
| turn | `<uuid-v4>` |
| request | `<uuid-v4>` |
| nyan 内部 tool execution | `<uuid-v4>` |
| subagent | `<uuid-v4>` |

- ID 是不透明标识，不从中解析时间或其他业务信息，也不向用户暴露可编辑语义。
- TypeScript 使用 `SessionId`、`TurnId`、`RequestId`、`ToolExecutionId`、`SubagentId` branded types，Rust 使用对应 newtype；不能因为底层都是 UUID 字符串就互相混用。
- 字段名和类型表达领域语义，字符串前缀不承担类型检查。协议、JSONL 和磁盘路径必须使用同一种原始 UUID 表示，不做添加/剥离前缀转换。
- session/turn 排序使用显式 `createdAt`；transcript 事件顺序使用单调递增的 `seq`，不能依赖 UUID 字符串排序。
- `toolExecutionId` 只用于 nyan 的 NDJSON 事件、UI、日志、取消和运行时追踪，不写入模型可见的 prompt、tool arguments 或 tool result，也不要求模型输出或复述它。
- AI SDK/provider 用于关联 tool call 与 tool result 的 `providerToolCallId` 是另一套标识，完全交给 AI SDK 按 provider 协议生成、保留和回传；nyan 不用自己的 `toolExecutionId` 替代或改写它。
- 运行时可以维护 `toolExecutionId ↔ providerToolCallId` 映射，但领域协议和模型消息必须保持两者语义分离。
- JSONL 目录名和协议字段使用同一个完整 session ID，例如 `sessions/550e8400-e29b-41d4-a716-446655440000/`。

不要把完整 shell 大输出反复塞进增量事件；UI 收到摘要，完整但已截断的 tool result 在完成事件中只发一次。真正的大 artifact 以后用路径/handle，不用 base64 进协议。

## 6. AI SDK agent harness

当前安装的是 AI SDK `7.0.31`。以该版本 `node_modules/ai/docs` 和 `src` 为准，采用 `ToolLoopAgent`，不要手写模型 tool-call 循环。

- `ToolLoopAgent.stream()` 驱动主 turn。
- 显式设置 `stopWhen`，不要无意识依赖当前默认 20 steps；初值建议 50，并在 UI 明确显示 step-limit 错误。
- 每个 turn 创建一个 `AbortController`；停止按钮、后端关闭和进程异常都触发同一信号。
- 通过 agent/tool lifecycle 回调产生领域事件，不把 AI SDK 的 UIMessage wire format直接暴露给 Rust/React，防止 SDK 升级牵动桌面协议。
- 历史恢复保存规范化的 model messages 与展示 transcript；两者分层，避免 UI 文本反推模型上下文。
- system prompt 分为稳定 base prompt、Windows/pwsh 工具指导、cwd/项目上下文、subagent 委派指导。

### provider 与模型发现

- 安装与 AI SDK 7 匹配的 `@ai-sdk/anthropic` 和 `@ai-sdk/openai-compatible`，实际版本在实施时以包管理器解析结果及 bundled docs 为准。
- Anthropic-compatible 通过 `createAnthropic({ baseURL, apiKey/authToken, headers, name })` 创建；OpenAI-compatible 通过 `createOpenAICompatible({ baseURL, apiKey, headers, name })` 创建。
- 这两个 provider factory 负责模型调用，不提供统一的 model-list API。动态发现由 nyan 自己按 provider kind 调用兼容端点，默认请求 `<baseURL>/models`，并允许 provider 配置覆盖 discovery URL/headers。
- cache 写入 `XDG_CACHE_HOME` 对应的 `nyan/models.json`，记录 provider id、拉取时间、过期时间和原始模型 id。默认 TTL 3600 秒；过期时优先后台刷新，失败则保留静态列表，并可显示已过期缓存而不是让模型选择器变空。
- 最近模型跨项目共享；若 provider/model 被删除，回退到 `default_model`，再回退到配置中第一个有效模型。
- 首条用户消息提交后并行发起一次同主模型的短标题调用，限制很小的输出预算；失败时回退为本地截断标题，不影响主 turn。

## 7. shell 工具

建议输入：

```ts
{
  command: string;
  cwd?: string;
  timeoutMs?: number;
  yieldTimeMs?: number;
  maxOutputBytes?: number;
}
```

MVP 仍应支持“命令尚未完成”的 handle，否则模型无法可靠处理 dev server、测试 watcher 或长构建。第一次调用在 `yieldTimeMs` 后返回 `{ status: "running", processId, output }`；后续通过同一个 shell 工具的 `processId` + 可选 stdin/poll 动作继续，而不是额外暴露第四个模型工具。工具数量在模型视角仍是三个。

实现要点：

- 只启动 PowerShell 7 的 `pwsh.exe`。将 UTF-8 初始化脚本与用户命令拼成一个脚本，整体按 UTF-16LE Base64 编码一次，再以 `pwsh.exe -NoLogo -NonInteractive -EncodedCommand <base64>` 启动；不要双层编码，默认不要添加 `-NoProfile`。
- 子进程创建前强制设置 `TERM=dumb`、`NYAN_AGENT=1`、`NO_COLOR=1`、空 `COLORTERM` 以及 `PAGER/GIT_PAGER/GH_PAGER=cat`。Profile 因而仍可先初始化 mise、pyenv 或必要环境，再通过 `if ($env:NYAN_AGENT -eq '1' -or $env:TERM -eq 'dumb') { return }` 跳过 PSReadLine、Starship、zoxide 等交互增强。
- `-NonInteractive` 只负责让 `Read-Host` 和确认提示失败，不能作为 Profile 内可靠可读的模式标志；不要依赖 `[Environment]::UserInteractive`、`$Host.Name` 或 console 重定向状态推断 agent shell。`NYAN_AGENT` 是精确标志，`TERM=dumb` 用于生态兼容。
- 不设置通用 `CI=1`，避免测试、包管理器和构建工具改变正常本地语义。Profile 的启动输出和错误按普通 shell 输出处理；后续若实测轻量 Profile 仍有明显开销，再单独评估按项目缓存环境快照，不在 MVP 首版提前引入。
- 初始化脚本同时设置无 BOM UTF-8 的 `[Console]::InputEncoding`、`[Console]::OutputEncoding` 和 `$OutputEncoding`；Bun 端用流式 UTF-8 decoder 读取 stdout/stderr。
- 子进程环境仅在用户未设置时补 `PYTHONIOENCODING=utf-8`，不得覆盖 `utf-8:surrogateescape` 等显式值。
- 不在包装器末尾无条件 `exit $LASTEXITCODE`，避免较早原生命令的陈旧退出码改变复合脚本语义；需要精确退出码时让调用命令显式 `exit`。
- cwd 必须规范化为绝对路径；缺省为当前 turn cwd。
- 初始 `maxOutputBytes` 建议 1 MiB，与当前 Codex unified exec 的量级一致，但只计算字节。
- 内存中保留前 50% 和后 50%，中间插入 `... omitted N bytes ...`；同时返回 `originalBytes`、`truncated`、`exitCode`、`durationMs`。
- stdout/stderr 分别并发读取以避免死锁，模型与 transcript 默认接收合并输出；内部事件保留 `stream` 字段以便诊断。普通 pipe 模式采用 Codex 风格的确定性聚合：stdout 后接 stderr，并在总预算竞争时为 stderr 保留更高份额；PTY/长会话则使用其天然的到达顺序合并流。
- 超时/取消终止整个进程树。
- 提示词明确 Windows 安全规则、`-LiteralPath`、递归删除前解析目标路径，以及优先 `rg`。
- 编码测试必须覆盖中文输出、中文路径、stdin 管道到 Python、Python 中文 stdout、中文 stderr、引号/多行、用户自定义 `PYTHONIOENCODING`、命令失败和 Base64 后的长命令边界。

## 8. edit 工具

建议输入：

```ts
{
  filePath: string;
  oldText: string;
  newText: string;
  replaceAll?: boolean;
}
```

精简匹配流水线：

1. 规范化请求的 CRLF/LF，但写回时保留原文件换行风格和 BOM。
2. exact match。
3. line-trimmed match：逐行 `trim()` 相等，并替换源文件中的真实 span。
4. indentation-flexible match：忽略公共缩进差异，保留真实 span。
5. whitespace-normalized match：把连续空白视为一个空格，仅在能映射到明确真实 span 时接受。
6. block-anchor fallback：至少三行，首尾行作为锚点，中间内容做相似度检查；只接受唯一且过阈值的候选。

暂不实现 OpenCode 的 escape-normalized、context-aware 等所有策略；先用测试证明上述六层覆盖常见模型偏差，再按失败样本增加。安全规则：

- 非 `replaceAll` 必须唯一；多个候选拒绝。
- `oldText === newText` 拒绝。
- 已有文件的空 `oldText` 拒绝；不存在的文件允许 `oldText: ""` 创建，并原子写入。
- 模糊匹配 span 若行数或字符数远大于输入，拒绝。
- 读、匹配、写在每文件 mutex 内完成；写入采用同目录临时文件 + rename，避免半写。
- 返回实际 diff、增删行数和使用的 match strategy，便于 transcript 展示与测试。

## 9. subagent 工具

AI SDK 7 已文档化“tool 的 execute 内调用另一个 `ToolLoopAgent.generate()`”的阻塞模式，并要求传递 `abortSignal`。在此基础上，主 agent 的工具输入建议为：

```ts
{
  tasks: Array<{
    id: string;
    prompt: string;
  }>;
}
```

- schema 限制 `tasks.length` 为 1–3，执行层再用并发 semaphore 固定上限 3。
- `Promise.allSettled` 等待全部结束；返回每项 `{ id, status, text | error }`，一个失败不丢失其他成功结果。
- subagent 用同模型配置和独立上下文，tools 只注入 shell/edit。
- 每个 subagent 继承 turn cwd 和父 `AbortSignal`，但有独立 step limit、过程事件命名空间和最终输出字节上限。
- tool result 给主模型的是各子任务最终结果；UI 不单列最终摘要，但主模型在所有任务 settle 前不能继续。
- UI 为每个 subagent 只保留一行最新活动：优先显示最新 tool call，其次 reasoning，再其次文本输出；新事件覆盖旧行，详细过程不展开。协议事件仍携带 agent id、kind 和截断后的 preview。
- harness 提醒主模型：任务要相互独立，写清可否修改、范围、交付格式，并避免让多个写 subagent 修改同一文件。

## 10. 持久化模型

Bun 后端拥有持久化，Rust 不维护业务数据。MVP 采用文件存储，不引入 SQLite：transcript 是天然 append-only 日志，每个 session 独立文件也避免了不必要的全局写锁，符合单用户和 YAGNI 约束。

建议布局：

```text
~/.local/share/nyan/
├─ projects.json
└─ sessions/
   └─ <session-id>/
      ├─ meta.json
      └─ transcript.jsonl
```

- `projects.json` 保存项目 id/name/path、排序和最近访问时间，采用临时文件 + fsync/close + rename 原子替换。
- `meta.json` 保存 session id、project id、cwd、标题、模型、状态和时间；列表页只读 metadata，不扫描完整 transcript。
- `transcript.jsonl` 每行是一条带 `schemaVersion`、`seq`、`turnId`、`kind`、payload 和时间戳的完整事件。只在完整 JSON 行准备好后 append。
- 进程启动时若末尾存在半行，截断到最后一个合法换行并把进行中的 turn 标为 `interrupted`；不因单条损坏丢弃整个会话。
- text/reasoning delta 不逐 token 落盘：内存中按 block 聚合，在 reasoning/tool/turn 边界写完整记录。这样同时支持非流式 Markdown 渲染和更干净的 JSONL。
- subagent 的详细过程 MVP 不单独持久化；主 transcript 记录开始、最新状态快照、完成/失败和返回主模型的 tool result。

SQLite 的优势是大量 session 的全局查询、复杂筛选、跨实体事务和多个 writer，但这些都不是当前 MVP 的硬需求。以后只有当启动扫描、搜索、迁移或并发写入出现实测瓶颈时再引入索引数据库；JSONL 仍可作为可移植的事实记录。

## 11. 前端状态与 UI

- MVP 仅实现白色主题；不设计深色 token、主题切换或跟随系统主题逻辑。
- 路由/选择状态：`new task`、`session/:id`；MVP 可用轻量自有 reducer，不必为两个页面引入大型状态库。
- server state 以 Rust/Bun 为准；前端只做投影缓存，收到有序 Channel 消息按 `seq` reduce。
- transcript 使用稳定 item ID。当前未闭合文本 block 以纯文本更新；在 reasoning、tool call 或 turn 结束边界收到 `assistant.block.completed` 后，用 `react-markdown + remark-gfm` 一次性渲染该静态 block，不解析半截 Markdown。
- Lexical 只注册 plain-text 必需插件；发送时取纯文本，空白输入不提交。
- 模型选择器读取合并后的模型目录；新任务创建和既有闲置任务切换时验证模型键，并写入跨项目共享的最近模型 state。任务运行中禁用且拒绝模型切换。
- HeroUI v3 使用 compound components、语义 variant 和 `onPress`；无需 `HeroUIProvider`。全局 CSS 先导入 Tailwind v4，再导入 `@heroui/styles`。
- 原生标题栏保持 `decorations: true`，只显示系统三按钮和标题。先做一个 window-effects spike：Tauri 的 Mica 要求透明窗口，且官方对 decorations/shadow 组合提示了平台注意事项。若原生标题栏下无法让目标区域获得一致 Mica，再评估自绘标题栏；不要一开始放弃原生按钮。
- 主窗口建议最小尺寸约 `960×640`，默认 `1200×800`；侧栏约 `260px`，可在后续增加折叠。
- 项目列表、无项目任务列表、每个项目的任务列表各自维护独立的可见数量：默认只取前 5 项；只要仍有隐藏条目就显示“展开显示”，每次点击将该列表的可见上限增加 10；只有全部条目都可见后才切换为“折叠显示”，点击折叠后将可见上限重置为 5。切换不改变持久化排序。
- 父级折叠事件同时充当其后代 UI 状态的递归 reset：单个项目文件夹折叠时重置自己的任务可见上限；“项目”分组折叠时重置项目列表可见上限、折叠所有项目文件夹，并重置每个项目的任务可见上限；“任务”分组折叠时重置无项目任务的可见上限。父级再次展开只读取已重置的初始状态，不缓存或恢复折叠前的后代展开状态；这些仍是前端瞬时状态，不写入持久化数据。
- 稳定桌面 E2E 使用 `@wdio/tauri-service` 的 embedded provider 驱动真实 Tauri/WebView2。WDIO Rust/前端插件、权限和 `withGlobalTauri` 只在测试专用构建配置启用；测试通过临时 XDG 父目录隔离真实用户数据。仓库用 mise 固定 Node 24，现场诊断仍使用 `dev:inspect` + CDP。

## 12. 取消、并发与故障语义

- MVP 全局同一时刻只运行一个主 turn，避免模型调用、文件修改和恢复状态互相竞争；用户可以切换到其他任务只读查看，但发送按钮禁用并提示当前运行任务。
- `prompt.submit` 先同步返回已接受和 `turnId`，后续结果都走 Channel。
- `turn.cancel` 幂等；已结束 turn 返回当前终态。
- 取消顺序：AbortController → subagents → shell 进程树 → 写入 `cancelled` → 发终态事件。
- edit 一旦进入原子 rename 临界区不强制中断，完成写入后再响应取消，避免文件损坏。
- Bun crash、非法 NDJSON、AI provider 错误、工具错误是不同 error code，UI 不用解析字符串判断。

## 13. 实施顺序

1. workspace 改造与空包边界；所有现有模板构建仍通过。
2. protocol + TS/Rust golden fixtures + NDJSON codec 测试。
3. Rust supervisor + Bun echo backend + Channel 垂直贯通。
4. 配置解析、provider factory、模型发现/cache、AI SDK 无工具 turn + 停止 + JSONL transcript。
5. 项目/任务 CRUD、目录选择和 cwd 规则。
6. shell 工具与进程/截断测试。
7. edit 工具与 matcher table-driven tests。
8. subagent 并发、阻塞、失败聚合和级联取消。
9. HeroUI/Lexical 页面、静态 Markdown block、初始 5 条且每次增量展开 10 条、Mica spike、交互打磨。
10. 崩溃恢复、打包资源、全新机器 Bun 检测与 Win11 安装 smoke test。

每一阶段都保持一个可运行的垂直切片，不先铺完整 UI 再接后端。

## 14. 已确认的关键决定

1. provider 为 Anthropic-compatible 与 OpenAI-compatible；配置写 `~/.config/nyan/config.toml`，凭据可直接写入或通过 `api_key_env`/`auth_token_env` 引用环境变量。
2. provider 可配置静态模型和动态发现；缓存 TTL 默认 1 小时；最近模型跨项目共享。
3. MVP 使用每 session 的 JSONL transcript 和小型 metadata/state 文件，不使用 SQLite。
4. 运行中可查看其他任务，但全局只运行一个主 turn；多主 agent 并行不进入 MVP。
5. shell 在 UI/模型侧合并展示 stdout/stderr，内部保留 stream 来源。
6. subagent UI 只显示状态和一行最新活动，不展示独立最终摘要；tool result 仍完整返回主模型。
7. 首条用户消息后额外调用同一个主模型生成标题，失败时本地截断回退。
8. 只检测全局 Bun，不限制最低版本、不自动安装；缺失时显示错误页和安装指引。
9. assistant Markdown 按完整 block 静态渲染，不做流式 Markdown parser。
10. session/turn/request/subagent/tool execution 等 nyan 内部领域 ID 使用无前缀的原始 UUIDv4，以 branded/newtype 区分类型；排序使用时间戳和 `seq`，内部 tool execution ID 不进入模型上下文。

## 15. 主要风险与验证点

- **Mica + 原生标题栏**：尽早用真实 Win11 目标版本验证透明、inactive、resize 和白色主题，不以浏览器预览代替。
- **全局 Bun 的 PATH**：GUI 进程继承的 PATH 可能与交互 shell 不同；需要错误页显示实际探测路径和 `bun --version` 结果。
- **兼容端点并不完全兼容**：模型发现 URL、鉴权 header 和响应 shape 可能不同；provider 配置需允许覆盖 discovery 参数，不能假设 AI SDK provider factory 会列模型。
- **Provider 密钥保护**：MVP 不接 Credential Manager；优先用 `api_key_env`/`auth_token_env` 引用环境变量，若用户选择 TOML 明文凭据则限制文件为当前用户可访问，并且日志、错误与 UI 永不回显完整 key。
- **PowerShell 编码与命令长度**：`-EncodedCommand` 解决转义和 Unicode，但 Base64 会放大命令；需要对 Windows 命令行长度做实测，超长脚本可回退到受控临时 `.ps1` 文件。
- **进程树清理**：只 kill `pwsh` 父进程可能遗留子进程；当前采用 Windows `taskkill /T /F` 等价方案，真实孙进程延迟写测试和安装版 app 退出 smoke 均确认没有遗留，后续仅在出现失败样本时再评估 Job Object。
- **AI SDK 升级频率**：所有 API 以锁定版本的 bundled docs/source 为准，升级单独做迁移，不让 wire protocol 依赖 SDK 内部类型。
- **模糊 edit 误改**：matcher 每层返回策略名、候选数量和真实 span；宁可拒绝也不猜测多匹配。
- **JSONL 恢复一致性**：用 seq、原子 metadata 更新和尾部半行恢复测试覆盖“UI 已显示但 block 尚未落盘”“进程在 append 中途崩溃”等情况。
