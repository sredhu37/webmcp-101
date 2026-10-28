import { describe, expect, it } from 'vitest';
import { claudeResizedSize, estimateImageTokens, estimateScreenshotTokens } from './images.ts';
import { bundledPriceTable, type ImageTokenRules } from './price-table.ts';

const table = bundledPriceTable();

const claudeHighRes: ImageTokenRules = {
  patchPx: 28,
  maxLongEdgePx: 2576,
  maxPatches: 4784,
  multiplier: 1,
};
const claudeStandard: ImageTokenRules = {
  patchPx: 28,
  maxLongEdgePx: 1568,
  maxPatches: 1568,
  multiplier: 1,
};
const gpt6AstraHigh: ImageTokenRules = {
  patchPx: 32,
  maxLongEdgePx: 65535,
  maxPatches: 2500,
  multiplier: 1.2,
};

describe('Claude image tokens (28 px patches)', () => {
  it.each([
    [200, 200, 64],
    [1000, 1000, 1296],
    [1092, 1092, 1521],
    [1920, 1080, 2691],
    [2000, 1500, 3888],
    [3840, 2160, 4784],
  ])('high resolution tier: %i x %i costs %i tokens, as documented', (width, height, tokens) => {
    expect(estimateImageTokens('anthropic', claudeHighRes, width, height)).toBe(tokens);
  });

  it.each([
    [1000, 1000, 1296],
    [1920, 1080, 1560],
    [2000, 1500, 1564],
    [3840, 2160, 1560],
  ])('standard tier: %i x %i costs %i tokens, as documented', (width, height, tokens) => {
    expect(estimateImageTokens('anthropic', claudeStandard, width, height)).toBe(tokens);
  });

  it('resizes like the documented reference implementation', () => {
    expect(claudeResizedSize(claudeStandard, 1075, 1520)).toEqual([924, 1307]);
    expect(claudeResizedSize(claudeStandard, 1920, 1080)).toEqual([1456, 819]);
    expect(claudeResizedSize(claudeHighRes, 3840, 2160)).toEqual([2576, 1449]);
  });
});

describe('OpenAI image tokens (32 px patches times the model multiplier)', () => {
  it.each([
    [1024, 1024, 1229],
    [2048, 2048, 3000],
    [4096, 512, 2458],
  ])('gpt-6-astra high detail: %i x %i costs %i tokens, as documented', (width, height, tokens) => {
    expect(estimateImageTokens('openai', gpt6AstraHigh, width, height)).toBe(tokens);
  });

  it('scales down to the maximum edge before counting patches', () => {
    const rules: ImageTokenRules = { patchPx: 32, maxLongEdgePx: 2048, multiplier: 1 };

    expect(estimateImageTokens('openai', rules, 4096, 1024)).toBe(64 * 16);
  });
});

describe('estimateScreenshotTokens', () => {
  it('estimates a 1280 x 800 viewport screenshot for every model', () => {
    for (const model of ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']) {
      expect(estimateScreenshotTokens(table, model, 1280, 800)).toBe(46 * 29);
    }
    for (const model of ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-5.6-sol']) {
      expect(estimateScreenshotTokens(table, model, 1280, 800)).toBe(1200);
    }
  });

  it('returns null for an unknown model', () => {
    expect(estimateScreenshotTokens(table, 'unknown-model', 1280, 800)).toBeNull();
  });
});
