# 产品约束

## 1. 用户与平台

- 只有开发者本人一个用户，不为其他用户做兼容、权限审批、引导或扩展能力。
- 只支持 Windows 11 26H1 及以上版本。
- 当前产品不编译 macOS/Linux，但进程启动、路径、窗口效果等平台相关逻辑应隔离，避免把 Windows 分支散落在业务层。

## 2. 产品原则

- YAGNI：只实现开发者本人能形成吃自己狗粮闭环的能力，不为未发生的兼容场景增加代码。
- YOLO：不做 tool use 权限、不做 workspace 限制、不做 sandbox，模型和 subagent 对文件系统有完整读写能力。
- 工具保持精简。能由 PowerShell 7 清晰完成的读取、搜索和文件操作不新增内置工具；只有 shell 难以可靠覆盖的能力才新增工具。
- 模型工具固定为 shell、edit、subagent。MCP、skill 和浏览器等以后优先接外部生态，不先重复实现内置版本。
- 不做流式 Markdown 解析。文本流在 reasoning、tool call 或 turn 结束等边界收束为完整 block 后，再用 Markdown renderer 渲染。

## 3. Agent 能力

当前只提供三个模型工具：

### shell

- 固定使用用户全局安装的 PowerShell 7（`pwsh`），不做多 shell 选择。
- 模型提示词说明如何用 PowerShell 7 完成文件读取、搜索和进程操作；搜索文本/文件时优先使用 `rg`。
- 支持超时、取消，以及长时间运行命令的续接/轮询。
- 输出只按 UTF-8 字节预算截断，不引入 GPT tokenizer；截断时保留头尾并报告省略字节数。
- 用单层 `-EncodedCommand` 传递“UTF-8 初始化脚本 + 用户命令”，避免中文和 Windows 命令行转义损坏；宿主按 UTF-8 解码 stdout/stderr。
- 默认加载用户 PowerShell Profile，以保留 mise 等工具链管理器设置的项目运行时；agent 在启动前设置 `TERM=dumb` 与 `NYAN_AGENT=1`，供 Profile 在完成必要环境初始化后跳过 PSReadLine、主题、prompt 和其他纯交互增强。
- shell 同时使用 PowerShell `-NonInteractive`，让输入提示直接失败而不是挂起；它不等价于 `-NoProfile`，默认不跳过 Profile。
- 不做 sandbox 和工具权限审批；这是单用户、全读写产品的明确取舍，但提示词仍提醒模型谨慎处理不可恢复操作。

### edit

- 单次调用描述一个文件中的 `oldText → newText` 替换，可显式 `replaceAll`。
- 保留 OpenCode 风格的多策略回退和忽略空白差异能力，但实现更小、更可测试。
- 默认要求唯一匹配；多匹配时拒绝并要求模型提供更多上下文。
- 防止模糊策略匹配到远大于 `oldText` 的文本块。
- 支持新建文件，但不把空 `oldText` 当作覆盖已有文件的方法。

### subagent

- 这是一个阻塞工具：主 agent 调用后暂停，所有子任务完成后一次性返回结果。
- 一次调用接受 1–3 个独立子任务，并发上限为 3。
- subagent 可使用 shell 和 edit，不可再次调用 subagent，读写不受限。
- “仅探索不修改”不是 harness 权限模式；主模型必须在子任务提示词里明确写出。harness 的系统提示词负责教主模型如何写清任务边界、预期结果和是否允许修改。
- 停止主 turn 时，必须级联停止所有 subagent 和它们启动的进程。
- UI 为每个 subagent 只展示运行状态和一行最新活动；最新活动可来自 reasoning、tool call 或文本输出，其余过程折叠，不单独展示最终摘要。最终结果仍作为 tool result 返回主模型。

## 4. Provider、模型与本地配置

- 只支持 Anthropic-compatible 与 OpenAI-compatible provider，分别基于 `@ai-sdk/anthropic` 和 `@ai-sdk/openai-compatible`。
- `~/.config/nyan/config.toml` 可配置多个 provider；每个 provider 可配置多个静态 model，也可开启动态模型发现。
- API key、base URL、自定义 header 等 provider 凭据可直接配置在 `config.toml`；API key/auth token 也可通过 `api_key_env`/`auth_token_env` 引用启动进程环境变量。当前不接 Windows Credential Manager。
- 动态发现结果写入独立 cache 文件，不回写 `config.toml`；默认 TTL 为 1 小时。
- 最近使用的模型在所有项目间共享。用户配置提供默认模型，运行时最近选择写入 state 文件，避免程序改写带注释的 TOML。
- Windows 默认配置根目录固定为 `~/.config/nyan`，不使用 `%APPDATA%`。保留 XDG 环境变量作为显式路径覆盖，主要用于自动化测试和隔离真实配置。

