# MVP 当前状态

最后更新：2026-07-19

## 已完成

- [x] 用 Tauri 2 模板初始化 React/Vite 工程。
- [x] 安装 Tailwind CSS v4、HeroUI v3、AI SDK v7、Lexical、Lucide React。
- [x] 明确 MVP 的平台、单用户、三个工具、Bun 后端、NDJSON 和基础 GUI 范围。
- [x] 建立 MVP 临时文档集与简版 `AGENTS.md`。
- [x] 写出第一版技术方案，等待关键细节对齐。
- [x] 对齐 provider/model 配置、JSONL 会话存储、非流式 Markdown、侧栏折叠、subagent 展示和 Bun 缺失体验。
- [x] 用户审批 MVP 产品约束与技术方案，可以进入实现阶段。
- [x] 确认 MVP 界面只开发白色主题，不实现深色主题、主题切换或跟随系统主题。
- [x] 确认 nyan 内部领域 ID 统一使用无前缀的原始 UUIDv4；类型由字段名和 branded/newtype 保证，内部 tool execution ID 不进入模型上下文。
- [x] 完成阶段 1 workspace 骨架：桌面、agent、protocol 三个包边界落地，根级命令可统一检查、测试、构建和启动。
- [x] 完成阶段 2 协议与进程垂直切片：共享协议、双端 NDJSON codec、Bun echo backend、Rust supervisor 和 Tauri Channel 已贯通。
- [x] 完成阶段 3 配置、provider 与最小 turn：真实 AI SDK 回合、停止、标题和 JSONL 恢复已接入桌面端。
- [x] 建立 Tauri WebView2 可观察开发入口：`dev:inspect` 仅在子进程环境启用随机 CDP 端口，可供 agent 读取 DOM、截图、console 与异常。
- [x] 完成阶段 4 第一版垂直切片：项目/任务文件存储与协议、原生目录选择、白色双栏产品外壳、侧栏导航、Lexical 输入和静态 Markdown transcript。

## 已完成：阶段 1 — workspace 骨架

- [x] 记录迁移前 `bun run build` 与 `cargo check` 基线，两者均通过。
- [x] 将 React/Vite/Tauri 模板移动到 `apps/desktop`，保留 `src-tauri` 与桌面 app 共置。
- [x] 新建 `apps/agent`，只提供可运行的 Bun 占位入口，不实现 agent 业务。
- [x] 新建 `packages/protocol`，只提供包边界和占位导出，不提前设计完整协议。
- [x] 把根 `package.json` 改为 private workspace 聚合入口，依赖归属到对应 workspace。
- [x] 修正根脚本并重新生成一致的 `bun.lock`；迁移后的 Tauri/Vite 相对路径无需额外改动。
- [x] 验证根级 install、typecheck、build、test、`cargo check` 和 Tauri dev 启动。
- [x] 更新本文；本轮未混入 NDJSON、provider 或 UI 业务。

阶段 1 完成定义：仓库目录与技术方案一致；三个 workspace 均可被 Bun 识别；现有模板 UI 行为不变；根目录有单一入口完成检查和构建；工作区无意外生成物。

### 阶段 1 验证记录

- 迁移前：`bun run build`、`cargo check --manifest-path src-tauri/Cargo.toml` 通过。
- 迁移后：`bun install`、`bun run check`、`bun run test`、`bun run build` 通过。
- `bun run dev` 已确认 Vite 在 `http://localhost:1420/` 就绪，Tauri desktop executable 成功启动。
- 目录移动后清理了含旧绝对路径的 Rust `target` 缓存并从空缓存重建；未改动业务源码行为。

## 已完成：阶段 2 — 协议与进程垂直切片

- [x] 定义 v1 envelope、生命周期、session/prompt/cancel 命令、统一 response、turn/tool/subagent 事件及 branded UUIDv4 ID。
- [x] 建立 TS/Rust 共用 golden fixtures，并在两端验证序列化/反序列化。
- [x] 实现 TS/Rust NDJSON codec，覆盖半帧、多帧、CRLF/空行、UTF-8 跨 chunk、16 MiB 上限与 EOF 半包。
- [x] 实现 Bun echo backend；stdout 只输出协议帧，stderr 保留日志通道。
- [x] 实现 Windows Bun PATH/版本检测、无窗口启动、stdin/stdout/stderr 管理、初始化握手和请求关联。
- [x] 通过 Tauri Channel 向 React 转发有序事件；最小 echo 页面可显示 `seq 0–3` 的完整 turn。
- [x] 实现 Bun 缺失专用错误页、重新检测/重启、异常退出状态和应用退出时的 shutdown/强制清理回退。

