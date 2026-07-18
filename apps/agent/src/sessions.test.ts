import { describe, expect, test } from "bun:test";
import type { SessionId, TurnId } from "@nyan/protocol";
import { appendFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveNyanPaths } from "./paths";
import { SessionStore } from "./sessions";

function storeAt(root: string) {
  const paths = resolveNyanPaths({ XDG_CONFIG_HOME: join(root, "cfg"), XDG_DATA_HOME: join(root, "data"), XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache") }, root);
  return { paths, store: new SessionStore(paths, () => new Date("2026-01-01T00:00:00Z")) };
}

describe("session store", () => {
  test("persists metadata and complete model messages", async () => {
    const root = await mkdtemp(join(tmpdir(), "nyan-sessions-"));
    const { store } = storeAt(root);
    const session = await store.create("C:\\work", "provider/model");
    await store.append(session.id, "model.messages", [{ role: "user", content: "hello" }]);
    await store.append(session.id, "model.messages", [{ role: "assistant", content: [{ type: "text", text: "world" }] }]);
    expect(await store.messages(session.id)).toHaveLength(2);
    expect((await store.load(session.id))?.model).toBe("provider/model");
  });

  test("truncates a partial JSONL tail and marks a running turn interrupted", async () => {
    const root = await mkdtemp(join(tmpdir(), "nyan-recovery-"));
    const { paths, store } = storeAt(root);
    const session = await store.create("C:\\work", "provider/model");
    const turnId = crypto.randomUUID() as TurnId;
    await store.update(session.id, { status: "running", activeTurnId: turnId });
    await store.append(session.id, "turn.started", {}, turnId);
    const transcript = join(paths.sessionsDir, session.id as SessionId, "transcript.jsonl");
    await appendFile(transcript, '{"partial":');

    const recovered = new SessionStore(paths, () => new Date("2026-01-02T00:00:00Z"));
    await recovered.recover();

    expect((await recovered.load(session.id))?.status).toBe("interrupted");
    expect((await recovered.readTranscript(session.id)).map((record) => record.kind)).toEqual(["turn.started", "turn.interrupted"]);
    expect((await readFile(transcript, "utf8")).endsWith("\n")).toBe(true);
  });

  test("serializes concurrent metadata and transcript mutations", async () => {
    const root = await mkdtemp(join(tmpdir(), "nyan-concurrency-"));
    const { store } = storeAt(root);
    const session = await store.create("C:\\work", "provider/model");
    await Promise.all([
      store.update(session.id, { status: "running" }),
      store.setTitle(session.id, "Concurrent title"),
      ...Array.from({ length: 10 }, (_, index) => store.append(session.id, "test", { index })),
    ]);
    const records = await store.readTranscript(session.id);
    expect(records.map((record) => record.seq)).toEqual(records.map((_, index) => index));
    expect((await store.load(session.id))?.title).toBe("Concurrent title");
    expect((await store.load(session.id))?.status).toBe("running");
  });

  test("lists newest sessions first and removes their persisted directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "nyan-session-list-"));
    const paths = resolveNyanPaths({ XDG_CONFIG_HOME: join(root, "cfg"), XDG_DATA_HOME: join(root, "data"), XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache") }, root);
    let tick = 0;
    const store = new SessionStore(paths, () => new Date(`2026-01-01T00:00:0${tick++}Z`));
    const first = await store.create("C:\\one", "provider/model");
    const second = await store.create("C:\\two", "provider/model");

    expect((await store.list()).map((session) => session.id)).toEqual([second.id, first.id]);
    expect(await store.remove(first.id)).toBe(true);
    expect(await store.load(first.id)).toBeUndefined();
    expect(await store.remove(first.id)).toBe(false);
  });
});
