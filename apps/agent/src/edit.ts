import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { isNotFound } from "./files";

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const MAX_DIFF_CHARS = 64 * 1024;
const BLOCK_SIMILARITY_THRESHOLD = 0.72;

export type EditInput = {
  filePath: string;
  oldText: string;
  newText: string;
  replaceAll?: boolean;
};

export type EditStrategy = "create" | "exact" | "line-trimmed" | "indentation-flexible" | "whitespace-normalized" | "block-anchor";

export type EditResult = {
  status: "created" | "updated";
  filePath: string;
  strategy: EditStrategy;
  replacements: number;
  additions: number;
  deletions: number;
  diff: string;
  diffTruncated: boolean;
};

type Span = { start: number; end: number };
type MatchResult = { strategy: Exclude<EditStrategy, "create">; spans: Span[] };
type Line = { value: string; start: number; end: number };

export class EditManager {
  private readonly locks = new Map<string, Promise<void>>();

  async execute(input: EditInput, options: { cwd: string; abortSignal?: AbortSignal }): Promise<EditResult> {
    validateInput(input);
    const filePath = resolveFilePath(input.filePath, options.cwd);
    const lockKey = process.platform === "win32" ? filePath.toLocaleLowerCase("en-US") : filePath;
    return this.withLock(lockKey, () => this.edit(filePath, input, options.abortSignal));
  }

  private async edit(filePath: string, input: EditInput, abortSignal?: AbortSignal): Promise<EditResult> {
    throwIfAborted(abortSignal);
    const oldText = normalizeLineEndings(input.oldText);
    const newText = normalizeLineEndings(input.newText);
    if (oldText === newText) throw new Error("edit_no_change: oldText and newText are identical after line-ending normalization");

    let source: Buffer;
    let mode = 0o600;
    try {
      const metadata = await lstat(filePath);
      if (!metadata.isFile()) throw new Error("edit_not_regular_file: filePath must reference a regular file");
      mode = metadata.mode & 0o777;
      source = await readFile(filePath);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      if (oldText !== "") throw new Error("edit_file_not_found: The file does not exist; use empty oldText to create it");
      throwIfAborted(abortSignal);
      const content = newText;
      const encoded = Buffer.from(content, "utf8");
      await atomicWrite(filePath, encoded, mode);
      const diff = createDiff(filePath, "", content, [{ start: 0, end: 0 }], content, "create");
      const stats = diffStats("", content);
      return { status: "created", filePath, strategy: "create", replacements: 1, ...stats, ...diff };
    }

    if (oldText === "") throw new Error("edit_empty_old_text: oldText cannot be empty when editing an existing file");
    const hasBom = source.subarray(0, UTF8_BOM.length).equals(UTF8_BOM);
    const bytes = hasBom ? source.subarray(UTF8_BOM.length) : source;
    let original: string;
    try {
      original = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("edit_invalid_utf8: edit only supports UTF-8 text files");
    }
    const lineEnding = detectLineEnding(original);
    const content = normalizeLineEndings(original);
    const match = findMatch(content, oldText, Boolean(input.replaceAll));
    for (const span of match.spans) assertProportionate(content.slice(span.start, span.end), oldText);

    const updated = replaceSpans(content, match.spans, newText);
    if (updated === content) throw new Error("edit_no_change: The replacement would not change the file");
    throwIfAborted(abortSignal);
    const encodedText = updated.replaceAll("\n", lineEnding);
    const encoded = Buffer.concat([hasBom ? UTF8_BOM : Buffer.alloc(0), Buffer.from(encodedText, "utf8")]);
    await atomicWrite(filePath, encoded, mode);

    const diff = createDiff(filePath, content, updated, match.spans, newText, match.strategy);
    const stats = diffStats(content, updated);
    return {
      status: "updated",
      filePath,
      strategy: match.strategy,
      replacements: match.spans.length,
      ...stats,
      ...diff,
    };
  }