### 阶段 2 验证记录

- TypeScript：protocol 7 项测试、Bun echo backend 2 项测试通过。
- Rust：golden fixtures、UUIDv4、NDJSON、真实 Bun handshake/Channel echo、异常退出共 7 项测试通过。
- 集成测试实际启动全局 Bun，验证 `initialize → initialized`、session/create、prompt/turn 事件顺序和 shutdown。
- `bun run check`、`bun run test`、`bun run build` 与 `git diff --check` 通过。
- `bun run dev` 已确认 Vite、Tauri desktop executable 和 Bun backend 可共同启动；停止后没有遗留 Bun 进程。

## 已完成：阶段 3 — 配置、provider 与最小 turn

- [x] 实现 Windows 默认与 XDG 父目录覆盖路径；TOML 配置只读，模型 cache 与最近模型 state 分离写入。
- [x] 集成 Anthropic-compatible、OpenAI-compatible provider；支持静态模型、动态发现、TTL cache、稳定去重和过期后台刷新。
- [x] 用 AI SDK v7 `ToolLoopAgent` 实现无工具主回合；实时转发文本/reasoning delta，在完整 block 边界落盘。
- [x] 实现全局单活动 turn、幂等停止、同主模型并行生成短标题及本地截断回退。
- [x] 实现 session metadata 原子更新、JSONL 单调 seq、规范化 model messages、展示 transcript、半行截断与运行中 turn 恢复为 interrupted。
- [x] Rust supervisor 复用活动 session，并暴露 submit/cancel 命令；React 页面可显示模型输出、停止回合和错误。

### 阶段 3 验证记录

- Bun/TypeScript：protocol 7 项、agent 14 项测试通过；覆盖 provider factory、凭据错误脱敏、模型发现/cache、完整 block、停止竞态、单活动 turn、并发 JSONL 写入和异常恢复。
- Rust：supervisor、NDJSON、协议与真实 Bun 生命周期共 7 项测试通过。
- `bun run check`、`bun run test`、`bun run build`、`cargo fmt --check` 与 `git diff --check` 通过。
- `bun run dev` 已确认 Vite、Tauri desktop executable 和 Bun backend 正常启动；停止后没有遗留 nyan-agent/Bun 进程。
- `bun run dev:inspect` 已确认通过 `DevToolsActivePort` 自动连接当前 Tauri WebView2；实测可读取既有 console、实时监听新日志并捕获未处理异常栈。
- 该阶段最初未使用真实凭据；2026-07-19 已在后续阶段用本机隔离配置完成 Anthropic-compatible 真实流式请求，详见阶段 4 验证记录。

## 进行中：阶段 6 — 稳定与发布

- 已完成恢复与结构化故障语义加固、production artifact、NSIS 隔离安装运行 smoke，以及恢复、Bun 缺失→重新检测、crash、非法协议和配置错误真实桌面 E2E；下一步补充进程树清理桌面验收并进行真实 provider 综合验收。
- 用真实 provider 在桌面端综合验收 shell/edit/subagent、长进程轮询与停止；自动化底层覆盖已完成。

## 已完成：阶段 4 — 产品外壳

