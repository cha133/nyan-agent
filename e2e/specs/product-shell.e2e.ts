import { link, readFile } from "node:fs/promises";
import { join } from "node:path";
import { $, browser, expect } from "@wdio/globals";

type PersistedState = { recentProjectId?: string | null };

describe("nyan desktop product shell", () => {
  it("starts the real Tauri app and restores project context", async () => {
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
  });
});

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
