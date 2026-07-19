# Mica 失焦色调与壳层方案

## 产品现状

侧栏/标题栏使用 Tauri `Effect::Mica`（DWM system backdrop）。
**当前接受失焦回退中性色**（系统默认），不以「失焦锁壁纸色调」为必须项。

## 已放弃：自绘壁纸假 Mica

曾在主仓试过：Rust/`SPI_GETDESKWALLPAPER` 取桌面壁纸 → WebView 铺背景 → CSS blur / 降饱和 / 主题洗逼近 Mica。

结论：**放弃**。

1. **拖动卡顿**：按窗口屏幕坐标对齐时，即使改为 `transform` + `rAF` + 客户区原点，拖动仍明显卡；改为静态 `cover` 不跟坐标后卡顿消失，但已不再是真正的位置相关 Mica。
2. **Blur 观感差**：CSS 强模糊 + 洗色很难贴近 Codex/系统 Mica（易洗成死灰，或颜色脏、层次假）；继续拧参数收益低。
3. 代码已回退；不再在 Tauri 壳上迭代假 Mica。

## 较长线、有希望但改造大的方向

公开 Win32/DWM/`window-vibrancy` 路径无法在 Tauri HWND 上复现 Codex 失焦锁色；唯一真材质锁色样例是 **WinUI 3 `MicaController` + `AddSystemBackdropTarget`**（见下表 PoC）。

因此更有希望的壳层迁移是：

> **放弃当前 Windows 壳的 Tauri 2 + Rust**，改为 **WinUI 3 + WebView2 + C#**。
> **暂时不做 macOS**（产品本就只承诺 Win11）；若以后要 Mac：可用单独 Tauri 2 壳或 macOS 原生壳，**复用同一套前端产物与 Bun 后端**，增量不大。

要点：

- Windows 壳换 WinUI3，才能正经接 `MicaController` / system backdrop，并对齐失焦行为。
- React/Vite 前端与 `apps/agent` Bun 后端尽量不动；C# 只做窗口、WebView2 托管、与现有 NDJSON/进程监督对等的胶水。
- 改造面主要在 `apps/desktop/src-tauri` → WinUI 工程，以及打包/启动路径；属于大改，**尚未开工**。

## 历史：失焦锁色调研

曾尝试对齐 Codex 的「失焦仍保留壁纸色调」：

| 路径 | 激活壁纸色调 | 失焦锁色 | 备注 |
| --- | --- | --- | --- |
| WinUI 3 `MicaController` + `AddSystemBackdropTarget` + `IsInputActive = true` | 过 | **过** | 独立 PoC：`C:\Dev\mica-active-poc`（C#） |
| Tauri `Effect::Mica` / `DWMWA_SYSTEMBACKDROP_TYPE` | 过 | 不过 | **产品现状** |
| WASDK `MicaController.SetTarget(HWND)` + pin `IsInputActive` | 过 | 不过 | config 可写为 1，视觉仍褪；composition 易盖住 HWND/WebView 内容 |
| 纯 DWM `SYSTEMBACKDROP_TYPE=Mica` + `ExtendFrameIntoClientArea` | 过 | 不过 | 有框 / frameless + `WM_NCACTIVATE(-1)` 均不过 |

唯一真材质锁色路径是 **WinUI `AddSystemBackdropTarget`**，不适合直接接到 Tauri HWND。  
公开 Win32/DWM/WASDK 路径无法复现 Codex 失焦锁色。

### Codex 对照（GUI 未开源）

开源树 `C:\Dev\codex` 只有后端/TUI 等，**没有**桌面壳（见根 [`AGENTS.md`](../AGENTS.md)）。

本机 Store 包 `OpenAI.Codex` 使用 Owl（Electron fork）：

- UI 进程加载 `dwmapi.dll`，不使用 Windows App Runtime / `MicaController`
- 应用层：`backgroundMaterial: 'mica'` + 透明底色；Win 失焦时应用层不关掉 Mica
- 运行时 HWND 的 `DWMWA_SYSTEMBACKDROP_TYPE` 仍为 Mica（`= 2`）

并排验收：Codex 失焦仍锁色；同 attribute 的最小 DWM PoC 失焦仍褪色。  
差量应在 Owl/Chromium native 绘制，不在公开 DWM API 或 asar 里的 focus 切换逻辑。

### 已排除的做法

- 再拧 `IsInputActive` / `MicaKind` / `Effect::Tabbed`（Mica Alt）
- `CreateDesktopWindowTarget(..., isTopmost=true)`（盖住子控件）
- 把曾试验的增强 DLL 接回 nyan 运行时
- 固定 CSS 粉色/紫色 tint 冒充 Codex
- 假定「Codex = WinUI `IsInputActive`」或「Codex 实现在开源 `C:\Dev\codex`」
- **自绘壁纸假 Mica**（见上文；拖动卡顿 + blur 观感差）

### 外部 PoC（不在本仓库）

| 路径 | 内容 |
| --- | --- |
| `C:\Dev\mica-active-poc` | WinUI 锁色通过样例 |
| `C:\Dev\mica-active-poc\win32` | WASDK `SetTarget` 锁色失败 |
| `C:\Dev\mica-active-poc\win32-dwm` | 纯 DWM / frameless 锁色失败 |