- [x] 增加 `projects.json` 原子存储以及项目 list/add/remove；项目路径必须是现有目录，重复添加稳定去重。
- [x] 增加 session list/load/remove，metadata 可绑定 project ID；绑定项目使用项目目录作为 cwd，无项目任务回退到用户家目录。
- [x] Rust/Tauri 暴露项目、任务和提交命令；原生目录选择使用 Tauri dialog plugin。
- [x] 将阶段 3 验证页替换为 1200×800（最小 960×640）的白色双栏产品外壳，接入 HeroUI v3 Button/Select、Lucide 图标、各列表独立的可见状态和任务导航；列表现已按初始 5 条、每次增加 10 条和递归重置规则工作。
- [x] 接入 Lexical 纯文本编辑器与 `react-markdown + remark-gfm` 静态 assistant block；恢复历史时从 transcript JSONL 映射展示项。
- [x] 增加模型列表与最近模型选择 UI：新任务可显式选模型，既有闲置任务可更新模型，运行中禁止切换；有效选择在创建/更新任务时写入共享最近模型 state。
- [x] 补齐新任务默认项目上下文的持久化：项目/无项目上下文写入共享 runtime state，重启后恢复，项目移除时自动清理失效引用，且不会与最近模型状态互相覆盖。
- [x] 接入稳定桌面 E2E：WebdriverIO Tauri Service embedded provider、测试专用 Tauri 权限/前端构建、临时 XDG 数据隔离和首条产品外壳 smoke flow 已落地。
- [x] 完成 Mica/window effects spike：保留 Windows 原生标题栏与系统三按钮，窗口启用透明 WebView 和 Mica，侧栏透出材质，主内容保持白色不透明层级。
- [x] 将产品外壳与 HeroUI 语义主题统一为 Catppuccin Latte：Mauve 作为主强调色，Base/Mantle/Crust 构成页面层级，并映射完整状态色、焦点色与表单色。
- [x] 将侧栏项目、无项目任务及各项目任务列表改为独立可见上限：初始 5 条、每次增加 10 条、全部显示后才提供折叠；折叠项目列表时递归重置所有项目任务列表。
- [x] 修正运行中任务切换与刷新恢复：session metadata 恢复全局 active turn，其他任务只读查看且明确提示；标题生成完成后通过 `session.title.updated` 独立事件即时更新侧栏和标题栏，不阻塞主 turn。
- [x] Provider 凭据支持 `api_key_env`/`auth_token_env` 环境变量引用；兼容端点可为未知模型配置上下文窗口与最大输出，AgentRunner 显式传递 `maxOutputTokens`，避免 Anthropic SDK 的 4,096 保守默认值。

### 阶段 4 当前验证记录

- protocol 7 项、agent 21 项、desktop 7 项、Rust 7 项测试通过；覆盖项目增删去重、非法目录、session 排序/删除、项目 cwd 绑定、默认项目上下文、模型配置/选择、环境变量凭据、侧栏增量展开、运行态恢复与标题事件。
- `bun run check`、`bun run test`、`bun run build` 通过；desktop production bundle 仅有现阶段可接受的大 chunk 提示。
- 使用 `bun run dev:inspect` 启动真实 Tauri，通过 `chrome-cdp --browser tauri` 自动发现 `DevToolsActivePort`；实测 1200×800 首屏、白色主题、无障碍树和 Lexical 中文输入，console warning 与未处理异常均为空。
- 使用隔离的静态 provider 配置实测 HeroUI 模型 Select：可展示 provider/model、切换选项，并与项目选择、发送按钮保持同一行；修复异步模型加载导致的 uncontrolled → controlled warning 后复查 console 为空。
- `bun run e2e` 已在真实 Tauri/WebView2 上通过：验证后端 ready、产品外壳、WDIO command bridge，以及项目/无项目上下文切换和页面刷新后的持久化恢复；1 个 spec、1 个测试通过。
- E2E 使用 `mise.toml` 固定 Node 24，规避当前 WDIO 9/Undici 6 在 Node 26 下创建 session 时的 `UND_ERR_INVALID_ARG`；`@wdio/native-utils` 固定到 2.5.0，规避 Tauri service 1.2.0 发布依赖缺少导出的兼容问题。
- Win11 Mica spike 将平台调用集中在 `platform/windows.rs`；原生标题栏、1200×800 默认尺寸和 960×640 最小尺寸保持不变，透明仅用于侧栏材质，transcript/composer 所在主内容仍为不透明白色。
- Mica 改动后重新通过 `bun run check`、`bun run test`、`bun run build`、`cargo fmt --check`、`git diff --check` 与真实 Tauri `bun run e2e`；窗口效果未破坏启动、WDIO command bridge 或项目上下文刷新恢复。
- Catppuccin Latte 配色调整后通过 `bun run build:desktop` 与 `git diff --check`；desktop production bundle 继续只有既有的大 chunk 提示。
- 侧栏增量展开新增 5 项桌面纯逻辑测试，覆盖 5 → 15 → 25 增量、末页截断、全部显示后折叠和父级递归重置；重新通过 `bun run check`、`bun run test`、`bun run build` 与 `git diff --check`，production bundle 仍只有既有的大 chunk 提示。
- 标题/运行态修正新增协议 golden fixture、后端标题事件断言和 2 项桌面恢复测试；`bun run check`、protocol 7 项、agent 20 项、desktop 7 项、Rust 7 项、`bun run build`、`cargo fmt --check`、`git diff --check` 与真实 Tauri `bun run e2e` 均通过，E2E 仍为 1 个 spec、1 个测试。
- 使用本机 `ARK_TOKEN` 与 `~/.config/nyan/config.toml` 实测 Anthropic-compatible `https://ark.cn-beijing.volces.com/api/coding/v1`、`minimax-m3`：AgentRunner 流式请求成功返回 `NYAN_OK`，实际加载 `contextWindow=1000000`、`maxOutputTokens=128000`；配置文件只保存环境变量名，不保存密钥值。

