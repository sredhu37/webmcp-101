import { describe, expect, it } from 'vitest';
import { computeCost, priceTier } from './cost.ts';
import { bundledPriceTable } from './price-table.ts';
import { normalizeUsage, type AnthropicUsage, type OpenAIUsage } from './usage.ts';

const table = bundledPriceTable();

const anthropic = (usage: AnthropicUsage) => normalizeUsage('anthropic', usage);
const openai = (usage: OpenAIUsage, serviceTier?: string) =>
  normalizeUsage('openai', usage, { serviceTier });

function costOf(model: string, usage: ReturnType<typeof normalizeUsage>): number {
  const result = computeCost(table, model, usage);
  if (result.costUsd === null) throw new Error(result.reason);
  return result.costUsd;
}

describe('computeCost', () => {
  it("matches Anthropic's documented worked example for Claude Opus 5.5", () => {
    const usage = anthropic({
      input_tokens: 10_000,
      cache_read_input_tokens: 40_000,
      output_tokens: 15_000,
    });
    const result = computeCost(table, 'claude-opus-5-5', usage);

    expect(result.costUsd).toBeCloseTo(0.348, 12);
    expect(result).toMatchObject({
      tier: 'standard',
      longContext: false,
      multiplier: 1,
      priceTableVersion: '2026-10-15',
    });
    if (result.costUsd !== null) {
      expect(result.breakdown.input).toBeCloseTo(0.04, 12);
      expect(result.breakdown.cacheRead).toBeCloseTo(0.008, 12);
      expect(result.breakdown.output).toBeCloseTo(0.3, 12);
    }
  });

  it('prices Anthropic 5 minute and 1 hour cache writes separately', () => {
    const usage = anthropic({
      input_tokens: 0,
      cache_creation_input_tokens: 3_000_000,
      cache_creation: {
        ephemeral_5m_input_tokens: 2_000_000,
        ephemeral_1h_input_tokens: 1_000_000,
      },
      output_tokens: 0,
    });

    expect(costOf('claude-sonnet-5-5', usage)).toBeCloseTo(2 * 2.5 + 4, 12);
  });

  it('switches Claude Haiku 5.5 to the higher prices above 100,000 input tokens, cache included', () => {
    const atThreshold = anthropic({
      input_tokens: 50_000,
      cache_read_input_tokens: 40_000,
      cache_creation_input_tokens: 10_000,
      output_tokens: 1_000_000,
    });
    const overThreshold = anthropic({
      input_tokens: 50_001,
      cache_read_input_tokens: 40_000,
      cache_creation_input_tokens: 10_000,
      output_tokens: 1_000_000,
    });

    expect(computeCost(table, 'claude-haiku-5-5', atThreshold)).toMatchObject({
      longContext: false,
    });
    expect(costOf('claude-haiku-5-5', atThreshold)).toBeCloseTo(
      (50_000 * 0.1 + 40_000 * 0.01 + 10_000 * 0.125) / 1e6 + 0.5,
      12,
    );
    expect(computeCost(table, 'claude-haiku-5-5', overThreshold)).toMatchObject({
      longContext: true,
    });
    expect(costOf('claude-haiku-5-5', overThreshold)).toBeCloseTo(
      (50_001 * 0.5 + 40_000 * 0.05 + 10_000 * 0.625) / 1e6 + 2.5,
      12,
    );
  });

  it('keeps flat pricing for Claude Sonnet 5.5 at any prompt length', () => {
    const usage = anthropic({ input_tokens: 900_000, output_tokens: 0 });

    expect(computeCost(table, 'claude-sonnet-5-5', usage)).toMatchObject({ longContext: false });
    expect(costOf('claude-sonnet-5-5', usage)).toBeCloseTo(1.8, 12);
  });

  it('switches OpenAI models to long context prices above 272,000 input tokens', () => {
    const at = openai({ input_tokens: 272_000, output_tokens: 1_000_000 });
    const over = openai({
      input_tokens: 272_001,
      input_tokens_details: { cached_tokens: 200_000, cache_write_tokens: 1 },
      output_tokens: 1_000_000,
    });

    expect(costOf('gpt-6-luna', at)).toBeCloseTo(272_000 * 0.1e-6 + 0.5, 12);
    expect(computeCost(table, 'gpt-6-luna', over)).toMatchObject({ longContext: true });
    expect(costOf('gpt-6-luna', over)).toBeCloseTo(
      (72_000 * 0.2 + 200_000 * 0.02 + 1 * 0.25) / 1e6 + 0.75,
      12,
    );
  });

  it('applies the OpenAI service tier the response reports', () => {
    const usage = (tier?: string) =>
      openai({ input_tokens: 100_000, output_tokens: 1_000_000 }, tier);

    expect(costOf('gpt-6.1-sol', usage())).toBeCloseTo(10.2, 12);
    expect(costOf('gpt-6.1-sol', usage('default'))).toBeCloseTo(10.2, 12);
    expect(costOf('gpt-6.1-sol', usage('flex'))).toBeCloseTo(5.1, 12);
    expect(costOf('gpt-6.1-sol', usage('priority'))).toBeCloseTo(20.4, 12);
    expect(costOf('gpt-6.1-sol', usage('ultrafast'))).toBeCloseTo(61.2, 12);
    expect(computeCost(table, 'gpt-6.1-sol', usage('priority'))).toMatchObject({ tier: 'fast' });
  });

  it('returns no cost for a tier the model has no prices for', () => {
    const usage = openai({ input_tokens: 10, output_tokens: 10 }, 'ultrafast');

    expect(computeCost(table, 'gpt-5.6-sol', usage)).toEqual({
      costUsd: null,
      priceTableVersion: '2026-10-15',
      reason: 'no price for model gpt-5.6-sol at price tier ultrafast',
    });
  });

  it('uses Claude Opus 5.5 fast mode prices when the response reports speed fast', () => {
    const usage = anthropic({
      input_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      speed: 'fast',
    });

    expect(costOf('claude-opus-5-5', usage)).toBeCloseTo(8 + 0.4 + 40, 12);
  });

  it('multiplies every bucket by 1.1 for US-only inference', () => {
    const usage = anthropic({
      input_tokens: 10_000,
      cache_read_input_tokens: 40_000,
      output_tokens: 15_000,
      inference_geo: 'us',
    });
    const result = computeCost(table, 'claude-opus-5-5', usage);

    expect(result.costUsd).toBeCloseTo(0.348 * 1.1, 12);
    expect(result).toMatchObject({ multiplier: 1.1 });
  });

  it('applies the US multiplier on top of the Claude Haiku 5.5 higher prices', () => {
    const usage = anthropic({ input_tokens: 200_000, output_tokens: 0, inference_geo: 'us' });

    expect(costOf('claude-haiku-5-5', usage)).toBeCloseTo(200_000 * 0.5e-6 * 1.1, 12);
  });

  it('returns no cost for an unknown model or a model of the other provider', () => {
    const usage = anthropic({ input_tokens: 1, output_tokens: 1 });

    expect(computeCost(table, 'claude-unknown', usage)).toMatchObject({
      costUsd: null,
      reason: 'no price for model claude-unknown',
    });
    expect(computeCost(table, 'gpt-6-luna', usage)).toMatchObject({ costUsd: null });
  });

  it('prices every model in the table', () => {
    for (const model of ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']) {
      expect(costOf(model, anthropic({ input_tokens: 1000, output_tokens: 1000 }))).toBeGreaterThan(
        0,
      );
    }
    for (const model of ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-5.6-sol']) {
      expect(costOf(model, openai({ input_tokens: 1000, output_tokens: 1000 }))).toBeGreaterThan(0);
    }
  });
});

describe('priceTier', () => {
  it('maps reported modifiers to price tier keys', () => {
    expect(priceTier({ provider: 'anthropic', serviceTier: 'standard', speed: null })).toBe(
      'standard',
    );
    expect(priceTier({ provider: 'anthropic', serviceTier: 'priority', speed: 'fast' })).toBe(
      'fast',
    );
    expect(priceTier({ provider: 'anthropic', serviceTier: 'batch', speed: null })).toBe('batch');
    expect(priceTier({ provider: 'openai', serviceTier: null, speed: null })).toBe('standard');
    expect(priceTier({ provider: 'openai', serviceTier: 'auto', speed: null })).toBe('standard');
    expect(priceTier({ provider: 'openai', serviceTier: 'priority', speed: null })).toBe('fast');
    expect(priceTier({ provider: 'openai', serviceTier: 'flex', speed: null })).toBe('flex');
  });
});
