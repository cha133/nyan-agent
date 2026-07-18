export const MAX_FRAME_BYTES = 16 * 1024 * 1024;

export class NdjsonError extends Error {
  constructor(
    readonly code: "frame_too_large" | "invalid_utf8" | "invalid_json" | "unexpected_eof",
    message: string,
  ) {
    super(message);
    this.name = "NdjsonError";
  }
}

export class NdjsonDecoder<T = unknown> {
  private buffer: Uint8Array<ArrayBufferLike> = new Uint8Array();

  constructor(
    private readonly parse: (value: unknown) => T = (value) => value as T,
    private readonly maxFrameBytes = MAX_FRAME_BYTES,
  ) {}

  push(chunk: Uint8Array): T[] {
    if (chunk.byteLength === 0) return [];
    this.buffer = concat(this.buffer, chunk);
    const messages: T[] = [];
    let frameStart = 0;

    for (let index = 0; index < this.buffer.byteLength; index += 1) {
      if (this.buffer[index] !== 0x0a) continue;
      let frameEnd = index;
      if (frameEnd > frameStart && this.buffer[frameEnd - 1] === 0x0d) frameEnd -= 1;
      const frameLength = frameEnd - frameStart;
      if (frameLength > this.maxFrameBytes) throw new NdjsonError("frame_too_large", `NDJSON frame exceeds ${this.maxFrameBytes} bytes`);
      if (frameLength > 0) messages.push(this.decodeFrame(this.buffer.subarray(frameStart, frameEnd)));
      frameStart = index + 1;
    }

    this.buffer = this.buffer.slice(frameStart);
    if (this.buffer.byteLength > this.maxFrameBytes) throw new NdjsonError("frame_too_large", `NDJSON frame exceeds ${this.maxFrameBytes} bytes`);
    return messages;
  }

  finish(): void {
    if (this.buffer.byteLength > 0) throw new NdjsonError("unexpected_eof", `NDJSON stream ended with ${this.buffer.byteLength} trailing bytes`);
  }

  private decodeFrame(frame: Uint8Array): T {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(frame);
    } catch {
      throw new NdjsonError("invalid_utf8", "NDJSON frame is not valid UTF-8");
    }

    try {
      return this.parse(JSON.parse(text));
    } catch (error) {
      if (error instanceof NdjsonError || error instanceof TypeError) throw error;
      throw new NdjsonError("invalid_json", "NDJSON frame is not valid JSON");
    }
  }
}

export function encodeNdjson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

export type WritableByteStream = {
  write(bytes: Uint8Array, callback: (error?: Error | null) => void): unknown;
};

async function writeWithBackpressure(stream: WritableByteStream, bytes: Uint8Array): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.write(bytes, (error?: Error | null) => (error ? reject(error) : resolve()));
  });
}

export function createNdjsonWriter(stream: WritableByteStream): (value: unknown) => Promise<void> {
  let pending = Promise.resolve();
  return (value) => {
    pending = pending.then(() => writeWithBackpressure(stream, encodeNdjson(value)));
    return pending;
  };
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array<ArrayBufferLike> {
  const result = new Uint8Array(left.byteLength + right.byteLength);
  result.set(left);
  result.set(right, left.byteLength);
  return result;
}
