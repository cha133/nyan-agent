import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { NyanConfig, ProviderConfig } from "./config";

export type ModelKey = `${string}/${string}`;

export class ProviderRegistry {
  private readonly providers = new Map<string, ReturnType<typeof createAnthropic> | ReturnType<typeof createOpenAICompatible>>();

  constructor(readonly config: NyanConfig) {
    for (const provider of config.providers) this.providers.set(provider.id, createProvider(provider));
  }

  model(key: string): LanguageModel {
    const { providerId, modelId } = splitModelKey(key);
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`provider_not_found: ${providerId}`);
    return provider.languageModel(modelId);
  }
}

export function createProvider(config: ProviderConfig) {
  if (config.kind === "anthropic-compatible") {
    return createAnthropic({
      name: config.id,
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
      authToken: config.authToken,
      headers: config.headers,
    });
  }
  return createOpenAICompatible({
    name: config.id,
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    headers: config.headers,
    includeUsage: true,
  });
}

export function modelKey(providerId: string, modelId: string): ModelKey {
  return `${providerId}/${modelId}`;
}

export function splitModelKey(key: string): { providerId: string; modelId: string } {
  const separator = key.indexOf("/");
  if (separator <= 0 || separator === key.length - 1) throw new Error(`invalid_model_key: ${key}`);
  return { providerId: key.slice(0, separator), modelId: key.slice(separator + 1) };
}
