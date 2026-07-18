# 跨会话交接

状态：2026-07-19，阶段 1–3 已完成，阶段 4“产品外壳”进行中。下一会话从任务切换/标题刷新、默认项目上下文持久化和窗口视觉收尾继续。

## 新会话目标

按照 [01-state.md](01-state.md) 继续阶段 4，不需要重新讨论已经审批的 [03-product.md](03-product.md) 和 [04-technical-plan.md](04-technical-plan.md)。当前产品外壳和模型选择已经落地；下一批优先完成：

1. 验证并修正任务切换、运行中只读和异步标题刷新。
2. 把新任务默认项目/最近页面上下文写入现有 UI state 文件，保持“从哪个上下文新建”的产品规则。
3. 做 Win11 Mica + 原生标题栏 spike，再决定是否需要进一步窗口实现。

阶段 5 的 shell/edit/subagent 尚未开始，不要在阶段 4 收尾时顺手混入。

## 仓库现场

- 工作区：`C:\Dev\nyan-agent`。
- 分支：`main`，跟踪 `origin/main`。
- 本交接前功能基线：`e79050a feat: add model selection workflow`。
- 上一个产品外壳提交：`beedd39 feat: build stage 4 product shell`。
- 本交接前本地 `main` 比 `origin/main` ahead 1；用户本轮只要求提交 handoff，没有要求 push。交接提交后预计 ahead 2。
- 包管理器和脚本运行时为 Bun；本机实测 Bun `1.3.14`，Tauri `2.11.5`，AI SDK `7.0.31`，HeroUI `3.2.2`。
- 交接提交完成后工作区应保持干净。

## 当前已完成

### 阶段 1–3

- workspace 已固定为 `apps/desktop`、`apps/agent`、`packages/protocol`；Rust 与桌面 app 共置在 `apps/desktop/src-tauri`。
- TS/Rust v1 协议、NDJSON codec、golden fixtures、Rust supervisor、Tauri Channel、全局 Bun 探测/生命周期均已完成。
- Bun 后端已接 AI SDK v7 `ToolLoopAgent`，当前是无工具主 agent；支持 provider 配置、模型发现/cache、停止、标题生成、JSONL 持久化和异常恢复。
- MVP 仍全局只允许一个活动主 turn；shell/edit/subagent 尚未实现。

### 阶段 4 当前切片

- `apps/agent/src/projects.ts` 提供 `projects.json` 原子存储、目录校验、稳定去重和 list/add/remove。
- `apps/agent/src/sessions.ts` 提供 session list/create/load/update/remove、项目绑定、cwd、metadata、transcript 和恢复。
- 协议与 Rust/Tauri 已贯通：
  - `project.list/add/remove`
  - `model.list`
  - `session.list/create/load/model.set/remove`
  - `prompt.submit` / `turn.cancel`
- 绑定项目的新任务 cwd 使用项目路径；无项目任务使用用户家目录。移除项目后，仍引用该项目 ID 的历史任务会在 UI 的无项目任务组中显示，不删除用户项目文件。
- `apps/desktop/src/App.tsx` 已是正式白色双栏外壳，不再是阶段 3 事件验证页：
  - 项目/任务侧栏和独立 5 条展开状态
  - 原生目录选择与项目/任务删除确认
  - 历史任务加载和 transcript 投影
  - Lexical 纯文本编辑器
  - `react-markdown + remark-gfm` 静态 assistant block
  - HeroUI v3 Button/Select 与 Lucide 图标
- 窗口默认 `1200×800`、最小 `960×640`；MVP 只实现白色主题。
- 模型 UI 已完成：
  - `model.list` 返回合并模型目录和按“最近有效 → default → 第一个有效”选出的模型。
  - 新任务可显式选择模型；创建时验证并写入 session metadata。
  - 既有闲置任务可用 `session.model.set` 切换模型；运行中后端拒绝切换。
  - 创建/更新任务时把模型写入跨项目共享的 `state.json` 最近模型。
  - 模型和项目选择器与发送按钮在同一工具栏；模型选项显示 model ID、provider ID 和 stale cache 提示。

## 配置与数据路径

- 用户配置：`~/.config/nyan/config.toml`，程序只读，不回写或重排。
- Windows 默认路径不使用 `%APPDATA%`：
  - config：`~/.config/nyan`
  - data：`~/.local/share/nyan`
  - state：`~/.local/state/nyan`
  - cache：`~/.cache/nyan`
- `XDG_CONFIG_HOME`、`XDG_DATA_HOME`、`XDG_STATE_HOME`、`XDG_CACHE_HOME` 都是父目录覆盖，运行时再追加 `nyan`；自动化和现场隔离测试必须四者一起设置，避免碰真实用户数据。
- 数据布局：`projects.json`、`sessions/<uuid>/meta.json`、`sessions/<uuid>/transcript.jsonl`；最近模型当前写在 `state.json`。
- 本机会话结束时真实 `~/.config/nyan/config.toml` 不存在；CDP 模型 UI 验收使用临时 XDG 根和纯静态假 provider，未读取或改写真实凭据，也未发外部模型请求。

