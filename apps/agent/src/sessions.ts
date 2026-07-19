import type { ModelMessage } from "ai";
import type { ProjectId, SessionId, TurnId } from "@nyan/protocol";
import { mkdir, open, readFile, readdir, rm, truncate } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteFile, atomicWriteJson, isNotFound, readJsonFile } from "./files";
import type { NyanPaths } from "./paths";

export type SessionStatus = "idle" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

export type SessionMeta = {
  version: 1;
  id: SessionId;
  projectId?: ProjectId;
  cwd: string;
  title: string;
  model: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  activeTurnId?: TurnId;
};

export type TranscriptRecord = {
  schemaVersion: 1;
  seq: number;
  createdAt: string;
  turnId?: TurnId;
  kind: string;
  payload: unknown;
};

export class SessionStore {
  private readonly nextSeq = new Map<SessionId, number>();
  private readonly mutations = new Map<SessionId, Promise<void>>();

  constructor(private readonly paths: NyanPaths, private readonly now: () => Date = () => new Date()) {}

  async recover(): Promise<void> {
    await mkdir(this.paths.sessionsDir, { recursive: true });
    for (const entry of await readdir(this.paths.sessionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const id = entry.name as SessionId;
      const meta = await this.load(id).catch(() => undefined);
      if (!meta) continue;
      await this.recoverTranscript(id);
      if (meta.status === "running") {
        const turnId = meta.activeTurnId;
        await this.append(id, "turn.interrupted", { reason: "backend_restarted" }, turnId);
        await this.update(id, { status: "interrupted", activeTurnId: undefined });
      }
    }
  }

  async create(cwd: string, model: string, projectId?: ProjectId): Promise<SessionMeta> {
    const id = crypto.randomUUID() as SessionId;
    const createdAt = this.now().toISOString();
    const meta: SessionMeta = {
      version: 1,
      id,
      ...(projectId ? { projectId } : {}),
      cwd,
      title: "New session",
      model,
      status: "idle",
      createdAt,
      updatedAt: createdAt,
    };
    await mkdir(this.sessionDir(id), { recursive: true });
    await atomicWriteJson(this.metaFile(id), meta);
    this.nextSeq.set(id, 0);
    return meta;
  }

  async load(id: SessionId): Promise<SessionMeta | undefined> {
    return readJsonFile<SessionMeta>(this.metaFile(id));
  }

  async list(): Promise<SessionMeta[]> {
    await mkdir(this.paths.sessionsDir, { recursive: true });
    const sessions = await Promise.all((await readdir(this.paths.sessionsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.load(entry.name as SessionId).catch(() => undefined)));
    return sessions.filter((session): session is SessionMeta => session !== undefined)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async remove(id: SessionId): Promise<boolean> {
    if (!await this.load(id)) return false;
    await this.mutate(id, async () => {
      await rm(this.sessionDir(id), { recursive: true });
      this.nextSeq.delete(id);
    });
    return true;
  }

  async update(id: SessionId, patch: Partial<Omit<SessionMeta, "version" | "id" | "createdAt">>): Promise<SessionMeta> {
    return this.mutate(id, async () => {
      const current = await this.load(id);
      if (!current) throw new Error("session_not_found: Session was not found");
      const next = { ...current, ...patch, updatedAt: this.now().toISOString() };
      for (const key of Object.keys(next) as Array<keyof SessionMeta>) {
        if (next[key] === undefined) delete next[key];
      }
      await atomicWriteJson(this.metaFile(id), next);
      return next;
    });
  }

  async append(id: SessionId, kind: string, payload: unknown, turnId?: TurnId): Promise<TranscriptRecord> {
    return this.mutate(id, async () => {
      const seq = await this.sequence(id);
      const record: TranscriptRecord = { schemaVersion: 1, seq, createdAt: this.now().toISOString(), kind, payload, ...(turnId ? { turnId } : {}) };
      await mkdir(this.sessionDir(id), { recursive: true });
      const handle = await open(this.transcriptFile(id), "a", 0o600);
      try {
        await handle.write(`${JSON.stringify(record)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      this.nextSeq.set(id, seq + 1);
      return record;
    });
  }

  async messages(id: SessionId): Promise<ModelMessage[]> {
    const records = await this.readTranscript(id);
    return records.filter((record) => record.kind === "model.messages")
      .flatMap((record) => Array.isArray(record.payload) ? record.payload as ModelMessage[] : []);
  }

  async setTitle(id: SessionId, title: string): Promise<void> {
    await this.update(id, { title });
    await this.append(id, "session.title", { title });
  }

  async readTranscript(id: SessionId): Promise<TranscriptRecord[]> {
    try {
      const text = await readFile(this.transcriptFile(id), "utf8");
      return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as TranscriptRecord);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  private async recoverTranscript(id: SessionId): Promise<void> {
    const file = this.transcriptFile(id);
    let buffer: Buffer;
    try {
      buffer = await readFile(file);
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
    const hasPartialTail = buffer.length > 0 && buffer[buffer.length - 1] !== 0x0a;
    const completeLength = hasPartialTail ? buffer.lastIndexOf(0x0a) + 1 : buffer.length;
    const validLines: Buffer[] = [];
    let start = 0;
    let lastSeq = -1;
    let discardedCompleteLine = false;
    for (let index = 0; index < completeLength; index += 1) {
      if (buffer[index] !== 0x0a) continue;
      const rawLine = buffer.subarray(start, index);
      start = index + 1;
      if (rawLine.length === 0) continue;
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(rawLine);
        const record = JSON.parse(text.endsWith("\r") ? text.slice(0, -1) : text) as unknown;
        if (!isTranscriptRecord(record) || record.seq <= lastSeq) throw new Error("invalid transcript record");
        lastSeq = record.seq;
        validLines.push(rawLine);
      } catch {
        discardedCompleteLine = true;
      }
    }
    if (discardedCompleteLine) {
      const recovered = Buffer.concat(validLines.flatMap((line) => [line, Buffer.from("\n")]));
      await atomicWriteFile(file, recovered);
    } else if (hasPartialTail) {
      await truncate(file, completeLength);
    }
    this.nextSeq.delete(id);
  }

  private async sequence(id: SessionId): Promise<number> {
    const known = this.nextSeq.get(id);
    if (known !== undefined) return known;
    const records = await this.readTranscript(id);
    const next = records.reduce((highest, record) => Math.max(highest, record.seq + 1), 0);
    this.nextSeq.set(id, next);
    return next;
  }

  private async mutate<T>(id: SessionId, action: () => Promise<T>): Promise<T> {
    const previous = this.mutations.get(id) ?? Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => {}).then(() => current);
    this.mutations.set(id, tail);
    await previous.catch(() => {});
    try {
      return await action();
    } finally {
      release();
      if (this.mutations.get(id) === tail) this.mutations.delete(id);
    }
  }

  private sessionDir(id: SessionId): string { return join(this.paths.sessionsDir, id); }
  private metaFile(id: SessionId): string { return join(this.sessionDir(id), "meta.json"); }
  private transcriptFile(id: SessionId): string { return join(this.sessionDir(id), "transcript.jsonl"); }
}

function isTranscriptRecord(value: unknown): value is TranscriptRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1
    && Number.isSafeInteger(record.seq)
    && (record.seq as number) >= 0
    && typeof record.createdAt === "string"
    && typeof record.kind === "string"
    && "payload" in record
    && (record.turnId === undefined || typeof record.turnId === "string");
}
