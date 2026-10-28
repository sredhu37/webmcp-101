import { describe, expect, it, vi } from 'vitest';
import {
  cleanName,
  diffProvider,
  parseAnthropicPage,
  parseMarkdownTables,
  parseOpenAIPage,
  parsePrice,
  runPricesCheck,
} from './official-pages.ts';
import { bundledPriceTable } from './price-table.ts';

const anthropicPage = `---
title: Pricing
---

## Model pricing

| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |
| :---- | :---------------- | :-------------- | :-------------- | :----------------------- | :------------ |
| Claude Fable 5.1 | $10 / MTok | $12.50 / MTok | $20 / MTok | $0.25 / MTok<sup>1</sup> | $50 / MTok |
| Claude Opus 5.5 | $4 / MTok | $5 / MTok | $8 / MTok | $0.20 / MTok<sup>2</sup> | $20 / MTok |
| Claude Opus 4.1 ([retired, except on Bedrock and Google Cloud](https://example.com)) | $15 / MTok | $18.75 / MTok | $30 / MTok | $1.50 / MTok | $75 / MTok |
| Claude Sonnet 5.5 | $2 / MTok | $2.50 / MTok | $4 / MTok | $0.10 / MTok<sup>2</sup> | $10 / MTok |
| Claude Haiku 5.5 (for prompts up to 100,000 tokens) | $0.10 / MTok | $0.125 / MTok | $0.20 / MTok | $0.01 / MTok | $0.50 / MTok |
| Claude Haiku 5.5 (for prompts over 100,000 tokens) | $0.50 / MTok | $0.625 / MTok | $1 / MTok | $0.05 / MTok | $2.50 / MTok |

For Claude 4.6 and later models, using \`inference_geo: "us"\` applies a 1.1x pricing multiplier.

### Fast mode pricing

| Model | Input | Output |
| ----- | ----- | ------ |
| Claude Opus 5.5 | $8 / MTok | $40 / MTok |
| Claude Opus 5 / Claude Opus 4.8 | $10 / MTok | $50 / MTok |

### Batch processing

| Model | Batch input | Batch output |
| ----- | ----------- | ------------ |
| Claude Opus 5.5 | $2 / MTok | $10 / MTok |
`;

const openAIHeader = `| Model | Short context input | Short context cached input | Short context cache writes | Short context output | Long context input | Long context cached input | Long context cache writes | Long context output |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |`;

const openAIPage = `# Pricing

Standard

### Standard pricing data

${openAIHeader}
| gpt-6-astra | $10.00 | $1.00 | $12.50 | $50.00 | $20.00 | $2.00 | $25.00 | $75.00 |
| gpt-6.1-sol | $2.00 | $0.10 | $2.50 | $10.00 | $4.00 | $0.20 | $5.00 | $15.00 |
| gpt-6-luna | $0.10 | $0.01 | $0.125 | $0.50 | $0.20 | $0.02 | $0.25 | $0.75 |
| gpt-5.6-sol | $4.00 | $0.40 | $5.00 | $20.00 | $8.00 | $0.80 | $10.00 | $30.00 |
| gpt-5.2 | $1.75 | $0.175 | - | $14.00 | - | - | - | - |

### Batch pricing data

${openAIHeader}
| gpt-6-luna | $0.05 | $0.005 | $0.0625 | $0.25 | $0.10 | $0.01 | $0.125 | $0.375 |

### Flex pricing data

${openAIHeader}
| gpt-6.1-sol | $1.00 | $0.05 | $1.25 | $5.00 | $2.00 | $0.10 | $2.50 | $7.50 |
| gpt-6-luna | $0.05 | $0.005 | $0.0625 | $0.25 | $0.10 | $0.01 | $0.125 | $0.375 |
| gpt-5.6-sol | $2.00 | $0.20 | $2.50 | $10.00 | $4.00 | $0.40 | $5.00 | $15.00 |

### Fast pricing data

${openAIHeader}
| gpt-6.1-sol | $4.00 | $0.20 | $5.00 | $20.00 | $8.00 | $0.40 | $10.00 | $30.00 |
| gpt-6-luna | $0.20 | $0.02 | $0.25 | $1.00 | $0.40 | $0.04 | $0.50 | $1.50 |
| gpt-5.6-sol | $8.00 | $0.80 | $10.00 | $40.00 | $16.00 | $1.60 | $20.00 | $60.00 |

### Ultrafast pricing data

${openAIHeader}
| gpt-6.1-sol | $12.00 | $0.60 | $15.00 | $60.00 | $24.00 | $1.20 | $30.00 | $90.00 |

Short context: ≤272K input tokens. Long context: >272K input tokens.

### Grouped Pricing Table data

${openAIHeader}
| gpt-5.6-sol | $9.00 | $0.40 | $5.00 | $20.00 | $8.00 | $0.80 | $10.00 | $30.00 |
`;

