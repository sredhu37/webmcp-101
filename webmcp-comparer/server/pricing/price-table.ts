import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type Provider = 'anthropic' | 'openai';

export const providers: readonly Provider[] = ['anthropic', 'openai'];

/** USD per million tokens, as printed on the provider's pricing page. */
export interface Rates {
  /** Uncached input. */
  input: number;
  cacheRead: number;
  /** Cache write; for Anthropic, the 5 minute TTL write. */
  cacheWrite: number;
  /** Anthropic 1 hour TTL cache write. */
  cacheWrite1h?: number;
  /** All output, reasoning included. */
  output: number;
}

export interface TierPrices {
  rates: Rates;
  /** Rates for the whole request once its total input exceeds the model's long context threshold. */
  longContextRates?: Rates;
}

export interface ImageTokenRules {
  /** Edge of one square image patch in pixels. */
  patchPx: number;
  /** Images are scaled down so neither side exceeds this. */
  maxLongEdgePx?: number;
  /** Images are scaled down so they need at most this many patches. */
  maxPatches?: number;
  /** Billable tokens per patch. */
  multiplier: number;
}

export interface ModelPrices {
  label: string;
  longContextAboveInputTokens?: number;
  /** Keyed by price tier: `standard` always, plus e.g. `fast`, `flex`, `ultrafast`. */
  tiers: Record<string, TierPrices>;
  image?: ImageTokenRules;
  notes?: string[];
}

export interface ProviderPrices {
  /** Human pricing page; its Markdown version is `${sourceUrl}.md`. */
  sourceUrl: string;
  retrievedAt: string;
  /** Multipliers on every rate, keyed by the reported inference geography. */
  inferenceGeoMultipliers?: Record<string, number>;
  models: Record<string, ModelPrices>;
}

export interface PriceTable {
  version: string;
  currency: string;
  unit: string;
  providers: Record<Provider, ProviderPrices>;
}

export interface LoadedPriceTable extends PriceTable {
  /** Set when a user override file was merged over the bundled table. */
  override: { path: string; models: string[] } | null;
}

export class PriceTableError extends Error {
  override name = 'PriceTableError';
}

export const bundledPriceTablePath = new URL('./prices.json', import.meta.url);

export const defaultOverridePath = join(homedir(), '.webmcp-comparer', 'prices.json');

let bundledCache: PriceTable | undefined;

export function bundledPriceTable(): PriceTable {
  bundledCache ??= parsePriceTable(
    JSON.parse(readFileSync(bundledPriceTablePath, 'utf8')),
    'bundled prices.json',
  );
  return structuredClone(bundledCache);
}

/**
 * The bundled table with the user override file, if it exists, deep merged over it.
 * Objects merge key by key; any other value in the override replaces the bundled one.
 */
export async function loadPriceTable(
  overridePath: string = defaultOverridePath,
): Promise<LoadedPriceTable> {
  const bundled = bundledPriceTable();
  let text: string;
  try {
    text = await readFile(overridePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...bundled, override: null };
    }
    throw new PriceTableError(`Cannot read price override ${overridePath}: ${String(error)}`);
  }

  let override: unknown;
  try {
    override = JSON.parse(text);
  } catch (error) {
    throw new PriceTableError(`Price override ${overridePath} is not valid JSON: ${String(error)}`);
  }
  return {
    ...mergePriceTable(bundled, override, overridePath),
    override: { path: overridePath, models: overriddenModels(override) },
  };
}

export function mergePriceTable(base: PriceTable, override: unknown, source: string): PriceTable {
  if (!isRecord(override)) {
    throw new PriceTableError(`${source}: must be a JSON object`);
  }
  return parsePriceTable(deepMerge(base, override), source);
}

export function findModelPrices(
  table: PriceTable,
  modelId: string,
): { provider: Provider; prices: ModelPrices } | undefined {
  for (const provider of providers) {
    const prices = table.providers[provider].models[modelId];
    if (prices) return { provider, prices };
  }
  return undefined;
}

function overriddenModels(override: unknown): string[] {
  if (!isRecord(override) || !isRecord(override.providers)) return [];
  return Object.values(override.providers).flatMap((provider) =>
    isRecord(provider) && isRecord(provider.models) ? Object.keys(provider.models) : [],
  );
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isRecord(base) || !isRecord(override)) return override;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = key in base ? deepMerge(base[key], value) : value;
  }
  return merged;
}

