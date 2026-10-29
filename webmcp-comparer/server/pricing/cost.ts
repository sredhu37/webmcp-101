import { findModelPrices, type PriceTable, type Rates } from './price-table.ts';
import type { NormalizedUsage } from './usage.ts';

export interface CostBreakdown {
  input: number;
  cacheRead: number;
  /** Cache writes at the 5 minute (or only) cache write rate. */
  cacheWrite: number;
  /** Anthropic cache writes at the 1 hour rate. */
  cacheWrite1h: number;
  output: number;
}

export type CostResult =
  | {
      /** Approximate USD at full precision. */
      costUsd: number;
      priceTableVersion: string;
      tier: string;
      longContext: boolean;
      /** Data residency multiplier applied to every bucket, 1 when none. */
      multiplier: number;
      breakdown: CostBreakdown;
    }
  | { costUsd: null; priceTableVersion: string; reason: string };

/** Approximate cost of one model call, from its normalized usage and the price table. */
export function computeCost(
  table: PriceTable,
  modelId: string,
  usage: NormalizedUsage,
): CostResult {
  const priceTableVersion = table.version;
  const unpriced = (reason: string): CostResult => ({ costUsd: null, priceTableVersion, reason });

  const found = findModelPrices(table, modelId);
  if (!found || found.provider !== usage.provider) {
    return unpriced(`no price for model ${modelId}`);
  }
  const { prices } = found;

  const tier = priceTier(usage);
  const tierPrices = prices.tiers[tier];
  if (!tierPrices) {
    return unpriced(`no price for model ${modelId} at price tier ${tier}`);
  }

  const threshold = prices.longContextAboveInputTokens;
  const longContext =
    threshold !== undefined &&
    usage.totalInput > threshold &&
    tierPrices.longContextRates !== undefined;
  const rates: Rates =
    longContext && tierPrices.longContextRates ? tierPrices.longContextRates : tierPrices.rates;

  const cacheWrite1hTokens = usage.cacheWrite1h;
  if (cacheWrite1hTokens > 0 && rates.cacheWrite1h === undefined) {
    return unpriced(`no 1 hour cache write price for model ${modelId}`);
  }

  let multiplier = 1;
  if (usage.inferenceGeo !== null) {
    const geoMultipliers = table.providers[usage.provider].inferenceGeoMultipliers ?? {};
    multiplier = geoMultipliers[usage.inferenceGeo] ?? 1;
  }

  const usd = (tokens: number, ratePerMillion: number): number =>
    (tokens * ratePerMillion * multiplier) / 1_000_000;
  const breakdown: CostBreakdown = {
    input: usd(usage.input, rates.input),
    cacheRead: usd(usage.cacheRead, rates.cacheRead),
    cacheWrite: usd(usage.cacheWrite - cacheWrite1hTokens, rates.cacheWrite),
    cacheWrite1h: usd(cacheWrite1hTokens, rates.cacheWrite1h ?? 0),
    output: usd(usage.output, rates.output),
  };
  const costUsd =
    breakdown.input +
    breakdown.cacheRead +
    breakdown.cacheWrite +
    breakdown.cacheWrite1h +
    breakdown.output;

  return { costUsd, priceTableVersion, tier, longContext, multiplier, breakdown };
}

/**
 * The price tier key the response's reported modifiers select. Anthropic fast mode reports
 * `speed: "fast"`; OpenAI reports Fast mode as `service_tier: "priority"`.
 */
export function priceTier(
  usage: Pick<NormalizedUsage, 'provider' | 'serviceTier' | 'speed'>,
): string {
  return usage.provider === 'anthropic' ? anthropicTier(usage) : openAITier(usage.serviceTier);
}

function anthropicTier(usage: { serviceTier: string | null; speed: string | null }): string {
  if (usage.speed === 'fast') return 'fast';
  if (usage.serviceTier === 'batch') return 'batch';
  return 'standard';
}

function openAITier(serviceTier: string | null): string {
  switch (serviceTier) {
    case null:
    case 'auto':
    case 'default':
    case 'standard':
      return 'standard';
    case 'priority':
      return 'fast';
    default:
      return serviceTier;
  }
}
