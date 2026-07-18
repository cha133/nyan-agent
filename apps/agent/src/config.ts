import { readFile } from "node:fs/promises";
import type { NyanPaths } from "./paths";
import { isNotFound } from "./files";

export type ProviderKind = "anthropic-compatible" | "openai-compatible";

export type ProviderConfig = {
  id: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey?: string;
  authToken?: string;
  headers: Record<string, string>;
  models: string[];
  discoverModels: boolean;
  discoveryUrl?: string;
  discoveryHeaders: Record<string, string>;
};

export type NyanConfig = {
  version: 1;
  defaultModel?: string;
  modelCacheTtlSeconds: number;
  providers: ProviderConfig[];
};

export class ConfigError extends Error {
  constructor(readonly code: "config_missing" | "config_invalid", message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export async function loadConfig(paths: NyanPaths): Promise<NyanConfig> {
  let source: string;
  try {
    source = await readFile(paths.configFile, "utf8");
  } catch (error) {
    if (isNotFound(error)) throw new ConfigError("config_missing", `Configuration file not found: ${paths.configFile}`);
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = Bun.TOML.parse(source);
  } catch {
    throw new ConfigError("config_invalid", `Invalid TOML in ${paths.configFile}`);
  }
  return parseConfig(parsed);
}

export function parseConfig(value: unknown): NyanConfig {
  const root = object(value, "config");
  if (root.version !== 1) throw invalid("version must be 1");
  const providers = array(root.providers, "providers").map((entry, index) => parseProvider(entry, index));
  if (providers.length === 0) throw invalid("at least one provider is required");
  const ids = new Set<string>();
  for (const provider of providers) {
    if (ids.has(provider.id)) throw invalid(`duplicate provider id: ${provider.id}`);
    ids.add(provider.id);
  }
  const defaultModel = optionalString(root.default_model, "default_model");
  const ttl = root.model_cache_ttl_seconds === undefined ? 3600 : positiveInteger(root.model_cache_ttl_seconds, "model_cache_ttl_seconds");
  return { version: 1, defaultModel, modelCacheTtlSeconds: ttl, providers };
}

function parseProvider(value: unknown, index: number): ProviderConfig {
  const provider = object(value, `providers[${index}]`);
  const id = requiredString(provider.id, `providers[${index}].id`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw invalid(`provider id must use lowercase letters, numbers, and hyphens: ${id}`);
  const kind = requiredString(provider.kind, `providers[${index}].kind`);
  if (kind !== "anthropic-compatible" && kind !== "openai-compatible") throw invalid(`unsupported provider kind: ${kind}`);
  const baseUrl = url(requiredString(provider.base_url, `providers[${index}].base_url`), `providers[${index}].base_url`);
  const apiKey = optionalString(provider.api_key, `providers[${index}].api_key`);
  const authToken = optionalString(provider.auth_token, `providers[${index}].auth_token`);
  if (kind === "anthropic-compatible" && Boolean(apiKey) === Boolean(authToken)) {
    throw invalid(`Anthropic-compatible provider ${id} requires exactly one of api_key or auth_token`);
  }
  if (kind === "openai-compatible" && authToken) throw invalid(`OpenAI-compatible provider ${id} does not support auth_token`);
  return {
    id,
    kind,
    baseUrl,
    apiKey,
    authToken,
    headers: stringRecord(provider.headers, `providers[${index}].headers`),
    models: stringArray(provider.models, `providers[${index}].models`),
    discoverModels: provider.discover_models === undefined ? false : boolean(provider.discover_models, `providers[${index}].discover_models`),
    discoveryUrl: provider.discovery_url === undefined ? undefined : url(requiredString(provider.discovery_url, `providers[${index}].discovery_url`), `providers[${index}].discovery_url`),
    discoveryHeaders: stringRecord(provider.discovery_headers, `providers[${index}].discovery_headers`),
  };
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid(`${name} must be a table`);
  return value as Record<string, unknown>;
}
function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw invalid(`${name} must be an array`);
  return value;
}
function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw invalid(`${name} must be a non-empty string`);
  return value;
}
function optionalString(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : requiredString(value, name);
}
function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw invalid(`${name} must be a boolean`);
  return value;
}
function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw invalid(`${name} must be a positive integer`);
  return value as number;
}
function stringArray(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  const values = array(value, name).map((entry, index) => requiredString(entry, `${name}[${index}]`));
  return [...new Set(values)];
}
function stringRecord(value: unknown, name: string): Record<string, string> {
  if (value === undefined) return {};
  return Object.fromEntries(Object.entries(object(value, name)).map(([key, entry]) => [key, requiredString(entry, `${name}.${key}`)]));
}
function url(value: string, name: string): string {
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw invalid(`${name} must be an absolute URL`);
  }
}
function invalid(message: string): ConfigError {
  return new ConfigError("config_invalid", message);
}