## 后续实施队列

### 阶段 2 — 协议与进程垂直切片

- [x] 定义共享 envelope、命令/响应/事件和 TS/Rust golden fixtures。
- [x] 实现 NDJSON codec，覆盖半帧、多帧、UTF-8 跨 chunk、16 MiB 超限与 EOF 半包。
- [x] 实现 Rust supervisor 与 Bun echo backend，通过 Tauri Channel 打通有序事件流。
- [x] 实现 Bun 缺失错误页、重新检测和进程退出清理。

### 阶段 3 — 配置、provider 与最小 turn

- [x] 定义 `~/.config/nyan/config.toml` schema、XDG/测试路径覆盖和模型 cache/state 格式。
- [x] 集成 Anthropic-compatible、OpenAI-compatible provider 与动态模型发现。
- [x] 实现无工具主 agent turn、完整文本 block、停止和主模型标题生成。
- [x] 实现最小 JSONL transcript 与异常中断恢复。

### 阶段 4 — 产品外壳

- [x] 实现项目/任务 CRUD、cwd 规则、新任务默认项目和最近模型。
- [x] 实现侧栏各列表的独立可见状态、任务导航和运行中只读查看。
- [x] 将列表行为从“一次展开全部”调整为初始 5 条、每次增量展开 10 条，全部显示后才提供折叠；父级折叠时递归重置所有后代展开状态，确保重新展开父级时回到完全折叠的初始状态。
- [x] 实现 Lexical 纯文本输入、静态 Markdown block 和 transcript 基础组件。
- [x] 验证 Win11 Mica、原生标题栏、窗口尺寸与白色主题。
- [x] 用 WebdriverIO Tauri Service 固化真实桌面 smoke E2E，并隔离真实用户数据。

### 阶段 5 — 三个工具

- [x] 确定 shell 启动折中：默认加载 Profile，设置 `TERM=dumb` + `NYAN_AGENT=1` 跳过交互增强，并保留 `-NonInteractive` 防止提示挂起；不使用 `-NoProfile`。
- [x] 实现 shell：PowerShell UTF-8 包装、合并输出、字节截断、长进程、超时和取消。
- [x] 实现 edit：六级 matcher、唯一性、防过大 span、原子写和 diff。
- [x] 实现 subagent：最多三个并行任务、阻塞聚合、单行最新活动和级联取消。

### 阶段 5 当前验证记录

