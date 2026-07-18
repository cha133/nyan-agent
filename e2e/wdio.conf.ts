import { resolve } from "node:path";

const appBinaryPath = resolve("apps/desktop/src-tauri/target/debug/nyan-agent.exe");
const requiredEnvironment = ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"] as const;
const appEnvironment = Object.fromEntries(requiredEnvironment.map((key) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing E2E environment variable: ${key}`);
  return [key, value];
}));

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
