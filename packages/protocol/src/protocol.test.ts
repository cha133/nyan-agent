import { describe, expect, test } from "bun:test";
import { encodeNdjson, MAX_FRAME_BYTES, NdjsonDecoder, NdjsonError, parseClientMessage, parseServerMessage } from "./index";

const fixturePath = new URL("../fixtures/protocol-v1.json", import.meta.url);

describe("protocol v1 golden fixtures", () => {
  test("all client and server fixtures parse", async () => {
    const fixtures = await Bun.file(fixturePath).json();
    expect(fixtures.clientMessages.map(parseClientMessage)).toHaveLength(12);
    expect(fixtures.serverMessages.map(parseServerMessage)).toHaveLength(16);
  });

  test("rejects mixed IDs and unsupported versions", () => {
    expect(() => parseClientMessage({ v: 2, type: "shutdown", requestId: crypto.randomUUID() })).toThrow("unsupported protocol version");
    expect(() => parseClientMessage({ v: 1, type: "session.load", requestId: crypto.randomUUID(), sessionId: "session-1" })).toThrow("sessionId must be a UUIDv4");
  });
});

describe("NDJSON codec", () => {
  test("handles partial frames, multiple frames, CRLF, and empty lines", () => {
    const decoder = new NdjsonDecoder();
    expect(decoder.push(new TextEncoder().encode('{"text":"你'))).toEqual([]);
    expect(decoder.push(new TextEncoder().encode('好"}\r\n\n{"n":2}\n'))).toEqual([{ text: "你好" }, { n: 2 }]);
    decoder.finish();
  });

  test("handles a UTF-8 code point split across chunks", () => {
    const bytes = encodeNdjson({ text: "猫" });
    const split = bytes.indexOf(0xe7) + 1;
    const decoder = new NdjsonDecoder();
    expect(decoder.push(bytes.subarray(0, split))).toEqual([]);
    expect(decoder.push(bytes.subarray(split))).toEqual([{ text: "猫" }]);
  });

  test("enforces the raw byte limit", () => {
    const decoder = new NdjsonDecoder(undefined, 8);
    expect(() => decoder.push(new TextEncoder().encode('{"long":1}\n'))).toThrow(NdjsonError);
  });

  test("uses the production 16 MiB frame limit", () => {
    const decoder = new NdjsonDecoder();
    const oversized = new Uint8Array(MAX_FRAME_BYTES + 1).fill(0x20);
    expect(() => decoder.push(oversized)).toThrow(NdjsonError);
  });

  test("reports a non-empty trailing frame at EOF", () => {
    const decoder = new NdjsonDecoder();
    decoder.push(new TextEncoder().encode('{"partial":true}'));
    try {
      decoder.finish();
      throw new Error("finish should have failed");
    } catch (error) {
      expect(error).toBeInstanceOf(NdjsonError);
      expect((error as NdjsonError).code).toBe("unexpected_eof");
    }
  });
});
