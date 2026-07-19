import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_YIELD_TIME_MS = 10_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_ENCODED_ARGUMENT_LENGTH = 24_000;

export type ShellInput = {
  command?: string;
  cwd?: string;
  timeoutMs?: number;
  yieldTimeMs?: number;
  maxOutputBytes?: number;
  processId?: string;
  action?: "poll" | "write" | "kill";
  stdin?: string;
  closeStdin?: boolean;
};

export type ShellResult = {
  status: "running" | "completed" | "timed_out" | "cancelled" | "failed";
  processId: string;
  output: string;
  originalBytes: number;
  truncated: boolean;
  exitCode: number | null;
  durationMs: number;
  error?: string;
};

type FinishedState = Pick<ShellResult, "status" | "exitCode" | "error">;
type OutputSnapshot = { exact?: Buffer; head?: Buffer; tail?: Buffer; total: number };

type RunningProcess = {
  id: string;
  child: ChildProcessWithoutNullStreams;
  startedAt: number;
  stdout: OutputWindow;
  stderr: OutputWindow;
  completion: Promise<FinishedState>;
  finished?: FinishedState;
  timeout?: ReturnType<typeof setTimeout>;
  tempDir?: string;
  cancelled: boolean;
  timedOut: boolean;
};

export class ShellManager {
  private readonly processes = new Map<string, RunningProcess>();

  async execute(input: ShellInput, options: { cwd: string; abortSignal?: AbortSignal }): Promise<ShellResult> {
    const maxOutputBytes = boundedInteger(input.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, 1024, MAX_OUTPUT_BYTES, "maxOutputBytes");
    const yieldTimeMs = boundedInteger(input.yieldTimeMs, DEFAULT_YIELD_TIME_MS, 0, 30_000, "yieldTimeMs");

    if (input.processId) {
      if (input.command !== undefined) throw new Error("shell_invalid_input: command and processId cannot be used together");
      return this.continue(input, yieldTimeMs, maxOutputBytes, options.abortSignal);
    }
    if (!input.command?.trim()) throw new Error("shell_invalid_input: command is required when processId is absent");
    if (input.action || input.stdin !== undefined || input.closeStdin !== undefined) {
      throw new Error("shell_invalid_input: action, stdin, and closeStdin require processId");
    }

    const cwd = resolveCwd(input.cwd ?? options.cwd);
    const timeoutMs = boundedInteger(input.timeoutMs, DEFAULT_TIMEOUT_MS, 1, 24 * 60 * 60 * 1000, "timeoutMs");
    const running = await this.start(input.command, cwd, timeoutMs, maxOutputBytes, options.abortSignal);
    const finished = await settleWithin(running, yieldTimeMs);
    return this.result(running, finished, maxOutputBytes);
  }

  async cancelAll(): Promise<void> {
    await Promise.all([...this.processes.values()].map((process) => this.terminate(process, "cancelled")));
  }

  private async continue(input: ShellInput, yieldTimeMs: number, maxOutputBytes: number, abortSignal?: AbortSignal): Promise<ShellResult> {
    const running = this.processes.get(input.processId!);
    if (!running) throw new Error("shell_process_not_found: The shell process no longer exists");
    if (input.action === "kill") await this.terminate(running, "cancelled");
    if (input.stdin !== undefined) {
      if (running.finished) throw new Error("shell_process_completed: Cannot write to a completed shell process");
      running.child.stdin.write(Buffer.from(input.stdin, "utf8"));
    }
    if (input.closeStdin && !running.child.stdin.destroyed) running.child.stdin.end();
    const finished = running.finished ?? await settleWithin(running, yieldTimeMs);
    return this.result(running, finished, maxOutputBytes);
  }

