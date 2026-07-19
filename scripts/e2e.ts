import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const workspace = resolve(import.meta.dir, "..");
const testRoot = await mkdtemp(join(tmpdir(), "nyan-e2e-"));
const projectId = "50000000-0000-4000-8000-000000000001";
const projectName = "e2e-workspace";
const projectPath = join(testRoot, projectName);
const configHome = join(testRoot, "config");
const dataHome = join(testRoot, "data");
const stateHome = join(testRoot, "state");
const cacheHome = join(testRoot, "cache");
const stateFile = join(stateHome, "nyan", "state.json");
const fakeBin = join(testRoot, "fake-bin");
const recoverySessionId = "60000000-0000-4000-8000-000000000001";
const recoveryTurnId = "70000000-0000-4000-8000-000000000001";
const recoveryTitle = "E2E recovery task";
const sessionsDir = join(dataHome, "nyan", "sessions");
const recoverySessionDir = join(sessionsDir, recoverySessionId);
const faultAgentEntry = resolve(workspace, "e2e/fixtures/fault-agent.ts");

try {
  await Promise.all([
    mkdir(join(configHome, "nyan"), { recursive: true }),
    mkdir(join(dataHome, "nyan"), { recursive: true }),
    mkdir(join(stateHome, "nyan"), { recursive: true }),
    mkdir(cacheHome, { recursive: true }),
    mkdir(fakeBin, { recursive: true }),
    mkdir(projectPath, { recursive: true }),
    mkdir(recoverySessionDir, { recursive: true }),
  ]);
  const now = "2026-07-19T00:00:00.000Z";
  await Promise.all([
    writeFile(join(configHome, "nyan", "config.toml"), [
      "version = 1",
      'default_model = "e2e/model"',
      "",
      "[[providers]]",
      'id = "e2e"',
      'kind = "openai-compatible"',
      'base_url = "https://example.invalid/v1"',
      'api_key = "e2e-not-a-secret"',
      'models = ["model"]',
      "",
    ].join("\n"), "utf8"),
    writeFile(join(dataHome, "nyan", "projects.json"), JSON.stringify({
      version: 1,
      projects: [{ id: projectId, name: projectName, path: projectPath, createdAt: now, updatedAt: now }],
    }), "utf8"),
    writeFile(stateFile, JSON.stringify({ version: 1, recentProjectId: projectId }), "utf8"),
    writeFile(join(recoverySessionDir, "meta.json"), JSON.stringify({
      version: 1,
      id: recoverySessionId,
      projectId,
      cwd: projectPath,
      title: recoveryTitle,
      model: "e2e/model",
      status: "running",
      activeTurnId: recoveryTurnId,
      createdAt: now,
      updatedAt: now,
    }), "utf8"),
    writeFile(join(recoverySessionDir, "transcript.jsonl"), [
      JSON.stringify({ schemaVersion: 1, seq: 0, createdAt: now, kind: "turn.started", payload: {}, turnId: recoveryTurnId }),
      "{not valid json}",
      JSON.stringify({ schemaVersion: 1, seq: 1, createdAt: now, kind: "assistant.block", payload: { itemId: "e2e-recovered-block", text: "still here" }, turnId: recoveryTurnId }),
      "",
    ].join("\n"), "utf8"),
  ]);

  const environment = {
    ...process.env,
    XDG_CONFIG_HOME: configHome,
    XDG_DATA_HOME: dataHome,
    XDG_STATE_HOME: stateHome,
    XDG_CACHE_HOME: cacheHome,
    NYAN_E2E_PROJECT_ID: projectId,
    NYAN_E2E_PROJECT_NAME: projectName,
    NYAN_E2E_PROJECT_PATH: projectPath,
    NYAN_E2E_STATE_FILE: stateFile,
    NYAN_E2E_FAKE_BIN: fakeBin,
    NYAN_E2E_BUN_SOURCE: process.execPath,
    NYAN_E2E_RECOVERY_TITLE: recoveryTitle,
  };
  await run(["bun", "run", "e2e:build"], environment);
  const nodeExecutable = await output(["mise", "which", "node"], process.env);
  await run([nodeExecutable, "node_modules/@wdio/cli/bin/wdio.js", "run", "e2e/wdio.conf.ts"], environment);
  await run([nodeExecutable, "node_modules/@wdio/cli/bin/wdio.js", "run", "e2e/wdio.conf.ts"], {
    ...environment,
    NYAN_E2E_MISSING_BUN: "1",
  });
  for (const scenario of ["crash", "invalid-protocol"] as const) {
    await run([nodeExecutable, "node_modules/@wdio/cli/bin/wdio.js", "run", "e2e/wdio.conf.ts"], {
      ...environment,
      NYAN_E2E_SCENARIO: scenario,
      NYAN_E2E_AGENT_ENTRY: faultAgentEntry,
    });
  }
  const invalidConfigHome = join(testRoot, "invalid-config");
  await mkdir(join(invalidConfigHome, "nyan"), { recursive: true });
  await writeFile(join(invalidConfigHome, "nyan", "config.toml"), "version = definitely-invalid\n", "utf8");
  await run([nodeExecutable, "node_modules/@wdio/cli/bin/wdio.js", "run", "e2e/wdio.conf.ts"], {
    ...environment,
    XDG_CONFIG_HOME: invalidConfigHome,
    NYAN_E2E_SCENARIO: "config-invalid",
  });
} finally {
  if (dirname(testRoot) === tmpdir() && basename(testRoot).startsWith("nyan-e2e-")) {
    await rm(testRoot, { recursive: true, force: true });
  }
}

async function run(command: string[], env: Record<string, string | undefined>): Promise<void> {
  const child = Bun.spawn(command, { cwd: workspace, env, stdout: "inherit", stderr: "inherit" });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`${command.join(" ")} exited with code ${exitCode}`);
}

async function output(command: string[], env: Record<string, string | undefined>): Promise<string> {
  const child = Bun.spawn(command, { cwd: workspace, env, stdout: "pipe", stderr: "inherit" });
  const [text, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`${command.join(" ")} exited with code ${exitCode}`);
  return text.trim();
}
