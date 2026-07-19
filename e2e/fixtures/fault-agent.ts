import { createInterface } from "node:readline";

const scenario = process.env.NYAN_E2E_SCENARIO;
if (scenario !== "crash" && scenario !== "invalid-protocol" && scenario !== "process-tree") {
  throw new Error(`Unsupported E2E fault scenario: ${scenario ?? "missing"}`);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  const request = JSON.parse(line) as { type: string; requestId?: string };
  if (request.type === "initialize") {
    send({
      v: 1,
      type: "initialized",
      requestId: request.requestId,
      backend: { name: "nyan-e2e-fault-agent", version: "0", bunVersion: Bun.version },
    });
    continue;
  }
  if (request.type === "shutdown") {
    send({ v: 1, type: "response", requestId: request.requestId, ok: true, result: { status: "shutting_down" } });
    process.exit(0);
  }

  if (scenario === "crash") process.exit(37);
  if (scenario === "process-tree") {
    const pidFile = requiredEnv("NYAN_E2E_TREE_PID_FILE");
    const markerFile = requiredEnv("NYAN_E2E_TREE_MARKER_FILE");
    const descendant = Bun.spawn([
      process.execPath,
      "-e",
      `await Bun.sleep(1200); await Bun.write(${JSON.stringify(markerFile)}, "orphaned"); await Bun.sleep(60000);`,
    ], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    await Bun.write(pidFile, String(descendant.pid));
    process.exit(38);
  }
  process.stdout.write("{this is not valid NDJSON}\n");
  await Bun.sleep(60_000);
}

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}