## 5. Bun 后端与通信

- Rust 只承担 Tauri 胶水和子进程 supervisor；AI SDK agent loop、工具、会话逻辑运行在 Bun 后端。
- 应用启动时检测全局 `bun`，不限制最低版本，也不内置或自动安装 Bun。
- 未检测到 Bun 时进入专用错误页，给出安装指引；用户自行安装后重启 agent/app。
- Rust 用 stdin/stdout 拉起 Bun 后端。
- framing 使用 UTF-8 NDJSON，自行实现 codec，不引入 NDJSON 库。
- 协议使用带 `v`、`type`、`requestId`/`turnId` 的领域化 discriminated union，不完整照搬 JSON-RPC 2.0。
- Bun stdout 只能写协议帧；所有日志和未捕获错误写 stderr。

## 6. GUI 信息架构

### 窗口

- 界面只开发白色主题，不实现深色主题、主题切换或跟随系统主题。
- 简化 Codex 桌面端布局：左侧栏、自绘透明标题栏、右侧主内容。
- 自绘标题栏高度 36px（独立顶栏，右侧主面板在其下方起排，仿 Codex）；右侧放仿 Win11 最小化/最大化/关闭按钮（最大化保留系统 Snap Layout 悬停；图标用 Segoe Fluent Icons）；不做“文件/视图”等菜单。
- 标题栏与左侧栏透出 Win11 Mica（失焦仍保持壁纸色调）；主体保持不透明白色层级，向左投影可向上渗入标题栏条带。

### 左侧栏

- 顶部 brand「Nyan Agent」，其下为“新建任务”按钮。
- “项目”分组及分组加号：从磁盘选择文件夹并添加项目。
- 每个项目带加号：进入新会话页并默认选中该项目。
- “任务”分组及分组加号：进入不绑定项目的新会话页。
- 项目下展示与该项目关联的任务；无项目任务展示在“任务”分组。
- 初始状态下“项目”最多显示 5 个，“任务”最多显示 5 个，每个项目内的任务也最多显示 5 个。
- 任一列表超过当前可见数量时，在该列表末尾显示“展开显示”；每次点击额外显示 10 条，未全部显示时末尾动作继续保持“展开显示”。只有全部条目都已显示后，末尾动作才切换为“折叠显示”；点击折叠后恢复为只显示前 5 条。各列表的可见数量与展开状态彼此独立。
- 折叠任一父级时，递归重置其所有后代的展开状态：折叠单个项目文件夹时，该项目的任务列表恢复为前 5 条；折叠“项目”分组时，其中所有项目文件夹都恢复为折叠，项目列表及各项目任务列表都恢复为前 5 条；折叠“任务”分组时，其无项目任务列表恢复为前 5 条。再次展开父级时始终从这个完全折叠的初始状态开始，不恢复折叠前的展开进度。

### 新会话默认项目

- 从某个项目上下文点击“新建任务”时，默认选中最近停留的该项目。
- 最近停留在“任务”上下文时，新会话默认不选项目。
- 通过项目行加号进入时，始终默认该项目；通过“任务”分组加号进入时，始终无项目。
- 无项目会话 cwd 为用户家目录；绑定项目的 cwd 为项目目录。

### 会话页

- 上部是 transcript，按时间展示用户消息、assistant 文本、工具调用和状态。
- assistant 文本按完整 block 使用 `react-markdown + remark-gfm` 渲染；正在接收但尚未闭合的 block 只按纯文本预览，闭合后一次性切换为 Markdown。
- 下部是 Lexical 编辑器；只作为纯文本多行输入，不支持 Markdown 富文本、mention 或 chip。
- 编辑器下一行依次提供模型选择、项目选择和发送按钮。
- agent 工作时发送按钮切换为可点击的停止按钮。
- 图标统一使用 Lucide React。
- 第一个用户 turn 提交后，额外调用同一个主模型，根据首条用户消息生成短会话标题；不使用小模型，也不阻塞主 turn。
- 工作中的任务允许切走查看其他历史任务，但全局只运行一个主 agent turn。

## 7. 明确非目标

- macOS/Linux 构建、移动端、远程后端、多用户、登录与同步。
- 工具权限审批、sandbox、git worktree、插件/MCP、技能系统、图片或附件输入。
- 输入框 Markdown 富文本编辑、流式 Markdown 渲染、语音、模型参数高级设置、完整 Codex 菜单与辅助面板。
- 后台并行运行多个主任务；允许查看其他任务不等于允许同时启动第二个主 turn。
