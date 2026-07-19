import { createInterface } from "node:readline";

const scenario = process.env.NYAN_E2E_SCENARIO;
if (scenario !== "crash" && scenario !== "invalid-protocol") {
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
  process.stdout.write("{this is not valid NDJSON}\n");
  await Bun.sleep(60_000);
}

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
