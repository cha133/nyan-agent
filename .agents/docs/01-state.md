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
- [x] 确认 nyan 内部领域 ID 统一使用无前缀的原始 UUIDv4；类型由字段名和 branded/newtype 保证，内部 tool execution ID 不进入模型上下文。
- [x] 完成阶段 1 workspace 骨架：桌面、agent、protocol 三个包边界落地，根级命令可统一检查、测试、构建和启动。
- [x] 完成阶段 2 协议与进程垂直切片：共享协议、双端 NDJSON codec、Bun echo backend、Rust supervisor 和 Tauri Channel 已贯通。
- [x] 完成阶段 3 配置、provider 与最小 turn：真实 AI SDK 回合、停止、标题和 JSONL 恢复已接入桌面端。

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
- 未使用真实凭据发起外部模型请求；provider 请求由 mock 覆盖，真实请求需用户配置 `~/.config/nyan/config.toml` 后手动验收。

## 下一步：阶段 4 — 产品外壳

- 实现项目/任务 CRUD、cwd 规则、新任务默认项目和最近模型选择。
- 实现侧栏导航、Lexical 纯文本输入、静态 Markdown transcript block。
- 验证 Win11 Mica、原生标题栏、窗口尺寸与深浅色。

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

- [ ] 实现项目/任务 CRUD、cwd 规则、新任务默认项目和最近模型。
- [ ] 实现侧栏每组 5 条的展开/折叠、任务导航和运行中只读查看。
- [ ] 实现 Lexical 纯文本输入、静态 Markdown block 和 transcript 基础组件。
- [ ] 验证 Win11 Mica、原生标题栏、窗口尺寸与深浅色。

### 阶段 5 — 三个工具

- [ ] 实现 shell：PowerShell UTF-8 包装、合并输出、字节截断、长进程、超时和取消。
- [ ] 实现 edit：六级 matcher、唯一性、防过大 span、原子写和 diff。
- [ ] 实现 subagent：最多三个并行任务、阻塞聚合、单行最新活动和级联取消。

### 阶段 6 — 稳定与发布

- [ ] 补齐端到端恢复、子进程崩溃、非法协议、配置错误和进程树清理测试。
- [ ] 验证 agent artifact 打包、全新机器 Bun 检测及 Win11 安装包。
- [ ] 完成 MVP 验收后，将临时文档沉淀为正式详细 `AGENTS.md`。

## 最近一轮没有做

- 没有实现正式项目/任务 CRUD、侧栏与多任务导航；这些进入阶段 4。
- 没有接入 Lexical/Markdown 正式 transcript 组件；当前页面显示完整文本与底层事件活动。
- 没有实现模型选择 UI；阶段 3 后端按最近模型、默认模型、首个可用模型依次选择。
- 没有实现 Windows Job Object；本阶段清理 Bun 直属进程，shell 子进程树在 shell 工具阶段实现。
- 没有从参考仓库复制实现。

## 完成定义

MVP 完成至少需要：应用能在目标 Win11 版本安装并启动；未安装 Bun 时显示可操作的错误页；能管理项目和任务；能恢复 JSONL 历史会话；主 agent 能运行、停止并使用 shell/edit/subagent；子进程崩溃和协议错误能在 UI 中明确呈现；关键协议与工具行为有自动化测试。
