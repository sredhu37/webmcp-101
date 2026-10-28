import { isRecord, type Provider } from './price-table.ts';

/** Disjoint input buckets plus output; `cacheWrite1h` is part of `cacheWrite`, `reasoning` part of `output`. */
export interface TokenBuckets {
  /** Uncached input. */
  input: number;
  cacheRead: number;
  /** All cache writes, whatever the TTL. */
  cacheWrite: number;
  /** Of `cacheWrite`, the tokens written with Anthropic's 1 hour TTL. */
  cacheWrite1h: number;
  /** All output, reasoning included. */
  output: number;
  /** Of `output`, the tokens spent on reasoning. */
  reasoning: number;
}

export interface NormalizedUsage extends TokenBuckets {
  provider: Provider;
  /** `input + cacheRead + cacheWrite`. */
  totalInput: number;
  /** Anthropic `usage.service_tier`, or OpenAI `response.service_tier`. */
  serviceTier: string | null;
  /** Anthropic `usage.speed`. */
  speed: string | null;
  /** Anthropic `usage.inference_geo`. */
  inferenceGeo: string | null;
  /** The provider usage object as received, for audit and recompute. */
  raw: unknown;
}

/** Step usage as reported by the Vercel AI SDK v7 (`LanguageModelUsage`). */
export interface AiSdkUsage {
  inputTokens: number | undefined;
  inputTokenDetails?: {
    noCacheTokens?: number | undefined;
    cacheReadTokens?: number | undefined;
    cacheWriteTokens?: number | undefined;
  };
  outputTokens: number | undefined;
  outputTokenDetails?: {
    textTokens?: number | undefined;
    reasoningTokens?: number | undefined;
  };
  totalTokens?: number | undefined;
  raw?: unknown;
}

/** Anthropic Messages API `message.usage`. `input_tokens` excludes cache tokens. */
export interface AnthropicUsage {
  input_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number | null;
    ephemeral_1h_input_tokens?: number | null;
  } | null;
  output_tokens: number;
  output_tokens_details?: { thinking_tokens?: number | null } | null;
  service_tier?: string | null;
  inference_geo?: string | null;
  speed?: string | null;
}

/** OpenAI Responses API `response.usage`. `input_tokens` includes cache tokens. */
export interface OpenAIUsage {
  input_tokens: number;
  input_tokens_details?: {
    cached_tokens?: number | null;
    cache_write_tokens?: number | null;
  } | null;
  output_tokens: number;
  output_tokens_details?: { reasoning_tokens?: number | null } | null;
  total_tokens?: number;
}

export type UsageInput = AiSdkUsage | AnthropicUsage | OpenAIUsage;

export interface UsageContext {
  /**
   * Service tier the response reports outside the usage object: OpenAI `response.service_tier`,
   * which the AI SDK exposes as `providerMetadata.openai.serviceTier`.
   */
  serviceTier?: string | null | undefined;
}

type PartialBuckets = Partial<TokenBuckets>;

interface ProviderFields extends PartialBuckets {
  serviceTier?: string;
  speed?: string;
  inferenceGeo?: string;
}

/** Normalizes AI SDK step usage or a raw provider usage object into disjoint buckets. */
export function normalizeUsage(
  provider: Provider,
  usage: UsageInput,
  context: UsageContext = {},
): NormalizedUsage {
  const fromSdk = isAiSdkUsage(usage);
  const rawUsage: unknown = fromSdk ? (usage.raw ?? usage) : usage;
  const reported = readProviderUsage(provider, fromSdk ? usage.raw : usage);
  const sdk = fromSdk ? readAiSdkUsage(usage) : {};

  const input = sdk.input ?? reported.input ?? 0;
  const cacheRead = sdk.cacheRead ?? reported.cacheRead ?? 0;
  const cacheWrite = sdk.cacheWrite ?? reported.cacheWrite ?? 0;
  const output = sdk.output ?? reported.output ?? 0;

  return {
    provider,
    input,
    cacheRead,
    cacheWrite,
    cacheWrite1h: Math.min(reported.cacheWrite1h ?? 0, cacheWrite),
    output,
    reasoning: Math.min(sdk.reasoning ?? reported.reasoning ?? 0, output),
    totalInput: input + cacheRead + cacheWrite,
    serviceTier: context.serviceTier ?? reported.serviceTier ?? null,
    speed: reported.speed ?? null,
    inferenceGeo: reported.inferenceGeo ?? null,
    raw: rawUsage,
  };
}

export function emptyTokens(): TokenBuckets {
  return { input: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0, reasoning: 0 };
}

export function addTokens(a: TokenBuckets, b: TokenBuckets): TokenBuckets {
  return {
    input: a.input + b.input,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
  };
}

function isAiSdkUsage(usage: UsageInput): usage is AiSdkUsage {
  return 'inputTokens' in usage || 'inputTokenDetails' in usage || 'outputTokens' in usage;
}

function readAiSdkUsage(usage: AiSdkUsage): PartialBuckets {
  const total = count(usage.inputTokens);
  const cacheRead = count(usage.inputTokenDetails?.cacheReadTokens);
  const cacheWrite = count(usage.inputTokenDetails?.cacheWriteTokens);
  const input =
    count(usage.inputTokenDetails?.noCacheTokens) ??
    (total === undefined ? undefined : Math.max(0, total - (cacheRead ?? 0) - (cacheWrite ?? 0)));
  return {
    input,
    cacheRead,
    cacheWrite,
    output: count(usage.outputTokens),
    reasoning: count(usage.outputTokenDetails?.reasoningTokens),
  };
}

function readProviderUsage(provider: Provider, usage: unknown): ProviderFields {
  if (!isRecord(usage)) return {};
  return provider === 'anthropic' ? readAnthropicUsage(usage) : readOpenAIUsage(usage);
}

function readAnthropicUsage(usage: Record<string, unknown>): ProviderFields {
  const creation = isRecord(usage.cache_creation) ? usage.cache_creation : {};
  const write5m = count(creation.ephemeral_5m_input_tokens);
  const write1h = count(creation.ephemeral_1h_input_tokens);
  const splitTotal =
    write5m === undefined && write1h === undefined ? undefined : (write5m ?? 0) + (write1h ?? 0);
  const details = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : {};
  return {
    input: count(usage.input_tokens),
    cacheRead: count(usage.cache_read_input_tokens),
    cacheWrite: count(usage.cache_creation_input_tokens) ?? splitTotal,
    cacheWrite1h: write1h,
    output: count(usage.output_tokens),
    reasoning: count(details.thinking_tokens),
    serviceTier: label(usage.service_tier),
    speed: label(usage.speed),
    inferenceGeo: label(usage.inference_geo),
  };
}

function readOpenAIUsage(usage: Record<string, unknown>): ProviderFields {
  const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const outputDetails = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : {};
  const total = count(usage.input_tokens);
  const cacheRead = count(inputDetails.cached_tokens);
  const cacheWrite = count(inputDetails.cache_write_tokens);
  return {
    input:
      total === undefined ? undefined : Math.max(0, total - (cacheRead ?? 0) - (cacheWrite ?? 0)),
    cacheRead,
    cacheWrite,
    output: count(usage.output_tokens),
    reasoning: count(outputDetails.reasoning_tokens),
    serviceTier: label(usage.service_tier),
  };
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function label(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
