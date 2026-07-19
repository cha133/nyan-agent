import { createNdjsonWriter, NdjsonDecoder, parseClientMessage, type ProtocolError } from "@nyan/protocol";
import type { ServerMessage } from "@nyan/protocol";
import { AgentBackend } from "./backend";
import { configureRuntimeLogging } from "./runtime-logging";

export async function run(): Promise<void> {
  configureRuntimeLogging();
  const decoder = new NdjsonDecoder(parseClientMessage);
  const rawWrite = createNdjsonWriter(process.stdout);
  let writeQueue = Promise.resolve();
  const write = (message: ServerMessage) => writeQueue = writeQueue.then(() => rawWrite(message));
  const backend = new AgentBackend({ emit: write });

  try {
    for await (const chunk of Bun.stdin.stream()) {
      for (const message of decoder.push(chunk)) {
        const result = await backend.handle(message);
        for (const response of result.messages) await write(response);
        result.start?.();
        if (result.shouldExit) {
          await result.beforeExit?.();
          await writeQueue;
          return;
        }
      }
    }
    decoder.finish();
  } catch (error) {
    const protocolError: ProtocolError = {
      code: error instanceof Error && "code" in error ? String(error.code) : "invalid_message",
      message: error instanceof Error ? error.message : "Unknown backend error",
    };
    await write({ v: 1, type: "backend.error", error: protocolError });
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await run();
}
