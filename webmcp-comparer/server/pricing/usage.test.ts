import { describe, expect, it } from 'vitest';
import { addTokens, emptyTokens, normalizeUsage } from './usage.ts';

describe('normalizeUsage', () => {
  it('reads a raw Anthropic usage object, where input_tokens excludes cache tokens', () => {
    const raw = {
      input_tokens: 1200,
      cache_creation_input_tokens: 3000,
      cache_read_input_tokens: 40000,
      cache_creation: { ephemeral_5m_input_tokens: 2000, ephemeral_1h_input_tokens: 1000 },
      output_tokens: 900,
      output_tokens_details: { thinking_tokens: 300 },
      service_tier: 'standard',
      inference_geo: 'global',
    };

    expect(normalizeUsage('anthropic', raw)).toEqual({
      provider: 'anthropic',
      input: 1200,
      cacheRead: 40000,
      cacheWrite: 3000,
      cacheWrite1h: 1000,
      output: 900,
      reasoning: 300,
      totalInput: 44200,
      serviceTier: 'standard',
      speed: null,
      inferenceGeo: 'global',
      raw,
    });
  });

  it('reads a raw OpenAI usage object, where input_tokens includes cache tokens', () => {
    const raw = {
      input_tokens: 50000,
      input_tokens_details: { cached_tokens: 40000, cache_write_tokens: 6000 },
      output_tokens: 1500,
      output_tokens_details: { reasoning_tokens: 1000 },
      total_tokens: 51500,
    };

    expect(normalizeUsage('openai', raw, { serviceTier: 'priority' })).toEqual({
      provider: 'openai',
      input: 4000,
      cacheRead: 40000,
      cacheWrite: 6000,
      cacheWrite1h: 0,
      output: 1500,
      reasoning: 1000,
      totalInput: 50000,
      serviceTier: 'priority',
      speed: null,
      inferenceGeo: null,
      raw,
    });
  });

  it('reads AI SDK v7 step usage for Anthropic and takes the 1 hour split and modifiers from raw', () => {
    const raw = {
      input_tokens: 10000,
      cache_creation_input_tokens: 500,
      cache_read_input_tokens: 40000,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 500 },
      output_tokens: 15000,
      speed: 'fast',
      inference_geo: 'us',
    };
    const usage = normalizeUsage('anthropic', {
      inputTokens: 50500,
      inputTokenDetails: { noCacheTokens: 10000, cacheReadTokens: 40000, cacheWriteTokens: 500 },
      outputTokens: 15000,
      outputTokenDetails: { textTokens: 14000, reasoningTokens: 1000 },
      totalTokens: 65500,
      raw,
    });

    expect(usage).toMatchObject({
      input: 10000,
      cacheRead: 40000,
      cacheWrite: 500,
      cacheWrite1h: 500,
      output: 15000,
      reasoning: 1000,
      totalInput: 50500,
      speed: 'fast',
      inferenceGeo: 'us',
      raw,
    });
  });

  it('reads AI SDK v7 step usage for OpenAI with the service tier from provider metadata', () => {
    const raw = {
      input_tokens: 300000,
      input_tokens_details: { cached_tokens: 250000, cache_write_tokens: 0 },
      output_tokens: 2000,
      output_tokens_details: { reasoning_tokens: 1200 },
    };
    const usage = normalizeUsage(
      'openai',
      {
        inputTokens: 300000,
        inputTokenDetails: { noCacheTokens: 50000, cacheReadTokens: 250000, cacheWriteTokens: 0 },
        outputTokens: 2000,
        outputTokenDetails: { textTokens: 800, reasoningTokens: 1200 },
        totalTokens: 302000,
        raw,
      },
      { serviceTier: 'flex' },
    );

    expect(usage).toMatchObject({
      input: 50000,
      cacheRead: 250000,
      cacheWrite: 0,
      output: 2000,
      reasoning: 1200,
      totalInput: 300000,
      serviceTier: 'flex',
      raw,
    });
  });

  it('derives uncached input from AI SDK totals when the details are missing', () => {
    const usage = normalizeUsage('openai', {
      inputTokens: 1000,
      inputTokenDetails: {
        noCacheTokens: undefined,
        cacheReadTokens: 600,
        cacheWriteTokens: undefined,
      },
      outputTokens: 50,
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      totalTokens: 1050,
    });

    expect(usage).toMatchObject({
      input: 400,
      cacheRead: 600,
      cacheWrite: 0,
      output: 50,
      reasoning: 0,
    });
    expect(usage.raw).toMatchObject({ inputTokens: 1000 });
  });

  it('falls back to raw usage when the AI SDK fields are undefined', () => {
    const usage = normalizeUsage('anthropic', {
      inputTokens: undefined,
      outputTokens: undefined,
      raw: { input_tokens: 20, cache_read_input_tokens: 80, output_tokens: 7 },
    });

    expect(usage).toMatchObject({
      input: 20,
      cacheRead: 80,
      cacheWrite: 0,
      output: 7,
      totalInput: 100,
    });
  });

  it('uses the Anthropic TTL breakdown when the cache write total is missing', () => {
    const usage = normalizeUsage('anthropic', {
      input_tokens: 5,
      cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 50 },
      output_tokens: 1,
    });

    expect(usage).toMatchObject({ cacheWrite: 150, cacheWrite1h: 50, totalInput: 155 });
  });

  it('treats missing OpenAI cache write tokens as zero', () => {
    const usage = normalizeUsage('openai', {
      input_tokens: 900,
      input_tokens_details: { cached_tokens: 300 },
      output_tokens: 10,
    });

    expect(usage).toMatchObject({ input: 600, cacheRead: 300, cacheWrite: 0 });
  });

  it('sums token buckets', () => {
    const a = normalizeUsage('anthropic', { input_tokens: 10, output_tokens: 5 });
    const b = normalizeUsage('anthropic', {
      input_tokens: 1,
      cache_read_input_tokens: 9,
      output_tokens: 2,
      output_tokens_details: { thinking_tokens: 1 },
    });

    expect(addTokens(addTokens(emptyTokens(), a), b)).toEqual({
      input: 11,
      cacheRead: 9,
      cacheWrite: 0,
      cacheWrite1h: 0,
      output: 7,
      reasoning: 1,
    });
  });
});