  private async start(command: string, cwd: string, timeoutMs: number, maxOutputBytes: number, abortSignal?: AbortSignal): Promise<RunningProcess> {
    const script = powershellScript(command);
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    let args: string[];
    let tempDir: string | undefined;
    if (encoded.length <= MAX_ENCODED_ARGUMENT_LENGTH) {
      args = ["-NoLogo", "-NonInteractive", "-EncodedCommand", encoded];
    } else {
      tempDir = await mkdtemp(join(tmpdir(), "nyan-shell-"));
      const scriptPath = join(tempDir, "command.ps1");
      await writeFile(scriptPath, script, { encoding: "utf8", mode: 0o600 });
      args = ["-NoLogo", "-NonInteractive", "-File", scriptPath];
    }

    const env = shellEnvironment(process.env);
    const child = spawn("pwsh.exe", args, { cwd, env, windowsHide: true, stdio: "pipe" });
    const running: RunningProcess = {
      id: crypto.randomUUID(),
      child,
      startedAt: Date.now(),
      stdout: new OutputWindow(maxOutputBytes),
      stderr: new OutputWindow(maxOutputBytes),
      completion: Promise.resolve({ status: "failed", exitCode: null } as FinishedState),
      tempDir,
      cancelled: false,
      timedOut: false,
    };
    running.completion = new Promise<FinishedState>((resolveCompletion) => {
      let settled = false;
      const finish = (state: FinishedState) => {
        if (settled) return;
        settled = true;
        running.finished = state;
        if (running.timeout) clearTimeout(running.timeout);
        if (running.tempDir) void rm(running.tempDir, { recursive: true, force: true });
        resolveCompletion(state);
      };
      child.once("error", (error) => finish({ status: "failed", exitCode: null, error: error.message }));
      child.once("close", (code) => finish({
        status: running.timedOut ? "timed_out" : running.cancelled ? "cancelled" : "completed",
        exitCode: code,
      }));
    });
    child.stdout.on("data", (chunk: Buffer) => running.stdout.append(chunk));
    child.stderr.on("data", (chunk: Buffer) => running.stderr.append(chunk));
    running.timeout = setTimeout(() => { void this.terminate(running, "timed_out"); }, timeoutMs);
    running.timeout.unref?.();
    if (abortSignal) {
      const cancel = () => { void this.terminate(running, "cancelled"); };
      if (abortSignal.aborted) cancel();
      else abortSignal.addEventListener("abort", cancel, { once: true });
      void running.completion.finally(() => abortSignal.removeEventListener("abort", cancel));
    }
    this.processes.set(running.id, running);
    return running;
  }

  private async terminate(running: RunningProcess, reason: "cancelled" | "timed_out"): Promise<void> {
    if (running.finished) return;
    running.cancelled = reason === "cancelled";
    running.timedOut = reason === "timed_out";
    if (running.child.pid && process.platform === "win32") {
      await new Promise<void>((resolveTaskkill) => {
        const killer = spawn("taskkill.exe", ["/pid", String(running.child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
        killer.once("error", () => { running.child.kill(); resolveTaskkill(); });
        killer.once("exit", (code) => {
          if (code !== 0 && !running.finished) running.child.kill();
          resolveTaskkill();
        });
      });
    } else {
      running.child.kill("SIGKILL");
    }
    await running.completion;
  }

  private result(running: RunningProcess, finished: FinishedState | undefined, maxOutputBytes: number): ShellResult {
    const stdout = running.stdout.snapshot(true);
    const stderr = running.stderr.snapshot(true);
    const rendered = renderOutput(stdout, stderr, maxOutputBytes);
    if (finished) this.processes.delete(running.id);
    return {
      status: finished?.status ?? "running",
      processId: running.id,
      output: rendered.output,
      originalBytes: rendered.originalBytes,
      truncated: rendered.truncated,
      exitCode: finished?.exitCode ?? null,
      durationMs: Date.now() - running.startedAt,
      ...(finished?.error ? { error: finished.error } : {}),
    };
  }
}

class OutputWindow {
  private exact = Buffer.alloc(0);
  private head?: Buffer;
  private tail?: Buffer;
  private total = 0;

  constructor(private readonly storageBytes: number) {}

  append(chunk: Buffer): void {
    if (chunk.length === 0) return;
    this.total += chunk.length;
    if (!this.head && this.exact.length + chunk.length <= this.storageBytes) {
      this.exact = Buffer.concat([this.exact, chunk]);
      return;
    }
    const combined = this.head ? chunk : Buffer.concat([this.exact, chunk]);
    const headBytes = Math.floor(this.storageBytes / 2);
    const tailBytes = this.storageBytes - headBytes;
    if (!this.head) {
      this.head = combined.subarray(0, headBytes);
      this.exact = Buffer.alloc(0);
      this.tail = combined.subarray(Math.max(headBytes, combined.length - tailBytes));
    } else {
      this.tail = Buffer.concat([this.tail ?? Buffer.alloc(0), combined]).subarray(-tailBytes);
    }
  }

  snapshot(reset: boolean): OutputSnapshot {
    const result = this.head
      ? { head: this.head, tail: this.tail ?? Buffer.alloc(0), total: this.total }
      : { exact: this.exact, total: this.total };
    if (reset) {
      this.exact = Buffer.alloc(0);
      this.head = undefined;
      this.tail = undefined;
      this.total = 0;
    }
    return result;
  }
}

function powershellScript(command: string): string {
  return [
    "$nyanUtf8 = [System.Text.UTF8Encoding]::new($false)",
    "[Console]::InputEncoding = $nyanUtf8",
    "[Console]::OutputEncoding = $nyanUtf8",
    "$OutputEncoding = $nyanUtf8",
    "& {",
    command,
    "}",
  ].join("\n");
}

export function shellEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...source,
    TERM: "dumb",
    NYAN_AGENT: "1",
    NO_COLOR: "1",
    COLORTERM: "",
    PAGER: "cat",
    GIT_PAGER: "cat",
    GH_PAGER: "cat",
    PYTHONIOENCODING: source.PYTHONIOENCODING ?? "utf-8",
  };
}

function resolveCwd(value: string): string {
  const cwd = resolve(value);
  if (!isAbsolute(cwd)) throw new Error("shell_invalid_cwd: cwd must resolve to an absolute path");
  return cwd;
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new Error(`shell_invalid_input: ${name} must be an integer between ${min} and ${max}`);
  }
  return resolved;
}

