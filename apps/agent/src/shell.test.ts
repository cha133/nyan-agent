import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ShellManager, shellEnvironment } from "./shell";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function tempCwd(name = "中文 workspace"): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "nyan-shell-test-"));
  const cwd = join(parent, name);
  await mkdir(cwd);
  await Bun.write(join(cwd, ".keep"), "");
  tempDirectories.push(parent);
  return cwd;
}

describe("shell manager", () => {
  test("runs PowerShell through one encoded UTF-8 wrapper", async () => {
    const manager = new ShellManager();
    const cwd = await tempCwd();
    const result = await manager.execute({
      command: "[Console]::Out.Write(\"你好 'nyan'\"); [Console]::Error.Write('错误')",
      yieldTimeMs: 5_000,
    }, { cwd });

    expect(result.status).toBe("completed");
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("你好 'nyan'");
    expect(result.output).toContain("错误");
    expect(result.truncated).toBe(false);
  });

  test("falls back to a UTF-8 script file for long commands", async () => {
    const manager = new ShellManager();
    const padding = `# ${"猫".repeat(10_000)}`;
    const result = await manager.execute({ command: `${padding}\n[Console]::Out.Write('LONG_OK')`, yieldTimeMs: 5_000 }, { cwd: await tempCwd() });
    expect(result).toMatchObject({ status: "completed", exitCode: 0, output: "LONG_OK" });
  });

  test("pipes Chinese stdin to Python and decodes Python stdout as UTF-8", async () => {
    const manager = new ShellManager();
    const result = await manager.execute({
      command: "'中文' | python -c \"import sys; print(sys.stdin.read().strip() + '输出')\"",
      yieldTimeMs: 5_000,
    }, { cwd: await tempCwd() });
    expect(result).toMatchObject({ status: "completed", exitCode: 0 });
    expect(result.output.trim()).toBe("中文输出");
  });

  test("keeps head and tail within a UTF-8 byte budget", async () => {
    const manager = new ShellManager();
    const result = await manager.execute({
      command: "[Console]::Out.Write(('头' * 1000) + ('尾' * 1000))",
      maxOutputBytes: 1024,
      yieldTimeMs: 5_000,
    }, { cwd: await tempCwd() });

    expect(result.originalBytes).toBe(6000);
    expect(result.truncated).toBe(true);
    expect(result.output).toContain("omitted");
    expect(result.output).toStartWith("头");
    expect(result.output).toEndWith("尾");
    expect(Buffer.byteLength(result.output, "utf8")).toBeLessThanOrEqual(1024);
  });

  test("returns a handle and polls only new output", async () => {
    const manager = new ShellManager();
    const started = await manager.execute({
      command: "[Console]::Out.Write('start'); Start-Sleep -Milliseconds 700; [Console]::Out.Write('end')",
      yieldTimeMs: 100,
    }, { cwd: await tempCwd() });
    expect(started.status).toBe("running");

    const completed = await manager.execute({ processId: started.processId, action: "poll", yieldTimeMs: 5_000 }, { cwd: "C:\\" });
    expect(completed.status).toBe("completed");
    expect(`${started.output}${completed.output}`).toContain("startend");
    expect(completed.output).not.toStartWith(started.output || "__no_match__");
  });

  test("times out and kills the process tree", async () => {
    const manager = new ShellManager();
    const cwd = await tempCwd();
    const marker = join(cwd, "child-survived.txt");
    const childScript = `Start-Sleep -Seconds 2\n[IO.File]::WriteAllText('${marker.replaceAll("'", "''")}', 'survived')`;
    const encodedChild = Buffer.from(childScript, "utf16le").toString("base64");
    const command = `Start-Process -FilePath 'pwsh.exe' -ArgumentList @('-NoLogo','-NonInteractive','-EncodedCommand','${encodedChild}'); Start-Sleep -Seconds 30`;
    const result = await manager.execute({ command, timeoutMs: 500, yieldTimeMs: 5_000 }, { cwd });
    expect(result.status).toBe("timed_out");
    expect(result.durationMs).toBeLessThan(5_000);
    await Bun.sleep(2_500);
    expect(await access(marker).then(() => true, () => false)).toBe(false);
  });

  test("cascades an abort signal to a running process", async () => {
    const manager = new ShellManager();
    const controller = new AbortController();
    const started = await manager.execute({ command: "Start-Sleep -Seconds 30", yieldTimeMs: 0 }, { cwd: await tempCwd(), abortSignal: controller.signal });
    controller.abort();
    const result = await manager.execute({ processId: started.processId, action: "poll", yieldTimeMs: 5_000 }, { cwd: "C:\\" });
    expect(result.status).toBe("cancelled");
  });

  test("sets non-interactive environment without overriding Python encoding", () => {
    expect(shellEnvironment({ PYTHONIOENCODING: "utf-8:surrogateescape" })).toMatchObject({
      TERM: "dumb",
      NYAN_AGENT: "1",
      NO_COLOR: "1",
      COLORTERM: "",
      PAGER: "cat",
      PYTHONIOENCODING: "utf-8:surrogateescape",
    });
    expect(shellEnvironment({}).PYTHONIOENCODING).toBe("utf-8");
  });

  test("preserves a failing command exit code", async () => {
    const manager = new ShellManager();
    const result = await manager.execute({ command: "[Console]::Error.Write('失败'); exit 7", yieldTimeMs: 5_000 }, { cwd: await tempCwd() });
    expect(result).toMatchObject({ status: "completed", exitCode: 7, output: "失败" });
  });
});
