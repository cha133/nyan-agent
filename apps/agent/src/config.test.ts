import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, parseConfig } from "./config";
import { ModelCatalog, discoverProviderModels } from "./models";
import { resolveNyanPaths } from "./paths";
import { ProviderRegistry } from "./providers";
import { RuntimeStateStore } from "./state";
import type { ProjectId } from "@nyan/protocol";

const rawConfig = {
  version: 1,
  default_model: "openai-main/static-model",
  model_cache_ttl_seconds: 60,
  providers: [{
    id: "openai-main",
    kind: "openai-compatible",
    base_url: "https://example.test/v1",
    api_key: "secret",
    models: ["static-model"],
    discover_models: true,
  }],
};

describe("paths and config", () => {
  test("uses XDG parent directories and appends nyan", () => {
    const paths = resolveNyanPaths({ XDG_CONFIG_HOME: "C:\\cfg", XDG_DATA_HOME: "C:\\data", XDG_STATE_HOME: "C:\\state", XDG_CACHE_HOME: "C:\\cache" }, "C:\\home");
    expect(paths.configFile).toBe(join("C:\\cfg", "nyan", "config.toml"));
    expect(paths.sessionsDir).toBe(join("C:\\data", "nyan", "sessions"));
  });

  test("validates config and creates both provider kinds", () => {
    const config = parseConfig({
      ...rawConfig,
      providers: [
        rawConfig.providers[0],
        { id: "anthropic-main", kind: "anthropic-compatible", base_url: "https://anthropic.test/v1", auth_token: "token", models: ["claude-test"] },
      ],
    });
    const registry = new ProviderRegistry(config);
    const openaiModel = registry.model("openai-main/static-model") as { modelId: string };
    const anthropicModel = registry.model("anthropic-main/claude-test") as { provider: string };
    expect(openaiModel.modelId).toBe("static-model");
    expect(anthropicModel.provider).toContain("anthropic-main");
  });

  test("rejects duplicate providers and ambiguous Anthropic auth", () => {
    expect(() => parseConfig({ ...rawConfig, providers: [rawConfig.providers[0], rawConfig.providers[0]] })).toThrow("duplicate provider id");
    expect(() => parseConfig({ ...rawConfig, providers: [{ id: "anthropic", kind: "anthropic-compatible", base_url: "https://example.test" }] })).toThrow("exactly one");
  });

  test("does not expose credential text from malformed TOML", async () => {
    const root = await mkdtemp(join(tmpdir(), "nyan-config-"));
    const paths = resolveNyanPaths({ XDG_CONFIG_HOME: join(root, "cfg") }, root);
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(paths.configFile, 'api_key = "super-secret"\ninvalid = [', "utf8");
    await expect(loadConfig(paths)).rejects.not.toThrow("super-secret");
  });
});

describe("model discovery and cache", () => {
  test("discovers, merges, caches, and selects the default model", async () => {
    const root = await mkdtemp(join(tmpdir(), "nyan-models-"));
    const paths = resolveNyanPaths({ XDG_CONFIG_HOME: join(root, "cfg"), XDG_DATA_HOME: join(root, "data"), XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache") }, root);
    const config = parseConfig(rawConfig);
    const requests: Request[] = [];
    const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Response.json({ data: [{ id: "dynamic-model" }, { id: "static-model" }] });
    };
    const catalog = new ModelCatalog(config, paths, fetchImpl, () => new Date("2026-01-01T00:00:00Z"));
    const models = await catalog.list({ refresh: true });
    expect(models.map((model) => model.key)).toEqual(["openai-main/static-model", "openai-main/dynamic-model"]);
    expect(await catalog.selectedModel(models)).toBe("openai-main/static-model");
    const state = new RuntimeStateStore(paths);
    const projectId = crypto.randomUUID() as ProjectId;
    await state.update({ recentProjectId: projectId });
    await catalog.rememberModel("openai-main/dynamic-model");
    expect(await catalog.selectedModel(models)).toBe("openai-main/dynamic-model");
    expect(await state.read()).toMatchObject({ recentModel: "openai-main/dynamic-model", recentProjectId: projectId });
    expect(requests[0].headers.get("authorization")).toBe("Bearer secret");
    expect(JSON.parse(await readFile(paths.modelCacheFile, "utf8")).providers[0].models).toEqual(["dynamic-model", "static-model"]);
  });

  test("parses alternate models response shapes", async () => {
    const provider = parseConfig(rawConfig).providers[0];
    const models = await discoverProviderModels(provider, async () => Response.json({ models: ["one", { id: "two" }, { nope: true }] }));
    expect(models).toEqual(["one", "two"]);
  });
});