  private async withLock<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release = () => {};
    const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
    const tail = previous.catch(() => {}).then(() => gate);
    this.locks.set(key, tail);
    await previous.catch(() => {});
    try {
      return await action();
    } finally {
      release();
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }
}

export function findMatch(content: string, oldText: string, replaceAll = false): MatchResult {
  const matchers: Array<[MatchResult["strategy"], (source: string, search: string) => Span[]]> = [
    ["exact", exactMatches],
    ["line-trimmed", lineTrimmedMatches],
    ["indentation-flexible", indentationFlexibleMatches],
    ["whitespace-normalized", whitespaceNormalizedMatches],
    ["block-anchor", blockAnchorMatches],
  ];
  for (const [strategy, matcher] of matchers) {
    const spans = deduplicateSpans(matcher(content, oldText));
    if (spans.length === 0) continue;
    if (strategy === "block-anchor" && spans.length !== 1) {
      throw new Error("edit_multiple_matches: Block-anchor matching requires one unique candidate; provide more surrounding context");
    }
    if (!replaceAll && spans.length !== 1) {
      throw new Error("edit_multiple_matches: Found multiple matches for oldText; provide more surrounding context or set replaceAll");
    }
    return { strategy, spans: replaceAll ? nonOverlappingSpans(spans) : [spans[0]] };
  }
  throw new Error("edit_match_not_found: Could not find oldText in the file");
}

function exactMatches(content: string, search: string): Span[] {
  const matches: Span[] = [];
  for (let start = 0; start <= content.length - search.length;) {
    const index = content.indexOf(search, start);
    if (index < 0) break;
    matches.push({ start: index, end: index + search.length });
    start = index + Math.max(1, search.length);
  }
  return matches;
}

function lineTrimmedMatches(content: string, search: string): Span[] {
  const sourceLines = lines(content);
  const searchValues = searchLines(search);
  if (searchValues.length === 0) return [];
  return lineBlockMatches(sourceLines, searchValues.length, (block) =>
    block.every((line, index) => line.value.trim() === searchValues[index].trim()));
}

function indentationFlexibleMatches(content: string, search: string): Span[] {
  const sourceLines = lines(content);
  const searchValues = trimBoundaryBlankLines(searchLines(search));
  if (searchValues.length === 0) return [];
  const normalizedSearch = removeCommonIndent(searchValues);
  return lineBlockMatches(sourceLines, searchValues.length, (block) => {
    const normalizedBlock = removeCommonIndent(block.map((line) => line.value));
    return normalizedBlock.every((line, index) => line === normalizedSearch[index]);
  });
}

function whitespaceNormalizedMatches(content: string, search: string): Span[] {
  const source = normalizeWhitespaceWithMap(content);
  const needle = normalizeWhitespaceWithMap(search).text;
  if (!needle) return [];
  return exactMatches(source.text, needle).map((span) => ({
    start: source.starts[span.start],
    end: source.ends[span.end - 1],
  }));
}

function blockAnchorMatches(content: string, search: string): Span[] {
  const sourceLines = lines(content);
  const searchValues = searchLines(search);
  if (searchValues.length < 3) return [];
  const first = searchValues[0].trim();
  const last = searchValues.at(-1)!.trim();
  const maxDelta = Math.max(1, Math.floor(searchValues.length * 0.25));
  const candidates: Span[] = [];
  for (let start = 0; start < sourceLines.length - 2; start++) {
    if (sourceLines[start].value.trim() !== first) continue;
    const minimumEnd = Math.max(start + 2, start + searchValues.length - 1 - maxDelta);
    const maximumEnd = Math.min(sourceLines.length - 1, start + searchValues.length - 1 + maxDelta);
    for (let end = minimumEnd; end <= maximumEnd; end++) {
      if (sourceLines[end].value.trim() !== last) continue;
      const block = sourceLines.slice(start, end + 1).map((line) => line.value);
      if (middleSimilarity(block, searchValues) >= BLOCK_SIMILARITY_THRESHOLD) {
        candidates.push({ start: sourceLines[start].start, end: sourceLines[end].end });
      }
    }
  }
  return candidates;
}

