# 跨会话交接

状态：2026-07-19。阶段 1–5 已完成，阶段 6 进行中。恢复/结构化故障、production artifact、NSIS 安装、六类真实桌面 E2E 和 backend generation 进程树清理均已完成；剩余主线是真实 provider 桌面综合验收，以及 MVP 完成后沉淀正式 `AGENTS.md`。

## 新会话目标

继续 [01-state.md](01-state.md) 的阶段 6，不需要重新讨论已审批的 [03-product.md](03-product.md) 和 [04-technical-plan.md](04-technical-plan.md)：

1. 使用本机现有 provider 配置完成真实桌面 shell/edit/subagent 综合回合、长进程轮询和停止验收；不得输出、复制或提交 token，自动化测试不得读取真实密钥。
2. 完成剩余 MVP 验收后，把 `.agents/docs` 中仍有效的约束沉淀为正式详细 `AGENTS.md`。

## 仓库现场

- 工作区：`C:\Dev\nyan-agent`；分支：`main`，领先 `origin/main` 1 个提交。
- `cd12dff test: cover desktop backend failures` 包含坏 JSONL 恢复、Bun 缺失→重检、crash、非法 NDJSON 和非法配置五类真实桌面 E2E，以及仅在 `e2e` feature 生效的 fault-agent 入口。
- 最新提交包含 Windows Job Object、process-tree 第六类桌面 E2E、Cargo 依赖/锁文件、本 handoff，以及同步更新的 `00-index.md`、`01-state.md`、`04-technical-plan.md`。
- 本轮结束时工作区应干净；新会话仍应先运行 `git status --short --branch` 核对。
- 包管理器和 agent 运行时为 Bun，本机实测 `1.3.14`；WebdriverIO 通过根 `mise.toml` 固定 Node 24。

## 最新切片：backend generation 进程树

- `platform/windows.rs` 新增 RAII Windows Job Object，设置 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`。
- Rust supervisor 启动 Bun 后立即把 PID 关联到独立 job；job handle 由对应 backend generation 的 exit task 持有。
- Bun 正常关闭、受控 kill 或自身 crash 后，exit task 结束并关闭 job handle，仍存活的 Bun 后代会被操作系统级联终止。
- `windows-sys 0.61` 作为 Windows target dependency，启用 Foundation、JobObjects、Threading features。
- fault agent 新增 `process-tree` 场景：启动一个延迟写标记文件的 Bun 后代、记录 PID，然后以 exit 38 崩溃。
- 第六次真实 app E2E 断言 crash UI、后代 PID 消失，并在超过写入延迟后确认标记文件不存在。

## 阶段 6 已完成能力

- `SessionStore.recover()` 验证 UTF-8、record shape 和单调 seq；可原子清理单条完整坏记录，同时保留其后的合法历史，并把 running turn 恢复为 interrupted。
- Rust supervisor 区分 `protocol_error` 与真正的 `backend.crashed`；协议故障不会被随后受控退出覆盖。
- Tauri command rejection 端到端保留 `{ code, message, details }`；React 直接消费结构化状态，不解析错误字符串分类。
- `bun run build:agent` 生成并 smoke production artifact；release 从 `$RESOURCE/agent/main.js` 启动。
- Win11 x64 NSIS 已完成隔离安装/运行/卸载 smoke；安装版实际启动资源目录 artifact，关闭后 Bun 退出。
- E2E fault-agent 入口只在 Rust `e2e` feature 下通过 `NYAN_E2E_AGENT_ENTRY` 生效，不进入 production resource，也不改变普通 debug 行为。

## E2E 与最近验证

- `bun run e2e` 顺序启动六次真实 Tauri/WebView2：
  1. 正常产品外壳、项目上下文刷新恢复、完整坏 JSONL 行清理、后续 assistant 历史保留、running→interrupted。
  2. 隔离 PATH 下 Bun unavailable，同一 app 中硬链接 Bun 后重新检测恢复 ready。
  3. fault agent exit 37，UI 与 command bridge 均为结构化 crashed。
  4. fault agent 输出非法 NDJSON，UI 与 backend status 稳定为 `protocol_error`。
  5. fault agent exit 38 前启动后代，验证 Job Object 清理 PID 与延迟标记文件。
  6. 真实 backend 读取非法 TOML，product shell 显示 `[config_invalid]`，backend 保持 ready。
- 当前切片通过 `bun run check`、protocol 7 项、agent 53 项、desktop 12 项、Rust 10 项、`bun run test`、`bun run build`、`cargo fmt --check`、`git diff --check` 和六场景 `bun run e2e`。
- production Vite bundle 仍只有既有的大于 500 KiB chunk warning，当前不阻塞 MVP。

## 真实模型配置与下一验收

- 本机配置：`C:\Users\Admin\.config\nyan\config.toml`，不属于仓库，绝不能提交。
- 默认模型：`ark/minimax-m3`；Anthropic-compatible base URL 为 `https://ark.cn-beijing.volces.com/api/coding/v1`。
- 凭据使用 `auth_token_env = "ARK_TOKEN"`；配置只保存环境变量名。日志、文档和提交不得记录 token 值。
- limits：`context_window = 1000000`、`max_output_tokens = 128000`；`maxOutputTokens` 已传给 AgentRunner。
- 已完成 AgentRunner 真实流式 `NYAN_OK`；尚未完成真实桌面 shell/edit/subagent、长进程 poll、停止和工具卡片综合验收。
- 真实验收应创建隔离测试项目/文件，完成后清理测试文件与会话；不要把真实配置复制到 E2E 临时目录，也不要把真实 provider 纳入自动回归。

## 调试与 chrome-cdp

- 普通开发：`bun run dev`；renderer/真实桌面验收：`bun run dev:inspect`。
- 本机技能：`C:\Users\Admin\.agents\skills\chrome-cdp`。用户已明确修改其授权边界：当前开发/调试/验收范围内的本地 Tauri/WebView2 可直接连接，不再单独请求批准；Chrome/Edge 仍需明确批准。
- 用 `node C:\Users\Admin\.agents\skills\chrome-cdp\scripts\cdp.mjs --browser tauri list` 发现 target，后续始终传 `--browser tauri`。
- 结束时停止 `dev:inspect` 父进程，并确认 Tauri、Vite、Bun 及工具子进程均退出。

## 下一会话建议顺序

1. 按 [00-index.md](00-index.md) 顺序阅读产品、技术方案、状态和本文件，并检查 git diff。
2. 用 `bun run dev:inspect` 启动真实配置 app，通过 chrome-cdp 完成 shell→edit→subagent 综合回合，再分别验证长进程 poll 和停止。
3. 检查 transcript 工具卡片、session JSONL、console/errors 和所有相关进程；清理验收项目/会话。
4. 更新 [01-state.md](01-state.md)；MVP 验收完成后整理正式 `AGENTS.md`。
