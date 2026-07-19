import { resolve } from "node:path";

const appBinaryPath = resolve("apps/desktop/src-tauri/target/debug/nyan-agent.exe");
const requiredEnvironment = ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"] as const;
const appEnvironment = Object.fromEntries(requiredEnvironment.map((key) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing E2E environment variable: ${key}`);
  return [key, value];
}));
for (const key of ["NYAN_E2E_SCENARIO", "NYAN_E2E_AGENT_ENTRY", "NYAN_E2E_TREE_PID_FILE", "NYAN_E2E_TREE_MARKER_FILE"] as const) {
  if (process.env[key]) appEnvironment[key] = process.env[key]!;
}
if (process.env.NYAN_E2E_MISSING_BUN === "1") {
  const fakeBin = process.env.NYAN_E2E_FAKE_BIN;
  if (!fakeBin) throw new Error("Missing E2E fake Bun directory");
  const isolatedPath = `${fakeBin};${process.env.SystemRoot ?? "C:\\Windows"}\\System32`;
  appEnvironment.PATH = isolatedPath;
  appEnvironment.Path = isolatedPath;
}

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: [resolve("e2e/specs/product-shell.e2e.ts")],
  maxInstances: 1,
  capabilities: [{
    browserName: "tauri",
  }],
  services: [["@wdio/tauri-service", {
    appBinaryPath,
    driverProvider: "embedded",
    env: appEnvironment,
    captureBackendLogs: true,
    captureFrontendLogs: true,
    startTimeout: 60_000,
    statusPollTimeout: 10_000,
  }]],
  framework: "mocha",
  reporters: ["spec"],
  logLevel: "silent",
  waitforTimeout: 15_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 1,
  mochaOpts: { ui: "bdd", timeout: 60_000 },
};
