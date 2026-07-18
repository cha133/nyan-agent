import { resolve } from "node:path";

const remoteDebuggingFlag = "--remote-debugging-port=0";
const existingArguments = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS?.trim() ?? "";
const browserArguments = /(?:^|\s)--remote-debugging-port(?:=|\s|$)/.test(existingArguments)
  ? existingArguments
  : [existingArguments, remoteDebuggingFlag].filter(Boolean).join(" ");

const child = Bun.spawn(["bun", "run", "dev"], {
  cwd: resolve(import.meta.dir, ".."),
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: browserArguments,
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

process.exitCode = await child.exited;
