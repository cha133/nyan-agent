# 跨会话交接

状态：2026-07-19。阶段 1–3 已完成；阶段 4 的产品外壳、模型选择、默认项目上下文持久化和真实 Tauri E2E 已落地，剩余重点是任务切换/标题刷新收尾与 Win11 Mica spike。阶段 5 的 shell/edit/subagent 尚未开始。

## 新会话目标

按照 [01-state.md](01-state.md) 继续阶段 4，不需要重新讨论已经审批的 [03-product.md](03-product.md) 和 [04-technical-plan.md](04-technical-plan.md)。建议按以下顺序推进：

1. 修复异步标题写入与前端列表刷新之间的竞态，优先设计明确的 `session.title.updated` 事件或等价的可靠语义。
2. 用现有真实桌面 E2E 验证任务切换、运行中只读查看、停止和返回活动任务，并补充稳定回归覆盖。
3. 做 Win11 Mica + 原生标题栏 spike；保持白色主题和原生窗口约束。

阶段 5 不要混入阶段 4 的收尾提交。

## 仓库现场

- 工作区：`C:\Dev\nyan-agent`。
- 分支：`main`，跟踪 `origin/main`；本次交接提交完成后工作区应干净。
- 包管理器与 agent 运行时为 Bun；本机实测 Bun `1.3.14`。
- WebdriverIO 编排使用仓库根 `mise.toml` 固定 Node 24；先执行 `mise install`，再运行 `bun run e2e`。
- Tauri `2.11.5`、AI SDK `7.0.31`、HeroUI `3.2.2`。
- 本次会话没有 push；是否推送由下一会话或用户决定。

## 当前已完成

### 阶段 1–3

- workspace 固定为 `apps/desktop`、`apps/agent`、`packages/protocol`；Rust 与桌面 app 共置在 `apps/desktop/src-tauri`。
- TS/Rust v1 协议、NDJSON codec、golden fixtures、Rust supervisor、Tauri Channel、Bun 探测与生命周期已完成。
- Bun 后端已接 AI SDK v7 `ToolLoopAgent`；支持 provider 配置、模型发现/cache、停止、标题生成、JSONL 持久化和异常恢复。
- MVP 仍全局只允许一个活动主 turn。

### 阶段 4

- 项目与任务 CRUD、项目 cwd 绑定、历史恢复、白色双栏产品外壳、侧栏导航、Lexical 输入和静态 Markdown transcript 已完成。
- 模型目录与选择已贯通：新任务显式选模型，闲置任务可切换，运行中禁止切换，最近模型写入共享 runtime state。
- `RuntimeStateStore` 合并维护 `recentModel` 与 `recentProjectId`；协议新增 `project.context.set`。项目/无项目上下文会在刷新和重启后恢复，移除项目时自动清理失效引用。
- 真实 Tauri E2E 已接入 WebdriverIO Tauri Service embedded provider，首条 smoke flow 验证后端 ready、产品外壳、命令桥、项目上下文切换与刷新后恢复。

## E2E 与 Node 运行时

- 正式入口：`bun run e2e`；只做构建可用 `bun run e2e:build`，类型检查可用 `bun run check:e2e`。
- 根 `mise.toml` 固定 Node 24，避免当前 WDIO 9/Undici 6 在 Node 26 创建 session 时出现 `UND_ERR_INVALID_ARG`。
- `scripts/e2e.ts` 通过 `mise which node` 解析 Node 24，并为 config/data/state/cache 与项目目录创建隔离临时根；结束后只清理该临时目录，不碰真实用户数据。
- WDIO/Tauri 权限、Rust plugin 和前端 guest bridge 只在 E2E 专用配置/feature/mode 下启用，不进入普通 production bundle。
- `@wdio/native-utils` 固定为 `2.5.0`，因为 Tauri service `1.2.0` 使用了 `2.4.0` 未导出的接口。
- 此前为诊断 Node 26 问题临时使用过 Codex Desktop 随附的 `codex-primary-runtime` Node 24；当前仓库实现不依赖该路径，统一由 mise 管理。

