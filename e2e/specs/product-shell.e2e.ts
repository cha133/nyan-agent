import { link, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { $, browser, expect } from "@wdio/globals";

type PersistedState = { recentProjectId?: string | null };

describe("nyan desktop product shell", () => {
  it("starts the real Tauri app and restores project context", async () => {
    if (process.env.NYAN_E2E_SCENARIO === "crash") {
      await verifyCrashFailure();
      return;
    }
    if (process.env.NYAN_E2E_SCENARIO === "invalid-protocol") {
      await verifyProtocolFailure();
      return;
    }
    if (process.env.NYAN_E2E_SCENARIO === "config-invalid") {
      await verifyInvalidConfig();
      return;
    }
    if (process.env.NYAN_E2E_SCENARIO === "process-tree") {
      await verifyProcessTreeCleanup();
      return;
    }
    if (process.env.NYAN_E2E_MISSING_BUN === "1") {
      await verifyMissingBunRecovery();
      return;
    }
    const shell = await $("main.product-shell");
    await shell.waitForDisplayed();

    await expect($(".brand")).toHaveText(expect.stringContaining("nyan-agent"));
    await expect($(".workspace-header p")).toHaveText(process.env.NYAN_E2E_PROJECT_NAME!);
    await expect($(".welcome h2")).toHaveText("今天想做点什么？");

    const backend = await browser.tauri.execute(({ core }) => core.invoke("backend_status")) as { state: string };
    expect(backend.state).toBe("ready");

    await $("[aria-label='添加任务']").click();
    await expect($(".workspace-header p")).toHaveText("无项目任务");
    await waitForPersistedProject(null);

    await browser.refresh();
    await $("main.product-shell").waitForDisplayed();
    await expect($(".workspace-header p")).toHaveText("无项目任务");

    await $(".project-item").click();
    await expect($(".workspace-header p")).toHaveText(process.env.NYAN_E2E_PROJECT_NAME!);
    await waitForPersistedProject(process.env.NYAN_E2E_PROJECT_ID!);

    await browser.refresh();
    await $("main.product-shell").waitForDisplayed();
    await expect($(".workspace-header p")).toHaveText(process.env.NYAN_E2E_PROJECT_NAME!);

    await $(`button=${process.env.NYAN_E2E_RECOVERY_TITLE!}`).click();
    await expect($(".message-assistant")).toHaveText("still here");
    await expect($(".message-status")).toHaveText("上次运行因后端重启而中断。");
    await expect($(".task-status")).toHaveText("已中断");
  });
});

async function verifyCrashFailure(): Promise<void> {
  const screen = await $("main.centered-shell");
  await screen.waitForDisplayed();
  await expect($(".status-card h1")).toHaveText("Agent 后端意外退出");
  await expect($(".status-card pre")).toHaveText("退出代码：37");
  const status = await browser.tauri.execute(({ core }) => core.invoke("backend_status")) as { state: string; exitCode: number | null };
  expect(status).toEqual(expect.objectContaining({ state: "crashed", exitCode: 37 }));
}

async function verifyProtocolFailure(): Promise<void> {
  const screen = await $("main.centered-shell");
  await screen.waitForDisplayed();
  await expect($(".status-card h1")).toHaveText("Agent 通信协议错误");
  await expect($(".status-card pre")).toHaveText("错误代码：protocol_error");
  const status = await browser.tauri.execute(({ core }) => core.invoke("backend_status")) as { state: string; error: { code: string; message: string } };
  expect(status.state).toBe("protocol_error");
  expect(status.error.code).toBe("protocol_error");
  expect(status.error.message).toContain("invalid_json");
}

async function verifyInvalidConfig(): Promise<void> {
  await $("main.product-shell").waitForDisplayed();
  const error = await $(".error-text");
  await error.waitForDisplayed();
  await expect(error).toHaveText(expect.stringContaining("[config_invalid]"));
  const status = await browser.tauri.execute(({ core }) => core.invoke("backend_status")) as { state: string };
  expect(status.state).toBe("ready");
}

async function verifyProcessTreeCleanup(): Promise<void> {
  await $("main.centered-shell").waitForDisplayed();
  await expect($(".status-card h1")).toHaveText("Agent 后端意外退出");
  await expect($(".status-card pre")).toHaveText("退出代码：38");

  const pid = Number(await readFile(process.env.NYAN_E2E_TREE_PID_FILE!, "utf8"));
  expect(Number.isSafeInteger(pid)).toBe(true);
  await browser.waitUntil(async () => !isProcessRunning(pid), {
    timeout: 5_000,
    interval: 100,
    timeoutMsg: `backend descendant ${pid} survived the backend crash`,
  });
  await browser.pause(1_500);
  expect(await fileExists(process.env.NYAN_E2E_TREE_MARKER_FILE!)).toBe(false);
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function verifyMissingBunRecovery(): Promise<void> {
  const unavailable = await $("main.centered-shell");
  await unavailable.waitForDisplayed();
  await expect($(".status-card h1")).toHaveText("未找到 Bun");
  const initialStatus = await browser.tauri.execute(({ core }) => core.invoke("backend_status")) as { state: string };
  expect(initialStatus.state).toBe("unavailable");

  const source = process.env.NYAN_E2E_BUN_SOURCE!;
  const target = join(process.env.NYAN_E2E_FAKE_BIN!, "bun.exe");
  await link(source, target);
  await $("button=重新检测").click();

  await $("main.product-shell").waitForDisplayed();
  const recoveredStatus = await browser.tauri.execute(({ core }) => core.invoke("backend_status")) as { state: string };
  expect(recoveredStatus.state).toBe("ready");
}

async function waitForPersistedProject(expected: string | null): Promise<void> {
  await browser.waitUntil(async () => {
    const state = JSON.parse(await readFile(process.env.NYAN_E2E_STATE_FILE!, "utf8")) as PersistedState;
    return (state.recentProjectId ?? null) === expected;
  }, { timeout: 5_000, interval: 100, timeoutMsg: `project context was not persisted as ${expected ?? "none"}` });
}