## 已知缺口与注意点

- 异步标题存在 UI 刷新竞态：后端标题调用不阻塞主 turn，`store.setTitle` 没有对应领域事件；前端在 turn 终态刷新列表时，标题可能尚未写完。下一会话应增加明确的标题更新事件，或设计可靠的完成后刷新语义，不能靠延时轮询碰运气。
- 新任务默认项目目前只在当前 React 内存中跟随最近上下文，尚未写入 state；应用重启后不会恢复最近页面/项目。
- “运行中切到其他任务只读查看”已有全局 `submitting` 禁用基础，但尚未做完整真实交互验收和稳定自动化覆盖。
- 缺配置时项目/任务列表使用 `Promise.allSettled` 仍可加载，模型选择器显示“无可用模型”，下方显示配置错误；错误文本目前主要来自后端英文消息，尚未统一产品文案。
- Mica/window effects 尚未实现；当前是普通原生标题栏和白色不透明主体。
- WebdriverIO Tauri Service 尚未接入；production bundle 仍有大于 500 KiB 的 Vite chunk warning，目前不阻塞 MVP。
- Windows Job Object、shell 进程树和三个模型工具都属于后续阶段。
- 不引入 SQLite，不做流式 Markdown parser，不复制参考仓库代码。

## Tauri/CDP 调试闭环

- 普通开发：`bun run dev`。
- renderer/真实桌面调试必须用：`bun run dev:inspect`。
- `dev:inspect` 只给本次子进程设置 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=0`；release 和普通开发不开放调试端点。
- 用户已明确授权用 `chrome-cdp` 连接 Tauri。技能路径：`C:\Users\Admin\.agents\skills\chrome-cdp`。
- 所有命令明确使用 `--browser tauri`：
  1. `node C:\Users\Admin\.agents\skills\chrome-cdp\scripts\cdp.mjs --browser tauri list`
  2. 从输出复制唯一 target 前缀。
  3. 用 `snap <target> --compact`、`shot <target> <absolute.png>`、`console <target> warning 100`、`errors <target> 100` 检查现场。
  4. 时序问题先 `console-watch`；重新采集前 `console-clear`。
- Lexical `contenteditable` 若 selector click 未取得焦点，用 screenshot 的 DPR 换算 CSS 坐标后 `clickxy`，再 `type`；用 `eval` 检查 `document.activeElement` 和 DOM。
- `nav`/重载会丢弃旧 Tauri callback，紧邻重载的 “Couldn't find callback id” 是调试副作用；稳定后清空 console 再 watch。
- 结束时停止 `dev:inspect` 父进程，并确认 Tauri/Vite/Bun 一起退出。

## 最近验证

- `bun run check` 通过。
- `bun run test` 通过：protocol 7 项、agent 19 项、Rust 7 项；desktop 暂无独立测试文件。
- `bun run build` 通过；仅有 Vite 大 chunk 提示。
- `cargo fmt`、`git diff --check` 通过。
- 真实 `dev:inspect` + Tauri CDP 已验证：
  - 1200×800 白色首屏和无障碍树
  - Lexical 中文输入与发送按钮启用
  - “模型 / model select / 项目 / project select / 发送”同一行
  - 静态隔离配置下展示三个模型并切换到第二个模型
  - 修复 HeroUI Select 异步加载的 uncontrolled → controlled warning 后，稳定页面 console warning 和未处理异常为空

## 下一会话建议执行顺序

1. 先检查 `git status`，阅读 [00-index.md](00-index.md)、[03-product.md](03-product.md)、[04-technical-plan.md](04-technical-plan.md)、[01-state.md](01-state.md) 和本文件。
2. 设计最小 `session.title.updated` 事件或等价协议，补测试后修复异步标题 UI 竞态。
3. 扩展现有 `RuntimeState`，保存最近页面/项目上下文；不要覆盖已经存在的 `recentModel` 字段，更新 state 时需要合并写入而不是整文件替换。
4. 用隔离 XDG 数据构造至少两个任务和一个运行中 turn，实测任务切换、只读查看、停止按钮与返回活动任务。
5. 用 `dev:inspect` 检查 DOM、截图、console/errors；UI 稳定后再决定是否在本阶段接 WebdriverIO。
6. 完成 Win11 Mica + 原生标题栏 spike；保持 `decorations: true`，不要未经验证直接改自绘标题栏。
7. 同步 [01-state.md](01-state.md)，运行根级 check/test/build，提交原子 commit。

## 新会话开场建议

确认工作区干净后，直接从“异步标题更新事件 + 最近项目上下文 state 合并写”开始。无需重新审批阶段 1–3，也无需重写本交接，除非用户再次明确要求跨会话交接。