function lineBlockMatches(source: Line[], count: number, matches: (block: Line[]) => boolean): Span[] {
  const results: Span[] = [];
  for (let index = 0; index <= source.length - count; index++) {
    const block = source.slice(index, index + count);
    if (matches(block)) results.push({ start: block[0].start, end: block.at(-1)!.end });
  }
  return results;
}

function lines(text: string): Line[] {
  const values = text.split("\n");
  let offset = 0;
  return values.map((value) => {
    const line = { value, start: offset, end: offset + value.length };
    offset += value.length + 1;
    return line;
  });
}

function searchLines(text: string): string[] {
  const result = text.split("\n");
  if (result.at(-1) === "") result.pop();
  return result;
}

function trimBoundaryBlankLines(values: string[]): string[] {
  let start = 0;
  let end = values.length;
  while (start < end && values[start].trim() === "") start++;
  while (end > start && values[end - 1].trim() === "") end--;
  return values.slice(start, end);
}

function removeCommonIndent(values: string[]): string[] {
  const nonEmpty = values.filter((line) => line.trim() !== "");
  if (nonEmpty.length === 0) return values;
  const indent = Math.min(...nonEmpty.map((line) => line.match(/^[\t ]*/)?.[0].length ?? 0));
  return values.map((line) => line.trim() === "" ? "" : line.slice(indent));
}

function normalizeWhitespaceWithMap(text: string): { text: string; starts: number[]; ends: number[] } {
  let normalized = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let whitespaceStart: number | undefined;
  for (let index = 0; index < text.length; index++) {
    if (/\s/u.test(text[index])) {
      whitespaceStart ??= index;
      continue;
    }
    if (whitespaceStart !== undefined && normalized.length > 0) {
      normalized += " ";
      starts.push(whitespaceStart);
      ends.push(index);
    }
    whitespaceStart = undefined;
    normalized += text[index];
    starts.push(index);
    ends.push(index + 1);
  }
  return { text: normalized, starts, ends };
}

function middleSimilarity(actual: string[], expected: string[]): number {
  const actualMiddle = actual.slice(1, -1);
  const expectedMiddle = expected.slice(1, -1);
  const count = Math.max(actualMiddle.length, expectedMiddle.length);
  if (count === 0) return 1;
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (actualMiddle[index] === undefined || expectedMiddle[index] === undefined) continue;
    total += stringSimilarity(actualMiddle[index].trim(), expectedMiddle[index].trim());
  }
  return total / count;
}

function stringSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (Math.max(left.length, right.length) > 1000) return bigramSimilarity(left, right);
  const a = left;
  const b = right;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row++) {
    const current = [row];
    for (let column = 1; column <= b.length; column++) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return 1 - previous[b.length] / longest;
}

