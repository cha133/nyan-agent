import { createNdjsonWriter, NdjsonDecoder, parseClientMessage, type ProtocolError } from "@nyan/protocol";
import { EchoBackend } from "./backend";

export async function run(): Promise<void> {
  const decoder = new NdjsonDecoder(parseClientMessage);
  const write = createNdjsonWriter(process.stdout);
  const backend = new EchoBackend();

  try {
    for await (const chunk of Bun.stdin.stream()) {
      for (const message of decoder.push(chunk)) {
        const result = backend.handle(message);
        for (const response of result.messages) await write(response);
        if (result.shouldExit) return;
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
