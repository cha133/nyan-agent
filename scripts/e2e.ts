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

try {
  await Promise.all([
    mkdir(join(configHome, "nyan"), { recursive: true }),
    mkdir(join(dataHome, "nyan"), { recursive: true }),
    mkdir(join(stateHome, "nyan"), { recursive: true }),
    mkdir(cacheHome, { recursive: true }),
    mkdir(projectPath, { recursive: true }),
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
  };
  await run(["bun", "run", "e2e:build"], environment);
  const nodeExecutable = await output(["mise", "which", "node"], process.env);
  await run([nodeExecutable, "node_modules/@wdio/cli/bin/wdio.js", "run", "e2e/wdio.conf.ts"], environment);
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