export function parsePriceTable(value: unknown, source: string): PriceTable {
  const fail = (path: string, problem: string): never => {
    throw new PriceTableError(`${source}: ${path} ${problem}`);
  };
  const record = (input: unknown, path: string): Record<string, unknown> =>
    isRecord(input) ? input : fail(path, 'must be an object');
  const text = (input: unknown, path: string): string =>
    typeof input === 'string' && input !== '' ? input : fail(path, 'must be a non-empty string');
  const amount = (input: unknown, path: string): number =>
    typeof input === 'number' && Number.isFinite(input) && input >= 0
      ? input
      : fail(path, 'must be a number of at least 0');
  const positive = (input: unknown, path: string): number =>
    typeof input === 'number' && Number.isFinite(input) && input > 0
      ? input
      : fail(path, 'must be a number above 0');
  const optional = <T>(input: unknown, read: (input: unknown) => T): T | undefined =>
    input === undefined ? undefined : read(input);

  const rates = (input: unknown, path: string): Rates => {
    const r = record(input, path);
    return {
      input: amount(r.input, `${path}.input`),
      cacheRead: amount(r.cacheRead, `${path}.cacheRead`),
      cacheWrite: amount(r.cacheWrite, `${path}.cacheWrite`),
      ...optionalField(
        'cacheWrite1h',
        optional(r.cacheWrite1h, (v) => amount(v, `${path}.cacheWrite1h`)),
      ),
      output: amount(r.output, `${path}.output`),
    };
  };

  const model = (input: unknown, path: string): ModelPrices => {
    const m = record(input, path);
    const longContextAboveInputTokens = optional(m.longContextAboveInputTokens, (v) =>
      positive(v, `${path}.longContextAboveInputTokens`),
    );
    const tiersInput = record(m.tiers, `${path}.tiers`);
    if (!('standard' in tiersInput)) fail(`${path}.tiers`, 'must include "standard"');
    const tiers: Record<string, TierPrices> = {};
    for (const [name, tierInput] of Object.entries(tiersInput)) {
      const tierPath = `${path}.tiers.${name}`;
      const tier = record(tierInput, tierPath);
      const longContextRates = optional(tier.longContextRates, (v) =>
        rates(v, `${tierPath}.longContextRates`),
      );
      if (longContextRates && longContextAboveInputTokens === undefined) {
        fail(`${path}.longContextAboveInputTokens`, 'is required when long context rates are set');
      }
      tiers[name] = {
        rates: rates(tier.rates, `${tierPath}.rates`),
        ...optionalField('longContextRates', longContextRates),
      };
    }
    const image = optional(m.image, (v): ImageTokenRules => {
      const i = record(v, `${path}.image`);
      return {
        patchPx: positive(i.patchPx, `${path}.image.patchPx`),
        ...optionalField(
          'maxLongEdgePx',
          optional(i.maxLongEdgePx, (e) => positive(e, `${path}.image.maxLongEdgePx`)),
        ),
        ...optionalField(
          'maxPatches',
          optional(i.maxPatches, (e) => positive(e, `${path}.image.maxPatches`)),
        ),
        multiplier: positive(i.multiplier, `${path}.image.multiplier`),
      };
    });
    const notes = optional(m.notes, (v) =>
      Array.isArray(v)
        ? v.map((note, n) => text(note, `${path}.notes[${n}]`))
        : fail(`${path}.notes`, 'must be a list'),
    );
    return {
      label: text(m.label, `${path}.label`),
      ...optionalField('longContextAboveInputTokens', longContextAboveInputTokens),
      tiers,
      ...optionalField('image', image),
      ...optionalField('notes', notes),
    };
  };

  const provider = (input: unknown, path: string): ProviderPrices => {
    const p = record(input, path);
    const geo = optional(p.inferenceGeoMultipliers, (v) =>
      Object.fromEntries(
        Object.entries(record(v, `${path}.inferenceGeoMultipliers`)).map(([key, multiplier]) => [
          key,
          positive(multiplier, `${path}.inferenceGeoMultipliers.${key}`),
        ]),
      ),
    );
    const models = record(p.models, `${path}.models`);
    return {
      sourceUrl: text(p.sourceUrl, `${path}.sourceUrl`),
      retrievedAt: text(p.retrievedAt, `${path}.retrievedAt`),
      ...optionalField('inferenceGeoMultipliers', geo),
      models: Object.fromEntries(
        Object.entries(models).map(([id, m]) => [id, model(m, `${path}.models.${id}`)]),
      ),
    };
  };

  const table = record(value, 'table');
  const providersInput = record(table.providers, 'providers');
  return {
    version: text(table.version, 'version'),
    currency: text(table.currency, 'currency'),
    unit: text(table.unit, 'unit'),
    providers: {
      anthropic: provider(providersInput.anthropic, 'providers.anthropic'),
      openai: provider(providersInput.openai, 'providers.openai'),
    },
  };
}

function optionalField<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
