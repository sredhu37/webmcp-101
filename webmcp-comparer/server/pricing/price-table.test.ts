import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bundledPriceTable,
  defaultOverridePath,
  findModelPrices,
  loadPriceTable,
  PriceTableError,
} from './price-table.ts';

const specModels = {
  anthropic: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
  openai: ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-5.6-sol'],
};

describe('bundled prices.json', () => {
  const table = bundledPriceTable();

  it('is dated and names its sources', () => {
    expect(table.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(table.providers.anthropic.sourceUrl).toBe(
      'https://platform.claude.com/docs/en/about-claude/pricing',
    );
    expect(table.providers.openai.sourceUrl).toBe('https://developers.openai.com/api/docs/pricing');
    expect(table.providers.anthropic.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(table.providers.openai.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('prices exactly the six models of the spec, each with per-bucket rates and image rules', () => {
    for (const [provider, models] of Object.entries(specModels)) {
      expect(
        Object.keys(table.providers[provider as 'anthropic' | 'openai'].models).sort(),
      ).toEqual([...models].sort());
      for (const model of models) {
        const found = findModelPrices(table, model);
        expect(found?.provider).toBe(provider);
        const rates = found?.prices.tiers.standard?.rates;
        for (const bucket of ['input', 'cacheRead', 'cacheWrite', 'output'] as const) {
          expect(rates?.[bucket]).toBeGreaterThan(0);
        }
        expect(found?.prices.image).toBeDefined();
      }
    }
  });

  it('carries the context tiers of the spec', () => {
    expect(findModelPrices(table, 'claude-haiku-5-5')?.prices.longContextAboveInputTokens).toBe(
      100_000,
    );
    for (const model of specModels.openai) {
      expect(findModelPrices(table, model)?.prices.longContextAboveInputTokens).toBe(272_000);
    }
  });
});

describe('loadPriceTable', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'webmcp-comparer-prices-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('defaults to ~/.webmcp-comparer/prices.json', () => {
    expect(defaultOverridePath.endsWith(join('.webmcp-comparer', 'prices.json'))).toBe(true);
  });

  it('returns the bundled table when there is no override file', async () => {
    const loaded = await loadPriceTable(join(dir, 'missing.json'));

    expect(loaded.override).toBeNull();
    expect(loaded.providers).toEqual(bundledPriceTable().providers);
  });

  it('deep merges the override file over the bundled table', async () => {
    const path = join(dir, 'override.json');
    await writeFile(
      path,
      JSON.stringify({
        providers: {
          anthropic: {
            models: { 'claude-haiku-5-5': { tiers: { standard: { rates: { input: 0.08 } } } } },
          },
          openai: {
            models: {
              'gpt-6-luna-custom': {
                label: 'gpt-6-luna-custom',
                tiers: {
                  standard: { rates: { input: 1, cacheRead: 0.1, cacheWrite: 1.25, output: 5 } },
                },
              },
            },
          },
        },
      }),
    );

    const loaded = await loadPriceTable(path);
    const haiku = loaded.providers.anthropic.models['claude-haiku-5-5'];

    expect(loaded.override).toEqual({ path, models: ['claude-haiku-5-5', 'gpt-6-luna-custom'] });
    expect(loaded.version).toBe(bundledPriceTable().version);
    expect(haiku?.tiers.standard?.rates).toEqual({
      input: 0.08,
      cacheWrite: 0.125,
      cacheWrite1h: 0.2,
      cacheRead: 0.01,
      output: 0.5,
    });
    expect(haiku?.tiers.standard?.longContextRates?.input).toBe(0.5);
    expect(loaded.providers.openai.models['gpt-6-luna-custom']?.tiers.standard?.rates.output).toBe(
      5,
    );
    expect(loaded.providers.openai.models['gpt-6-luna']).toEqual(
      bundledPriceTable().providers.openai.models['gpt-6-luna'],
    );
  });

  it('rejects an override that is not valid JSON', async () => {
    const path = join(dir, 'broken.json');
    await writeFile(path, '{ "providers": ');

    await expect(loadPriceTable(path)).rejects.toThrow(PriceTableError);
  });

  it('rejects an override that makes a rate invalid, naming the field', async () => {
    const path = join(dir, 'invalid.json');
    await writeFile(
      path,
      JSON.stringify({
        providers: {
          openai: { models: { 'gpt-6-luna': { tiers: { flex: { rates: { input: -1 } } } } } },
        },
      }),
    );

    await expect(loadPriceTable(path)).rejects.toThrow(
      'providers.openai.models.gpt-6-luna.tiers.flex.rates.input must be a number of at least 0',
    );
  });
});
