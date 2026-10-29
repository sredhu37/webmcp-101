import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel, streamText } from 'ai';
import type { Provider } from '../pricing/price-table.ts';

export type ModelLabel = 'recommended' | 'ok' | 'not recommended';

export interface ModelInfo {
  id: string;
  provider: Provider;
  /** Name shown in the UI. */
  name: string;
  label: ModelLabel;
}

/** The fixed model lists of spec section 7, best first; the first model per provider is the default. */
export const MODELS: readonly ModelInfo[] = [
  { id: 'claude-haiku-5-5', provider: 'anthropic', name: 'Haiku 5.5', label: 'recommended' },
  { id: 'claude-sonnet-5-5', provider: 'anthropic', name: 'Sonnet 5.5', label: 'ok' },
  { id: 'claude-opus-5-5', provider: 'anthropic', name: 'Opus 5.5', label: 'not recommended' },
  { id: 'gpt-6-luna', provider: 'openai', name: 'gpt-6-luna', label: 'recommended' },
  { id: 'gpt-6.1-sol', provider: 'openai', name: 'gpt-6.1-sol', label: 'ok' },
  { id: 'gpt-5.6-sol', provider: 'openai', name: 'gpt-5.6-sol', label: 'not recommended' },
];

/** Same effort for every model in both Lanes. */
export const EFFORT = 'medium';

export type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]['providerOptions']>;

/**
 * Effort medium in each provider's own request field: Anthropic adaptive thinking with
 * `output_config.effort`, OpenAI Responses `reasoning.effort`.
 */
export const EFFORT_PROVIDER_OPTIONS: Record<Provider, ProviderOptions> = {
  anthropic: { anthropic: { thinking: { type: 'adaptive' }, effort: EFFORT } },
  openai: { openai: { reasoningEffort: EFFORT } },
};

/** A model instance bound to the user's key; never an AI Gateway string id. */
export type SdkModel = Exclude<LanguageModel, string>;

/** The model one Lane talks to, plus the facts the loop needs about it. */
export interface ModelHandle {
  provider: Provider;
  modelId: string;
  model: SdkModel;
}

export const API_KEY_ENV: Record<Provider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
};

export interface CreateModelOptions {
  apiKey: string;
  /** Replaces the HTTP client, for tests. */
  fetch?: typeof globalThis.fetch;
}

export function findModel(modelId: string): ModelInfo | undefined {
  return MODELS.find((model) => model.id === modelId);
}

export function defaultModel(provider: Provider): ModelInfo {
  return MODELS.find((model) => model.provider === provider)!;
}

/** Builds the provider from the key for this Run, so calls go straight to the provider's API. */
export function createModelHandle(modelId: string, options: CreateModelOptions): ModelHandle {
  const info = findModel(modelId);
  if (!info) throw new Error(`Unknown model: ${modelId}`);
  const settings = { apiKey: options.apiKey, ...(options.fetch ? { fetch: options.fetch } : {}) };
  const model =
    info.provider === 'anthropic'
      ? createAnthropic(settings)(info.id)
      : createOpenAI(settings).responses(info.id);
  return { provider: info.provider, modelId: info.id, model };
}
