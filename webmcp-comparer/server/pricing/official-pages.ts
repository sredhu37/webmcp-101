import {
  bundledPriceTable,
  type ModelPrices,
  type PriceTable,
  type Provider,
  type Rates,
} from './price-table.ts';

export interface MarkdownTable {
  /** Nearest Markdown heading above the table, without the leading hashes. */
  heading: string;
  header: string[];
  rows: string[][];
}

/** Rates found on a pricing page; `null` where the page prints no price. */
export type PageRates = { [K in keyof Rates]-?: number | null };

export interface PageModelTier {
  rates: PageRates;
  longContextRates?: PageRates;
}

export interface PagePrices {
  /** Keyed by page row name (Anthropic) or model id (OpenAI), then by price tier. */
  models: Map<string, Map<string, PageModelTier>>;
  longContextAboveInputTokens: Map<string, number>;
  inferenceGeoMultipliers: Map<string, number>;
  problems: string[];
}

export interface Difference {
  provider: Provider;
  subject: string;
  bundled: number | string | null;
  page: number | string | null;
}

export function parseMarkdownTables(markdown: string): MarkdownTable[] {
  const tables: MarkdownTable[] = [];
  const lines = markdown.split(/\r?\n/);
  let heading = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? '';
    const headingMatch = /^#{1,6}\s+(.*)$/.exec(line);
    if (headingMatch) {
      heading = headingMatch[1]?.trim() ?? '';
      continue;
    }
    const separator = lines[i + 1]?.trim() ?? '';
    if (!line.startsWith('|') || !/^\|(\s*:?-+:?\s*\|)+$/.test(separator)) continue;
    const table: MarkdownTable = { heading, header: splitRow(line), rows: [] };
    i += 2;
    while (i < lines.length && (lines[i]?.trim() ?? '').startsWith('|')) {
      table.rows.push(splitRow(lines[i]?.trim() ?? ''));
      i++;
    }
    i--;
    tables.push(table);
  }
  return tables;
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** First dollar amount in a cell, or null when the cell has none (for example `-`). */
export function parsePrice(cell: string | undefined): number | null {
  const match = /\$\s*(\d[\d,]*(?:\.\d+)?|\.\d+)/.exec(cell ?? '');
  return match?.[1] ? Number(match[1].replaceAll(',', '')) : null;
}