function bigramSimilarity(left: string, right: string): number {
  if (left.length < 2 || right.length < 2) return left === right ? 1 : 0;
  const counts = new Map<string, number>();
  for (let index = 0; index < left.length - 1; index++) {
    const pair = left.slice(index, index + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  let shared = 0;
  for (let index = 0; index < right.length - 1; index++) {
    const pair = right.slice(index, index + 2);
    const available = counts.get(pair) ?? 0;
    if (available > 0) {
      shared++;
      counts.set(pair, available - 1);
    }
  }
  return (2 * shared) / (left.length + right.length - 2);
}

function deduplicateSpans(spans: Span[]): Span[] {
  const unique = new Map<string, Span>();
  for (const span of spans) unique.set(`${span.start}:${span.end}`, span);
  return [...unique.values()].sort((left, right) => left.start - right.start || left.end - right.end);
}

function nonOverlappingSpans(spans: Span[]): Span[] {
  const selected: Span[] = [];
  let end = -1;
  for (const span of spans) {
    if (span.start < end) continue;
    selected.push(span);
    end = span.end;
  }
  return selected;
}

function assertProportionate(actual: string, requested: string): void {
  const actualLines = actual.split("\n").length;
  const requestedLines = requested.split("\n").length;
  if (actualLines >= Math.max(requestedLines + 3, requestedLines * 2)) {
    throw new Error("edit_match_too_large: The fuzzy match spans too many lines; re-read the file and provide more exact context");
  }
  const actualLength = actual.trim().length;
  const requestedLength = requested.trim().length;
  if (actualLength > Math.max(requestedLength + 500, requestedLength * 4)) {
    throw new Error("edit_match_too_large: The fuzzy match is much larger than oldText; re-read the file and provide more exact context");
  }
}

function replaceSpans(content: string, spans: Span[], replacement: string): string {
  let result = content;
  for (const span of [...spans].sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, span.start)}${replacement}${result.slice(span.end)}`;
  }
  return result;
}

function createDiff(filePath: string, before: string, after: string, spans: Span[], replacement: string, strategy: EditStrategy): { diff: string; diffTruncated: boolean } {
  const displayPath = filePath.replaceAll("\\", "/");
  const hunks = spans.map((span, index) => {
    const line = before.slice(0, span.start).split("\n").length;
    const removed = before.slice(span.start, span.end).split("\n").map((value) => `-${value}`).join("\n");
    const added = replacement.split("\n").map((value) => `+${value}`).join("\n");
    return `@@ replacement ${index + 1} · line ${line} · ${strategy} @@\n${removed}\n${added}`;
  });
  const full = `--- ${before === "" ? "/dev/null" : displayPath}\n+++ ${displayPath}\n${hunks.join("\n")}`;
  if (full.length <= MAX_DIFF_CHARS) return { diff: full, diffTruncated: false };
  const half = Math.floor((MAX_DIFF_CHARS - 48) / 2);
  return { diff: `${full.slice(0, half)}\n... diff truncated ...\n${full.slice(-half)}`, diffTruncated: true };
}

function diffStats(before: string, after: string): { additions: number; deletions: number } {
  const left = logicalLines(before);
  const right = logicalLines(after);
  if (left.length * right.length > 4_000_000) {
    let prefix = 0;
    while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
    let suffix = 0;
    while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix++;
    return { deletions: left.length - prefix - suffix, additions: right.length - prefix - suffix };
  }
  let previous = new Uint32Array(right.length + 1);
  for (const leftLine of left) {
    const current = new Uint32Array(right.length + 1);
    for (let index = 1; index <= right.length; index++) {
      current[index] = leftLine === right[index - 1] ? previous[index - 1] + 1 : Math.max(previous[index], current[index - 1]);
    }
    previous = current;
  }
  const common = previous[right.length];
  return { additions: right.length - common, deletions: left.length - common };
}

function logicalLines(text: string): string[] {
  if (text === "") return [];
  const result = text.split("\n");
  if (result.at(-1) === "") result.pop();
  return result;
}

function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function detectLineEnding(text: string): "\r\n" | "\r" | "\n" {
  if (text.includes("\r\n")) return "\r\n";
  if (text.includes("\r")) return "\r";
  return "\n";
}

function validateInput(input: EditInput): void {
  if (!input.filePath?.trim()) throw new Error("edit_invalid_input: filePath is required");
  if (typeof input.oldText !== "string" || typeof input.newText !== "string") throw new Error("edit_invalid_input: oldText and newText must be strings");
  if (input.replaceAll !== undefined && typeof input.replaceAll !== "boolean") throw new Error("edit_invalid_input: replaceAll must be a boolean");
}

function resolveFilePath(filePath: string, cwd: string): string {
  const resolved = resolve(isAbsolute(filePath) ? filePath : resolve(cwd, filePath));
  if (!isAbsolute(resolved)) throw new Error("edit_invalid_path: filePath must resolve to an absolute path");
  return resolved;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("edit_cancelled: The edit was cancelled before the atomic write");
}

async function atomicWrite(filePath: string, content: Buffer, mode: number): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", mode);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, filePath);
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}