async function settleWithin(running: RunningProcess, yieldTimeMs: number): Promise<FinishedState | undefined> {
  if (running.finished) return running.finished;
  if (yieldTimeMs === 0) return undefined;
  return Promise.race([
    running.completion,
    new Promise<undefined>((resolveYield) => setTimeout(resolveYield, yieldTimeMs)),
  ]);
}

function renderOutput(stdout: OutputSnapshot, stderr: OutputSnapshot, maxBytes: number): { output: string; originalBytes: number; truncated: boolean } {
  const originalBytes = stdout.total + stderr.total;
  if (originalBytes === 0) return { output: "", originalBytes: 0, truncated: false };
  let stdoutBudget = stdout.total === 0 ? 0 : maxBytes;
  let stderrBudget = stderr.total === 0 ? 0 : maxBytes;
  if (stdout.total > 0 && stderr.total > 0 && originalBytes > maxBytes) {
    stderrBudget = Math.min(stderr.total, Math.ceil(maxBytes * 0.6));
    stdoutBudget = Math.min(stdout.total, maxBytes - stderrBudget);
    const unused = maxBytes - stdoutBudget - stderrBudget;
    if (unused > 0) {
      const stderrNeed = Math.max(0, stderr.total - stderrBudget);
      const giveStderr = Math.min(unused, stderrNeed);
      stderrBudget += giveStderr;
      stdoutBudget += unused - giveStderr;
    }
  }
  const stdoutBuffer = renderSnapshot(stdout, stdoutBudget);
  const stderrBuffer = renderSnapshot(stderr, stderrBudget);
  const combined = Buffer.concat([stdoutBuffer, stderrBuffer]);
  return { output: combined.toString("utf8"), originalBytes, truncated: originalBytes > combined.length };
}

function renderSnapshot(snapshot: OutputSnapshot, budget: number): Buffer {
  if (budget <= 0 || snapshot.total === 0) return Buffer.alloc(0);
  if (snapshot.exact && snapshot.exact.length <= budget) return snapshot.exact;
  const sourceHead = snapshot.exact ?? snapshot.head ?? Buffer.alloc(0);
  const sourceTail = snapshot.exact ?? snapshot.tail ?? Buffer.alloc(0);
  let omitted = snapshot.total;
  let marker: Buffer = Buffer.alloc(0);
  let head: Buffer = Buffer.alloc(0);
  let tail: Buffer = Buffer.alloc(0);
  for (let attempt = 0; attempt < 4; attempt++) {
    marker = Buffer.from(`\n... omitted ${omitted} bytes ...\n`, "utf8");
    const retained = Math.max(0, budget - marker.length);
    head = utf8Head(sourceHead, Math.floor(retained / 2));
    tail = utf8Tail(sourceTail, retained - Math.floor(retained / 2));
    const actualOmitted = Math.max(0, snapshot.total - head.length - tail.length);
    if (actualOmitted === omitted) break;
    omitted = actualOmitted;
  }
  marker = Buffer.from(`\n... omitted ${omitted} bytes ...\n`, "utf8");
  return Buffer.concat([head, marker, tail]).subarray(0, budget);
}

function utf8Head(buffer: Buffer, bytes: number): Buffer {
  let end = Math.min(bytes, buffer.length);
  while (end > 0 && end < buffer.length && (buffer[end] & 0xc0) === 0x80) end--;
  return buffer.subarray(0, end);
}

function utf8Tail(buffer: Buffer, bytes: number): Buffer {
  let start = Math.max(0, buffer.length - bytes);
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start++;
  return buffer.subarray(start);
}