function fakeFetch(pages: Record<string, string>) {
  return vi.fn((url: string) =>
    Promise.resolve(
      url in pages
        ? new Response(pages[url], { status: 200 })
        : new Response('not found', { status: 404 }),
    ),
  );
}

const pageUrls = {
  anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing.md',
  openai: 'https://developers.openai.com/api/docs/pricing.md',
};

describe('Markdown helpers', () => {
  it('reads tables with their nearest heading', () => {
    const tables = parseMarkdownTables(
      '## Prices\n\n| A | B |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n\ntext',
    );

    expect(tables).toEqual([
      {
        heading: 'Prices',
        header: ['A', 'B'],
        rows: [
          ['1', '2'],
          ['3', '4'],
        ],
      },
    ]);
  });

  it('reads prices and row names', () => {
    expect(parsePrice('$0.20 / MTok<sup>2</sup>')).toBe(0.2);
    expect(parsePrice('$1,200.50')).toBe(1200.5);
    expect(parsePrice('-')).toBeNull();
    expect(cleanName('Claude Opus 4 ([retired, except on Google Cloud](https://x.y/z))')).toBe(
      'Claude Opus 4',
    );
  });
});

describe('page parsers', () => {
  it('reads the Anthropic standard, long context and fast mode prices', () => {
    const page = parseAnthropicPage(anthropicPage);

    expect(page.problems).toEqual([]);
    expect(page.models.get('Claude Haiku 5.5')?.get('standard')).toEqual({
      rates: { input: 0.1, cacheRead: 0.01, cacheWrite: 0.125, cacheWrite1h: 0.2, output: 0.5 },
      longContextRates: {
        input: 0.5,
        cacheRead: 0.05,
        cacheWrite: 0.625,
        cacheWrite1h: 1,
        output: 2.5,
      },
    });
    expect(page.longContextAboveInputTokens.get('Claude Haiku 5.5')).toBe(100_000);
    expect(page.models.get('Claude Opus 4.1')).toBeDefined();
    expect(page.models.get('Claude Opus 5.5')?.get('fast')?.rates).toEqual({
      input: 8,
      cacheRead: 0.4,
      cacheWrite: 10,
      cacheWrite1h: 16,
      output: 40,
    });
    expect(page.inferenceGeoMultipliers.get('us')).toBe(1.1);
  });

  it('reads the OpenAI flagship tier tables and skips batch', () => {
    const page = parseOpenAIPage(openAIPage);

    expect(page.problems).toEqual([]);
    expect([...(page.models.get('gpt-6.1-sol')?.keys() ?? [])]).toEqual([
      'standard',
      'flex',
      'fast',
      'ultrafast',
    ]);
    expect(page.models.get('gpt-5.6-sol')?.get('standard')?.rates.input).toBe(4);
    expect(page.models.get('gpt-5.2')?.get('standard')).toEqual({
      rates: { input: 1.75, cacheRead: 0.175, cacheWrite: null, cacheWrite1h: null, output: 14 },
    });
    expect(page.longContextAboveInputTokens.get('gpt-6-luna')).toBe(272_000);
  });

  it('reports pages it cannot read', () => {
    expect(parseAnthropicPage('# Nothing here').problems).toHaveLength(3);
    expect(parseOpenAIPage('# Nothing here').problems).toEqual([
      'standard pricing table not found',
      'long context threshold not found',
    ]);
  });
});

