import { readFile } from "node:fs/promises";
import { $, browser, expect } from "@wdio/globals";

type PersistedState = { recentProjectId?: string | null };

describe("nyan desktop product shell", () => {
  it("starts the real Tauri app and restores project context", async () => {
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

async function waitForPersistedProject(expected: string | null): Promise<void> {
  await browser.waitUntil(async () => {
    const state = JSON.parse(await readFile(process.env.NYAN_E2E_STATE_FILE!, "utf8")) as PersistedState;
    return (state.recentProjectId ?? null) === expected;
  }, { timeout: 5_000, interval: 100, timeoutMsg: `project context was not persisted as ${expected ?? "none"}` });
}