- shell runtime 固定启动 `pwsh.exe -NoLogo -NonInteractive`，短命令使用单层 UTF-16LE `-EncodedCommand`，超过安全命令行阈值时回退到受控 UTF-8 临时 `.ps1`；两条路径都默认加载用户 Profile。
- 子进程环境设置 `TERM=dumb`、`NYAN_AGENT=1`、no-color 与 pager 变量，只在用户未设置时补 `PYTHONIOENCODING=utf-8`；stdout/stderr 并发读取并按 UTF-8 字节预算保留头尾，stderr 在预算竞争时获得更高保留份额。
- 单个 `shell` 模型工具同时支持启动、`processId` 轮询、stdin、关闭 stdin 与 kill；默认超时、turn 取消和 turn 收尾都会终止进程树，Windows 使用 `taskkill /T /F`，真实孙进程延迟写文件测试确认没有遗留。
- AI SDK v7 的 `onToolExecutionStart/End` 回调映射为独立 nyan `toolExecutionId`，provider tool-call ID 不进入领域协议；工具开始/完成写入 JSONL，桌面端可实时展示并从 transcript 恢复同一工具卡片。
- 新增 shell/agent/backend/desktop 回归，覆盖中文命令与路径、Python 中文 stdin/stdout、中文 stderr、引号、长命令回退、UTF-8 头尾截断、非零退出码、长进程轮询、超时进程树和 AbortSignal 级联取消。
- edit runtime 将请求和源文件规范化到 LF 后依次尝试 exact、line-trimmed、indentation-flexible、whitespace-normalized 与 block-anchor；默认要求唯一匹配，`replaceAll` 只选择不重叠候选，block-anchor 即使显式 `replaceAll` 也必须唯一并通过中间内容相似度阈值。
- edit 对模糊候选执行行数与字符跨度比例保护；已有文件拒绝空 `oldText`，不存在文件仅允许空 `oldText` 创建，拒绝目录、非 UTF-8、无变化和提前取消。每文件 mutex 覆盖读/匹配/写全过程，同目录临时文件经 flush 后原子 rename，保留 UTF-8 BOM、原换行风格与文件 mode。
- edit 返回实际匹配策略、替换次数、增删行统计和有上限的 diff；AI SDK 注册、独立 nyan tool ID、JSONL 工具记录以及桌面实时/恢复 diff 卡片复用现有通用工具链路。
- 新增 15 项 edit runtime 测试和 agent/desktop 集成回归，覆盖五种实际 matcher、CRLF/BOM、新建、`replaceAll`、重叠候选、跨度保护、并发串行、无写入失败路径和真实 AI SDK 工具执行。
- subagent 工具一次接受 1–3 个带唯一任务 ID 的独立任务，执行层以并发上限 3 调度并等待全部 settle；单项失败保留其他成功结果，每项最终文本按 64 KiB UTF-8 字节上限返回主模型。
- 每个 subagent 使用同一模型与独立上下文，只注入共享的 shell/edit 工具实例而不注入 subagent；共享 edit manager 保持跨主/子 agent 的每文件 mutex，父 AbortSignal 同时传入子模型与 shell 进程。
- 主提示词要求委派任务写清范围、预期结果和是否允许修改，并禁止多个写任务修改同一文件；子 agent 有独立 30-step 上限和总结约束。
- `subagent.activity` 现携带 subagent/task ID、运行状态、活动类型和截断 preview；桌面实时覆盖每个 subagent 的单行卡片，JSONL 仅保存开始与终态快照，恢复时折叠为同一项，不展开详细过程或单列最终摘要。
- 新增 agent/backend/desktop 回归，覆盖三个任务真实并发、阻塞结果聚合、兄弟任务部分失败、父级取消传播、活动事件首末快照持久化与桌面单行恢复。
- 本轮重新通过 `bun run check`、protocol 7 项、agent 52 项、desktop 10 项、Rust 7 项、`bun run build`、`cargo fmt --check`、`git diff --check` 与真实 Tauri `bun run e2e`；E2E 为 1 个 spec、1 个测试，production bundle 仍只有既有大 chunk 提示。

### 阶段 6 — 稳定与发布

- [x] JSONL 恢复除尾部半行外，能够原子清理单条完整坏记录，同时保留坏记录之后的合法历史、单调 seq 和运行中 turn 的 interrupted 终态。
- [x] Rust supervisor 用真实 Bun 故障注入覆盖非法 NDJSON；协议故障保持独立 `protocol_error` 状态，不再被随后发生的受控进程退出覆盖为通用 crash。
- [x] 桌面端区分 `backend.error` 与 `backend.crashed`，并让 Tauri command rejection 端到端保留 `{ code, message, details }`；配置错误 UI 不再依赖解析错误字符串。
- [x] production 构建固定先生成并 smoke `apps/agent/dist/main.js`；release 从 `$RESOURCE/agent/main.js` 启动，debug/E2E 保持源码入口，NSIS 资源清单包含同一 artifact。
- [x] 生成 Win11 x64 NSIS 安装包并完成仓库 target 下的隔离静默安装/运行/卸载 smoke；安装后的 release app 实际启动安装目录 artifact，关闭窗口后 Bun 子进程退出。
- [x] 真实桌面 E2E 用隔离 PATH 启动为 Bun unavailable，断言专用错误页与结构化状态；运行中把当前 Bun 硬链接进测试 PATH 后点击“重新检测”，同一 app 恢复 ready。
- [x] 将坏 JSONL 恢复、Bun 子进程崩溃、非法协议和配置错误扩展到真实桌面 E2E。
- [ ] 补充进程树清理的真实桌面故障验收。
- [ ] 用真实 provider 在桌面端综合验收 shell/edit/subagent、长进程轮询与停止。
- [ ] 完成 MVP 验收后，将临时文档沉淀为正式详细 `AGENTS.md`。

