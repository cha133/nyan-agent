import type { NyanConfig, ProviderConfig } from "./config";
import { atomicWriteJson, readJsonFile } from "./files";
import type { NyanPaths } from "./paths";
import { modelKey } from "./providers";
import { RuntimeStateStore } from "./state";

type CacheEntry = { providerId: string; fetchedAt: string; expiresAt: string; models: string[] };
type ModelCache = { version: 1; providers: CacheEntry[] };
export type AvailableModel = {
  key: string;
  providerId: string;
  modelId: string;
  source: "static" | "discovered";
  stale: boolean;
};

export type FetchLike = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

export class ModelCatalog {
  private readonly state: RuntimeStateStore;

  constructor(
    private readonly config: NyanConfig,
    private readonly paths: NyanPaths,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => Date = () => new Date(),
    state?: RuntimeStateStore,
  ) {
    this.state = state ?? new RuntimeStateStore(paths);
  }

  async list(options: { refresh?: boolean } = {}): Promise<AvailableModel[]> {
    const cache = (await readJsonFile<ModelCache>(this.paths.modelCacheFile)) ?? { version: 1, providers: [] };
    const entries = new Map(cache.providers.map((entry) => [entry.providerId, entry]));
    if (options.refresh) {
      await this.refresh(entries);
    } else {
      const needsInitial = this.config.providers.some((provider) => provider.discoverModels && provider.models.length === 0 && !entries.has(provider.id));
      if (needsInitial) await this.refresh(entries);
      else void this.refreshStaleInBackground(entries);
    }
    return this.merge(entries);
  }

  async selectedModel(models?: AvailableModel[]): Promise<string> {
    models ??= await this.list();
    if (models.length === 0) throw new Error("model_not_configured: no static or discovered models are available");
    const valid = new Set(models.map((model) => model.key));
    const state = await this.state.read();
    if (state?.recentModel && valid.has(state.recentModel)) return state.recentModel;
    if (this.config.defaultModel && valid.has(this.config.defaultModel)) return this.config.defaultModel;
    return models[0].key;
  }

  async rememberModel(key: string): Promise<void> {
    await this.state.update({ recentModel: key });
  }

  private async refresh(entries: Map<string, CacheEntry>): Promise<void> {
    const results = await Promise.allSettled(this.config.providers.filter((provider) => provider.discoverModels).map(async (provider) => {
      const models = await discoverProviderModels(provider, this.fetchImpl);
      const fetchedAt = this.now();
      entries.set(provider.id, {
        providerId: provider.id,
        fetchedAt: fetchedAt.toISOString(),
        expiresAt: new Date(fetchedAt.getTime() + this.config.modelCacheTtlSeconds * 1000).toISOString(),
        models,
      });
    }));
    if (results.some((result) => result.status === "fulfilled")) {
      await atomicWriteJson(this.paths.modelCacheFile, { version: 1, providers: [...entries.values()] } satisfies ModelCache);
    }
    const firstFailure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    const hasAnyModels = this.merge(entries).length > 0;
    if (firstFailure && !hasAnyModels) throw firstFailure.reason;
  }

  private async refreshStaleInBackground(entries: Map<string, CacheEntry>): Promise<void> {
    const now = this.now().getTime();
    const stale = this.config.providers.some((provider) => provider.discoverModels && (!entries.get(provider.id) || Date.parse(entries.get(provider.id)!.expiresAt) <= now));
    if (stale) await this.refresh(entries).catch((error) => console.error(`[models] background refresh failed: ${error instanceof Error ? error.message : String(error)}`));
  }

  private merge(entries: Map<string, CacheEntry>): AvailableModel[] {
    const now = this.now().getTime();
    const output: AvailableModel[] = [];
    const seen = new Set<string>();
    for (const provider of this.config.providers) {
      for (const modelId of provider.models) {
        const key = modelKey(provider.id, modelId);
        if (!seen.has(key)) output.push({ key, providerId: provider.id, modelId, source: "static", stale: false });
        seen.add(key);
      }
      const cached = entries.get(provider.id);
      if (!cached) continue;
      for (const modelId of cached.models) {
        const key = modelKey(provider.id, modelId);
        if (!seen.has(key)) output.push({ key, providerId: provider.id, modelId, source: "discovered", stale: Date.parse(cached.expiresAt) <= now });
        seen.add(key);
      }
    }
    return output;
  }
}

export async function discoverProviderModels(provider: ProviderConfig, fetchImpl: FetchLike = fetch): Promise<string[]> {
  const url = provider.discoveryUrl ?? `${provider.baseUrl}/models`;
  const headers = new Headers({ ...provider.headers, ...provider.discoveryHeaders });
  if (provider.kind === "anthropic-compatible") {
    if (provider.apiKey && !headers.has("x-api-key")) headers.set("x-api-key", provider.apiKey);
    if (provider.authToken && !headers.has("authorization")) headers.set("authorization", `Bearer ${provider.authToken}`);
    if (!headers.has("anthropic-version")) headers.set("anthropic-version", "2023-06-01");
  } else if (provider.apiKey && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${provider.apiKey}`);
  }
  const response = await fetchImpl(url, { headers });
  if (!response.ok) throw new Error(`model_discovery_failed: ${provider.id} returned HTTP ${response.status}`);
  const body = await response.json() as { data?: Array<{ id?: unknown }>; models?: Array<{ id?: unknown } | string> };
  const candidates = body.data ?? body.models ?? [];
  return [...new Set(candidates.map((entry) => typeof entry === "string" ? entry : entry.id).filter((id): id is string => typeof id === "string" && id.length > 0))];
}
