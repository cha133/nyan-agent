import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseServerMessage, type RequestId } from "../packages/protocol/src";

const artifact = resolve(import.meta.dir, "../apps/agent/dist/main.js");
const isolationRoot = await mkdtemp(join(tmpdir(), "nyan-artifact-smoke-"));
const initializeRequestId = crypto.randomUUID() as RequestId;
const shutdownRequestId = crypto.randomUUID() as RequestId;
const child = Bun.spawn([process.execPath, artifact], {
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
  env: {
    ...Bun.env,
    XDG_CONFIG_HOME: join(isolationRoot, "config"),
    XDG_DATA_HOME: join(isolationRoot, "data"),
    XDG_STATE_HOME: join(isolationRoot, "state"),
    XDG_CACHE_HOME: join(isolationRoot, "cache"),
  },
});

try {
  child.stdin.write(`${JSON.stringify({
    v: 1,
    type: "initialize",
    requestId: initializeRequestId,
    client: { name: "artifact-smoke", version: "0" },
  })}\n`);
  child.stdin.write(`${JSON.stringify({
    v: 1,
    type: "shutdown",
    requestId: shutdownRequestId,
  })}\n`);
  child.stdin.end();

  const result = await Promise.race([
    Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]),
    Bun.sleep(10_000).then(() => { throw new Error("Timed out waiting for the production agent artifact"); }),
  ]);
  const [stdout, stderr, exitCode] = result;
  const messages = stdout.trim().split("\n").filter(Boolean).map((line) => parseServerMessage(JSON.parse(line)));
  if (exitCode !== 0) throw new Error(`Agent artifact exited with code ${exitCode}: ${stderr}`);
  if (!messages.some((message) => message.type === "initialized" && message.requestId === initializeRequestId)) {
    throw new Error("Agent artifact did not complete initialization");
  }
  if (!messages.some((message) => message.type === "response" && message.requestId === shutdownRequestId && message.ok)) {
    throw new Error("Agent artifact did not acknowledge shutdown");
  }
  console.log(`Agent artifact smoke passed: ${artifact}`);
} finally {
  if (child.exitCode === null) child.kill();
  await rm(isolationRoot, { recursive: true, force: true });
}