### 阶段 6 当前验证记录

- 新增 JSONL 单条完整坏记录恢复测试；合法的前后记录均保留，恢复后的 transcript 继续使用单调 seq，运行中 session 正确转为 interrupted。
- 新增真实 Bun fault-injector 集成测试，验证 invalid JSON stdout 会终止子进程并稳定保留结构化协议错误；既有直接 kill 测试继续验证真正的意外退出为 crashed。
- 新增 Rust command error 边界和桌面状态投影测试，覆盖 `config_invalid` 等后端错误代码跨 Tauri command 保留，以及 protocol error/crash 的 UI 分类。
- production artifact smoke 使用四套隔离 XDG 父目录真实执行 bundled `main.js` 的 `initialize → shutdown`；`tauri build --no-bundle` 的 release 分支通过，NSIS 清单确认包含 10.8 MiB app 与 1.56 MiB `agent/main.js`。
- NSIS `nyan-agent_0.1.0_x64-setup.exe` 为 2,644,393 bytes，SHA-256 `5E1EC52412739BF985C59B54E6C69CA4981D3208070029D440905E60810101FD`；隔离安装后观测到全局 Bun 以安装路径 artifact 为参数启动，关闭 app 后该子进程消失，uninstaller 返回 0，剩余空测试目录已清理。
- E2E 新增第二次真实 app 启动：PATH 初始只有空测试 bin 与 System32，确认 unavailable；随后把当前 Bun 硬链接进同一 PATH 并点击重新检测，后端恢复 ready。两次 app 启动均使用临时 XDG 数据并在结束后清理。
- E2E 构建支持仅在 Rust `e2e` feature 下通过 `NYAN_E2E_AGENT_ENTRY` 覆盖 agent 入口；production 和普通 debug 构建不会读取该测试开关，fault agent 也不进入 Tauri resource。
- 真实桌面 E2E 现在顺序启动五次隔离 app：正常产品外壳同时验证完整坏 JSONL 行被清理、后续合法 assistant 历史保留且 running turn 恢复为 interrupted；Bun 缺失后运行中重检；fault agent 以 exit 37 触发独立 crash UI；输出非法 NDJSON 触发并稳定保留 `protocol_error` UI；真实后端读取非法 TOML 后在 product shell 以 `[config_invalid]` 展示结构化 command error，backend 仍保持 ready。
- 本轮通过 `bun run check`、protocol 7 项、agent 53 项、desktop 12 项、Rust 10 项、`bun run build`、`cargo fmt --check`、`git diff --check` 与真实 Tauri `bun run e2e`；E2E 同一 spec 顺序覆盖正常启动/坏记录恢复、Bun 缺失→恢复、exit 37 crash、非法 NDJSON 和非法配置五种真实 app 运行，production bundle 只有既有大 chunk 提示。

## 最近一轮没有做

- 没有接入 CI E2E；当前稳定桌面 E2E 仍是本机 Windows 回归入口。release/NSIS smoke 已在阶段 6 完成，CI runner 留待后续。
- 没有实现 Windows Job Object；本阶段清理 Bun 直属进程，shell 子进程树在 shell 工具阶段实现。
- 没有从参考仓库复制实现。

## 完成定义

MVP 完成至少需要：应用能在目标 Win11 版本安装并启动；未安装 Bun 时显示可操作的错误页；能管理项目和任务；能恢复 JSONL 历史会话；主 agent 能运行、停止并使用 shell/edit/subagent；子进程崩溃和协议错误能在 UI 中明确呈现；关键协议与工具行为有自动化测试。
