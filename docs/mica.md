# Mica 失焦色调调研

产品侧栏/标题栏使用 Tauri `Effect::Mica`（DWM system backdrop）。  
**当前产品决策：接受失焦回退中性色**（系统默认），不把「失焦锁壁纸色调」当必须项。

本文记录为对齐 Codex 失焦锁色所做的踩坑结论，避免重复投入。

## 结论摘要

| 路径 | 激活壁纸色调 | 失焦锁色 | 备注 |
| --- | --- | --- | --- |
| WinUI 3 `MicaController` + `AddSystemBackdropTarget` + `IsInputActive = true` | 过 | **过** | 独立 PoC：`C:\Dev\mica-active-poc`（C#） |
| Tauri `Effect::Mica` / `DWMWA_SYSTEMBACKDROP_TYPE` | 过 | 不过 | **产品现状** |
| WASDK `MicaController.SetTarget(HWND)` + pin `IsInputActive` | 过 | 不过 | config 可写为 1，视觉仍褪；composition 易盖住 HWND/WebView 内容 |
| 纯 DWM `SYSTEMBACKDROP_TYPE=Mica` + `ExtendFrameIntoClientArea` | 过 | 不过 | 有框 / frameless + `WM_NCACTIVATE(-1)` 均不过 |

唯一真材质锁色路径是 **WinUI `AddSystemBackdropTarget`**，不适合直接接到 Tauri HWND。  
公开 Win32/DWM/WASDK 路径无法复现 Codex 失焦锁色。

## Codex 对照（GUI 未开源）

开源树 `C:\Dev\codex` 只有后端/TUI 等，**没有**桌面壳（见根 [`AGENTS.md`](../AGENTS.md)）。

本机 Store 包 `OpenAI.Codex` 使用 Owl（Electron fork）：

- UI 进程加载 `dwmapi.dll`，不使用 Windows App Runtime / `MicaController`
- 应用层：`backgroundMaterial: 'mica'` + 透明底色；Win 失焦时应用层不关掉 Mica
- 运行时 HWND 的 `DWMWA_SYSTEMBACKDROP_TYPE` 仍为 Mica（`= 2`）

并排验收：Codex 失焦仍锁色；同 attribute 的最小 DWM PoC 失焦仍褪色。  
差量应在 Owl/Chromium native 绘制，不在公开 DWM API 或 asar 里的 focus 切换逻辑。

## 已排除的做法

- 再拧 `IsInputActive` / `MicaKind` / `Effect::Tabbed`（Mica Alt）
- `CreateDesktopWindowTarget(..., isTopmost=true)`（盖住子控件）
- 把曾试验的增强 DLL 接回 nyan 运行时
- 固定 CSS 粉色/紫色 tint 冒充 Codex
- 假定「Codex = WinUI `IsInputActive`」或「Codex 实现在开源 `C:\Dev\codex`」

## 曾考虑、未做的替代

**壁纸采样假 Mica**：读取桌面壁纸，按窗口位置裁切并 blur，作为侧栏背景。失焦可锁色，但与系统 Mica / Codex 非像素级一致。产品已选择接受系统失焦褪色，此方案搁置。

**Owl native 逆向 / WinUI XAML islands**：成本高，当前不做。

## 外部 PoC（不在本仓库）

| 路径 | 内容 |
| --- | --- |
| `C:\Dev\mica-active-poc` | WinUI 锁色通过样例 |
| `C:\Dev\mica-active-poc\win32` | WASDK `SetTarget` 锁色失败 |
| `C:\Dev\mica-active-poc\win32-dwm` | 纯 DWM / frameless 锁色失败 |