describe('diffProvider', () => {
  it('finds no differences when the pages match the bundled table', () => {
    const table = bundledPriceTable();

    expect(diffProvider(table, 'anthropic', parseAnthropicPage(anthropicPage))).toEqual([]);
    expect(diffProvider(table, 'openai', parseOpenAIPage(openAIPage))).toEqual([]);
  });

  it('reports changed rates, thresholds, tiers and missing models', () => {
    const changedAnthropic = anthropicPage
      .replace('| Claude Sonnet 5.5 | $2 / MTok', '| Claude Sonnet 5.5 | $3 / MTok')
      .replaceAll('100,000 tokens', '200,000 tokens')
      .replace('applies a 1.1x', 'applies a 1.2x')
      .replace(/\| Claude Opus 5\.5 \| \$8 .*\n/, '');
    const changedOpenAI = openAIPage
      .replace(
        '| gpt-6-luna | $0.10 | $0.01 | $0.125 | $0.50 |',
        '| gpt-6-luna | $0.12 | $0.01 | $0.125 | $0.50 |',
      )
      .replace(/\| gpt-5\.6-sol \| \$2\.00 .*\n/, '')
      .replace(/\| gpt-6\.1-sol \| \$12\.00/, '| gpt-6-luna | $12.00');

    const anthropic = diffProvider(
      bundledPriceTable(),
      'anthropic',
      parseAnthropicPage(changedAnthropic),
    );
    const openai = diffProvider(bundledPriceTable(), 'openai', parseOpenAIPage(changedOpenAI));

    expect(anthropic).toEqual([
      { provider: 'anthropic', subject: 'inference_geo us multiplier', bundled: 1.1, page: 1.2 },
      {
        provider: 'anthropic',
        subject: 'claude-haiku-5-5 long context threshold (input tokens)',
        bundled: 100_000,
        page: 200_000,
      },
      { provider: 'anthropic', subject: 'claude-sonnet-5-5 standard input', bundled: 2, page: 3 },
      {
        provider: 'anthropic',
        subject: 'claude-opus-5-5 fast',
        bundled: 'listed',
        page: 'not listed',
      },
    ]);
    expect(openai).toEqual([
      { provider: 'openai', subject: 'gpt-6-luna standard input', bundled: 0.1, page: 0.12 },
      {
        provider: 'openai',
        subject: 'gpt-6-luna ultrafast',
        bundled: 'not listed',
        page: 'listed',
      },
      {
        provider: 'openai',
        subject: 'gpt-6.1-sol ultrafast',
        bundled: 'listed',
        page: 'not listed',
      },
      { provider: 'openai', subject: 'gpt-5.6-sol flex', bundled: 'listed', page: 'not listed' },
    ]);
  });

  it('reports a model missing from the page', () => {
    const page = parseOpenAIPage(openAIPage.replaceAll('gpt-6-luna', 'gpt-6-luna-2'));

    expect(diffProvider(bundledPriceTable(), 'openai', page)).toContainEqual({
      provider: 'openai',
      subject: 'gpt-6-luna: model "gpt-6-luna"',
      bundled: 'listed',
      page: 'not found',
    });
  });
});

describe('runPricesCheck', () => {
  it('fetches the Markdown pricing pages and exits 0 when they match', async () => {
    const fetch = fakeFetch({ [pageUrls.anthropic]: anthropicPage, [pageUrls.openai]: openAIPage });
    const lines: string[] = [];

    const code = await runPricesCheck({ fetch, log: (line) => lines.push(line) });

    expect(code).toBe(0);
    expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual(
      [pageUrls.anthropic, pageUrls.openai].sort(),
    );
    expect(lines.at(-1)).toBe('Bundled prices match the official pricing pages.');
  });

  it('prints differences and exits 1', async () => {
    const fetch = fakeFetch({
      [pageUrls.anthropic]: anthropicPage.replace(
        '$20 / MTok |\n| Claude Opus 4.1',
        '$25 / MTok |\n| Claude Opus 4.1',
      ),
      [pageUrls.openai]: openAIPage,
    });
    const lines: string[] = [];

    const code = await runPricesCheck({ fetch, log: (line) => lines.push(line) });

    expect(code).toBe(1);
    expect(lines).toContain('  anthropic claude-opus-5-5 standard output: bundled 20, page 25');
  });

  it('does not crash when the network fails and exits 2', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('getaddrinfo ENOTFOUND')));
    const lines: string[] = [];

    const code = await runPricesCheck({ fetch, log: (line) => lines.push(line) });

    expect(code).toBe(2);
    expect(
      lines.filter((line) => line.includes('could not fetch: getaddrinfo ENOTFOUND')),
    ).toHaveLength(2);
  });

  it('treats an HTTP error as a page problem', async () => {
    const lines: string[] = [];

    const code = await runPricesCheck({
      fetch: fakeFetch({ [pageUrls.openai]: openAIPage }),
      log: (line) => lines.push(line),
    });

    expect(code).toBe(2);
    expect(lines).toContain('  could not fetch: HTTP 404');
  });
});