/** Row name without footnote markers and parenthesised links such as `([retired](...))`. */
export function cleanName(cell: string): string {
  return cell
    .replace(/<sup>.*?<\/sup>/g, '')
    .replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function emptyPagePrices(): PagePrices {
  return {
    models: new Map(),
    longContextAboveInputTokens: new Map(),
    inferenceGeoMultipliers: new Map(),
    problems: [],
  };
}

function setTier(prices: PagePrices, model: string, tier: string, value: PageModelTier): void {
  const tiers = prices.models.get(model) ?? new Map<string, PageModelTier>();
  tiers.set(tier, value);
  prices.models.set(model, tiers);
}

function column(header: string[], pattern: RegExp): number {
  return header.findIndex((cell) => pattern.test(cell));
}

export function parseAnthropicPage(markdown: string): PagePrices {
  const prices = emptyPagePrices();
  const tables = parseMarkdownTables(markdown);

  const main = tables.find((t) => t.header.some((cell) => /base input/i.test(cell)));
  if (!main) {
    prices.problems.push('model pricing table not found');
  } else {
    const index = {
      input: column(main.header, /base input/i),
      cacheWrite: column(main.header, /5m cache write/i),
      cacheWrite1h: column(main.header, /1h cache write/i),
      cacheRead: column(main.header, /cache hit/i),
      output: column(main.header, /output/i),
    };
    if (Object.values(index).some((n) => n < 0)) {
      prices.problems.push(`model pricing table has unexpected columns: ${main.header.join(', ')}`);
    } else {
      const longRows = new Map<string, PageRates>();
      for (const row of main.rows) {
        const name = cleanName(row[0] ?? '');
        const rates: PageRates = {
          input: parsePrice(row[index.input]),
          cacheRead: parsePrice(row[index.cacheRead]),
          cacheWrite: parsePrice(row[index.cacheWrite]),
          cacheWrite1h: parsePrice(row[index.cacheWrite1h]),
          output: parsePrice(row[index.output]),
        };
        const tiered = /^(.*?)\s*\(for prompts (up to|over) ([\d,]+) tokens\)$/i.exec(name);
        if (tiered?.[1] && tiered[3]) {
          const model = tiered[1];
          if (tiered[2]?.toLowerCase() === 'over') {
            longRows.set(model, rates);
            prices.longContextAboveInputTokens.set(model, Number(tiered[3].replaceAll(',', '')));
          } else {
            setTier(prices, model, 'standard', { rates });
          }
        } else {
          setTier(prices, name, 'standard', { rates });
        }
      }
      for (const [model, longContextRates] of longRows) {
        const standard = prices.models.get(model)?.get('standard');
        if (standard) standard.longContextRates = longContextRates;
      }
    }
  }

  const fast = tables.find((t) => /fast mode/i.test(t.heading));
  if (!fast) {
    prices.problems.push('fast mode pricing table not found');
  } else {
    const inputColumn = column(fast.header, /^input/i);
    const outputColumn = column(fast.header, /^output/i);
    for (const row of fast.rows) {
      const input = parsePrice(row[inputColumn]);
      const output = parsePrice(row[outputColumn]);
      for (const name of cleanName(row[0] ?? '').split(/\s*\/\s*/)) {
        const standard = prices.models.get(name)?.get('standard')?.rates;
        const ratio = (bucket: keyof Rates): number | null => {
          const base = standard?.[bucket];
          return input !== null && base != null && standard?.input
            ? (input * base) / standard.input
            : null;
        };
        setTier(prices, name, 'fast', {
          rates: {
            input,
            cacheRead: ratio('cacheRead'),
            cacheWrite: ratio('cacheWrite'),
            cacheWrite1h: ratio('cacheWrite1h'),
            output,
          },
        });
      }
    }
  }

  const geo = /`inference_geo:\s*"(\w+)"`[^.]*?applies a ([\d.]+)x pricing multiplier/i.exec(
    markdown,
  );
  if (geo?.[1] && geo[2]) {
    prices.inferenceGeoMultipliers.set(geo[1], Number(geo[2]));
  } else {
    prices.problems.push('inference_geo multiplier not found');
  }
  return prices;
}

const openAITierHeadings: Record<string, string> = {
  standard: 'standard pricing data',
  flex: 'flex pricing data',
  fast: 'fast pricing data',
  ultrafast: 'ultrafast pricing data',
};

export function parseOpenAIPage(markdown: string): PagePrices {
  const prices = emptyPagePrices();
  const tables = parseMarkdownTables(markdown);

  for (const [tier, heading] of Object.entries(openAITierHeadings)) {
    const table = tables.find((t) => t.heading.toLowerCase() === heading);
    if (!table) {
      if (tier === 'standard') prices.problems.push('standard pricing table not found');
      continue;
    }
    const find = (context: 'Short' | 'Long', name: RegExp): number =>
      column(table.header, new RegExp(`^${context} context ${name.source}`, 'i'));
    const short = {
      input: find('Short', /input$/),
      cacheRead: find('Short', /cached input$/),
      cacheWrite: find('Short', /cache writes?$/),
      output: find('Short', /output$/),
    };
    const long = {
      input: find('Long', /input$/),
      cacheRead: find('Long', /cached input$/),
      cacheWrite: find('Long', /cache writes?$/),
      output: find('Long', /output$/),
    };
    if ([...Object.values(short), ...Object.values(long)].some((n) => n < 0)) {
      prices.problems.push(
        `${tier} pricing table has unexpected columns: ${table.header.join(', ')}`,
      );
      continue;
    }
    const read = (row: string[], index: typeof short): PageRates => ({
      input: parsePrice(row[index.input]),
      cacheRead: parsePrice(row[index.cacheRead]),
      cacheWrite: parsePrice(row[index.cacheWrite]),
      cacheWrite1h: null,
      output: parsePrice(row[index.output]),
    });
    for (const row of table.rows) {
      const longContextRates = read(row, long);
      setTier(prices, cleanName(row[0] ?? ''), tier, {
        rates: read(row, short),
        ...(longContextRates.input === null ? {} : { longContextRates }),
      });
    }
  }

  const threshold = /Long context:\s*>\s*([\d,]+)K input tokens/i.exec(markdown);
  if (threshold?.[1]) {
    const tokens = Number(threshold[1].replaceAll(',', '')) * 1000;
    for (const model of prices.models.keys()) prices.longContextAboveInputTokens.set(model, tokens);
  } else {
    prices.problems.push('long context threshold not found');
  }
  return prices;
}

/** Differences between the bundled table and prices read from a provider's pricing page. */
export function diffProvider(
  table: PriceTable,
  provider: Provider,
  page: PagePrices,
): Difference[] {
  const differences: Difference[] = [];
  const add = (
    subject: string,
    bundled: Difference['bundled'],
    onPage: Difference['page'],
  ): void => {
    differences.push({ provider, subject, bundled, page: onPage });
  };
  const providerPrices = table.providers[provider];

  for (const [geo, multiplier] of Object.entries(providerPrices.inferenceGeoMultipliers ?? {})) {
    const onPage = page.inferenceGeoMultipliers.get(geo) ?? null;
    if (onPage !== null && !same(multiplier, onPage))
      add(`inference_geo ${geo} multiplier`, multiplier, onPage);
  }

  for (const [modelId, model] of Object.entries(providerPrices.models)) {
    const rowName = provider === 'anthropic' ? model.label : modelId;
    const pageTiers = page.models.get(rowName);
    if (!pageTiers) {
      add(`${modelId}: model "${rowName}"`, 'listed', 'not found');
      continue;
    }
    diffModel(modelId, model, pageTiers, page.longContextAboveInputTokens.get(rowName), add);
  }
  return differences;
}

function diffModel(
  modelId: string,
  model: ModelPrices,
  pageTiers: Map<string, PageModelTier>,
  pageThreshold: number | undefined,
  add: (subject: string, bundled: Difference['bundled'], page: Difference['page']) => void,
): void {
  const tierNames = new Set([...Object.keys(model.tiers), ...pageTiers.keys()]);
  for (const tierName of tierNames) {
    const bundledTier = model.tiers[tierName];
    const pageTier = pageTiers.get(tierName);
    if (!bundledTier || !pageTier) {
      add(
        `${modelId} ${tierName}`,
        bundledTier ? 'listed' : 'not listed',
        pageTier ? 'listed' : 'not listed',
      );
      continue;
    }
    diffRates(`${modelId} ${tierName}`, bundledTier.rates, pageTier.rates, add);
    if (bundledTier.longContextRates || pageTier.longContextRates) {
      if (!bundledTier.longContextRates || !pageTier.longContextRates) {
        add(
          `${modelId} ${tierName} long context`,
          bundledTier.longContextRates ? 'listed' : 'not listed',
          pageTier.longContextRates ? 'listed' : 'not listed',
        );
      } else {
        diffRates(
          `${modelId} ${tierName} long context`,
          bundledTier.longContextRates,
          pageTier.longContextRates,
          add,
        );
      }
    }
  }
  const bundledThreshold = model.longContextAboveInputTokens ?? null;
  const hasLongContextOnPage = [...pageTiers.values()].some((tier) => tier.longContextRates);
  const pageValue = hasLongContextOnPage ? (pageThreshold ?? null) : null;
  if (bundledThreshold !== pageValue) {
    add(`${modelId} long context threshold (input tokens)`, bundledThreshold, pageValue);
  }
}

function diffRates(
  subject: string,
  bundled: Rates,
  page: PageRates,
  add: (subject: string, bundled: Difference['bundled'], page: Difference['page']) => void,
): void {
  for (const bucket of ['input', 'cacheRead', 'cacheWrite', 'cacheWrite1h', 'output'] as const) {
    const bundledValue = bundled[bucket] ?? null;
    const pageValue = page[bucket];
    if (bundledValue === null && pageValue === null) continue;
    if (bundledValue === null || pageValue === null || !same(bundledValue, pageValue)) {
      add(`${subject} ${bucket}`, bundledValue, pageValue);
    }
  }
}

function same(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

export function formatDifference(difference: Difference): string {
  const show = (value: Difference['bundled']): string => (value === null ? 'none' : String(value));
  return `${difference.provider} ${difference.subject}: bundled ${show(difference.bundled)}, page ${show(difference.page)}`;
}

export interface PricesCheckOptions {
  table?: PriceTable;
  fetch?: (url: string, init: { signal: AbortSignal }) => Promise<Response>;
  log?: (line: string) => void;
  timeoutMs?: number;
}

/**
 * Fetches both pricing pages, prints every difference against the bundled table and returns
 * the process exit code: 0 when equal, 1 when prices differ, 2 when a page could not be read.
 * Never writes files.
 */
export async function runPricesCheck(options: PricesCheckOptions = {}): Promise<number> {
  const table = options.table ?? bundledPriceTable();
  const fetchPage = options.fetch ?? ((url, init) => fetch(url, init));
  const log = options.log ?? ((line: string) => console.log(line));
  const timeoutMs = options.timeoutMs ?? 30_000;
  const parsers: Record<Provider, (markdown: string) => PagePrices> = {
    anthropic: parseAnthropicPage,
    openai: parseOpenAIPage,
  };

  log(`Bundled price table ${table.version}`);
  let differences = 0;
  let failures = 0;
  const results = await Promise.all(
    (Object.keys(parsers) as Provider[]).map(async (provider) => {
      const url = `${table.providers[provider].sourceUrl}.md`;
      try {
        const response = await fetchPage(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return { provider, url, markdown: await response.text() };
      } catch (error) {
        return { provider, url, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );

  for (const result of results) {
    const retrievedAt = table.providers[result.provider].retrievedAt;
    log('');
    log(`${result.provider}: ${result.url} (bundled prices retrieved ${retrievedAt})`);
    if (result.markdown === undefined) {
      failures++;
      log(`  could not fetch: ${result.error}`);
      continue;
    }
    const page = parsers[result.provider](result.markdown);
    for (const problem of page.problems) {
      failures++;
      log(`  could not read page: ${problem}`);
    }
    const found = diffProvider(table, result.provider, page);
    differences += found.length;
    for (const difference of found) log(`  ${formatDifference(difference)}`);
    if (found.length === 0 && page.problems.length === 0) log('  no differences');
  }

  log('');
  if (failures > 0) {
    log(`${failures} page problem(s), ${differences} difference(s). Nothing was written.`);
    return 2;
  }
  if (differences > 0) {
    log(
      `${differences} difference(s). Update server/pricing/prices.json by hand. Nothing was written.`,
    );
    return 1;
  }
  log('Bundled prices match the official pricing pages.');
  return 0;
}