## 配置与数据路径

- 用户配置：`~/.config/nyan/config.toml`，程序只读。
- Windows 默认使用 `~/.config/nyan`、`~/.local/share/nyan`、`~/.local/state/nyan`、`~/.cache/nyan`，不使用 `%APPDATA%`。
- `XDG_CONFIG_HOME`、`XDG_DATA_HOME`、`XDG_STATE_HOME`、`XDG_CACHE_HOME` 都是父目录覆盖，运行时再追加 `nyan`；现场隔离测试必须四者一起设置。
- 数据布局：`projects.json`、`state.json`、`sessions/<uuid>/meta.json`、`sessions/<uuid>/transcript.jsonl`。
- 当前没有用真实凭据发起外部模型请求；provider 行为由 mock 覆盖，真实回合仍需配置后人工验收。

## 已知缺口与注意点

- 异步标题仍有 UI 刷新竞态：标题生成不阻塞主 turn，`store.setTitle` 没有领域事件；前端在 turn 终态刷新列表时，标题可能尚未写完。不要用延时轮询掩盖。
- “运行中切到其他任务只读查看”已有禁用基础，但尚未完成完整真实交互验收和 E2E 覆盖。
- Mica/window effects 尚未实现；当前是普通原生标题栏和白色不透明主体。
- 缺配置时项目/任务仍可加载，模型选择器显示无可用模型与配置错误；错误文案尚未统一。
- production bundle 有大于 500 KiB 的 Vite chunk warning，目前不阻塞 MVP。
- Windows Job Object、shell 进程树和三个模型工具属于后续阶段。
- 不引入 SQLite，不做流式 Markdown parser，不复制参考仓库代码。

## 调试闭环

- 普通开发：`bun run dev`。
- renderer/真实桌面现场调试：`bun run dev:inspect`；该命令只给当前子进程开启随机 CDP 端口，release 和普通开发不开放调试端点。
- 稳定回归优先使用 `bun run e2e`；CDP 保留给交互探索、DOM/截图、console 和时序问题诊断。
- 自动化与手动验收都使用隔离 XDG 根，不读取或修改真实用户配置与会话。
- 结束调试后确认 Tauri、Vite 和 Bun 子进程均已退出。

## 最近验证

- `bun run check` 通过。
- `bun run test` 通过：protocol 7 项、agent 20 项、Rust 7 项。
- `bun run build` 通过；普通 production 构建未包含 WDIO guest bridge，仅有已知大 chunk 提示。
- `bun run e2e` 通过：真实 Tauri/WebView2，1 个 spec、1 个测试。
- `cargo check --release`、`cargo fmt --check`、`git diff --check` 通过。
- 测试结束后未遗留 `nyan-agent` 进程。

## 下一会话建议执行顺序

1. 检查 `git status`，阅读 [00-index.md](00-index.md)、[01-state.md](01-state.md)、[03-product.md](03-product.md)、[04-technical-plan.md](04-technical-plan.md) 和本文件。
2. 增加标题更新领域事件与 TS/Rust fixture/test，修复前端标题刷新竞态。
3. 扩展 E2E，覆盖至少两个任务、活动 turn 切换、只读状态、停止和返回活动任务。
4. 用 `dev:inspect` 辅助检查 DOM、截图与 console/errors；避免把探索性 CDP 脚本当作稳定 E2E。
5. 完成 Win11 Mica + 原生标题栏 spike，记录是否保留 `decorations: true` 的结论。
6. 同步 [01-state.md](01-state.md)，运行根级 check/test/build/e2e，提交原子 commit。

## 新会话开场建议

确认工作区干净后，直接从“标题更新事件 + 任务切换 E2E”开始。无需重新审批阶段 1–3，也无需再次实现默认项目上下文或搭建 E2E 基础设施。
