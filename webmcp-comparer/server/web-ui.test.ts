import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { chromium, type Browser, type Page } from 'playwright';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LaneId } from './lane/browser.ts';
import { createApp } from './app.ts';
import { viteConfigFile } from './paths.ts';
import { bundledPriceTable } from './pricing/price-table.ts';
import {
  fixtureSuiteFile,
  startFixtureSite,
  type RunningFixtureSite,
} from './testing/fixture-site.ts';
import { scriptedModel, type ScriptedReply } from './testing/scripted-model.ts';

/**
 * Smoke test of the web UI: a production build of web/ served by the real app server, in
 * headless Chromium, with real Lanes on the fixture site driven by a scripted model. Set
 * UI_SCREENSHOT_DIR=<folder> to also save setup.png, live.png and results.png there.
 */

const screenshotDir = process.env.UI_SCREENSHOT_DIR;

/** Saves a screenshot of one section with a margin of page around it. */
async function sectionScreenshot(page: Page, selector: string, file: string): Promise<void> {
  if (!screenshotDir) return;
  await page.mouse.move(0, 999);
  const section = page.locator(selector);
  await section.scrollIntoViewIfNeeded();
  const box = await section.boundingBox();
  if (!box) throw new Error(`${selector} is not visible`);
  const margin = 24;
  await page.screenshot({
    path: join(screenshotDir, file),
    fullPage: true,
    clip: {
      x: Math.max(0, box.x - margin),
      y: Math.max(0, box.y + Number(await page.evaluate('window.scrollY')) - margin),
      width: box.width + margin * 2,
      height: box.height + margin * 2,
    },
  });
}

const okFetch = (() =>
  Promise.resolve(new Response('{"data":[]}', { status: 200 }))) as typeof globalThis.fetch;

const finish = (success: boolean, answer: string): ScriptedReply => ({
  toolCalls: [{ name: 'finish', input: { success, answer } }],
});

/** What the scripted model does per Lane, Scenario and Attempt. */
function script(lane: LaneId, scenario: string, attempt: number): ScriptedReply[] {
  if (scenario === 'first-open-todo') {
    if (lane === 'webmcp') {
      return [
        { toolCalls: [{ name: 'list_todos', input: {} }] },
        finish(true, 'The first to-do is Water the plants.'),
      ];
    }
    return [
      ...(attempt === 1 ? [{ toolCalls: [{ name: 'read_page' }] }] : []),
      {
        toolCalls: [
          { name: 'type', input: { target: { selector: 'input[name=title]' }, text: 'Buy milk' } },
        ],
      },
      {
        toolCalls: [
          {
            name: 'select',
            input: { target: { selector: 'select[name=priority]' }, value: 'high' },
          },
        ],
      },
      {
        toolCalls: [
          { name: 'click', input: { target: { selector: '#add-todo button[type=submit]' } } },
        ],
      },
      { toolCalls: [{ name: 'screenshot' }] },
      finish(true, 'The first to-do is Water the plants.'),
    ];
  }
  if (lane === 'webmcp') {
    return [
      ...(attempt === 2 ? [{ toolCalls: [{ name: 'list_todos', input: {} }] }] : []),
      {
        toolCalls: [{ name: 'add_todo', input: { title: 'Buy milk' } }],
      },
      finish(true, 'Added Buy milk.'),
    ];
  }
  return [
    { toolCalls: [{ name: 'navigate', input: { url: '/done' } }] },
    { toolCalls: [{ name: 'screenshot' }] },
    finish(false, 'I could not find the form.'),
  ];
}

interface PastRunFixture {
  id: string;
  startedAt: string;
  siteUrl: string;
  provider: 'anthropic' | 'openai';
  model: string;
  baseline: [pass: number, fail: number];
  webmcp: [pass: number, fail: number];
  stoppedByUser?: boolean;
}

const PAST_RUNS: PastRunFixture[] = [
  {
    id: '2026-10-15_14-30-05',
    startedAt: '2026-10-15T12:30:05.000Z',
    siteUrl: 'http://localhost:4000',
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    baseline: [3, 1],
    webmcp: [4, 0],
  },
  {
    id: '2026-10-15_11-02-41',
    startedAt: '2026-10-15T09:02:41.000Z',
    siteUrl: 'https://shop.example.com/de',
    provider: 'openai',
    model: 'gpt-6-luna',
    baseline: [1, 1],
    webmcp: [2, 0],
  },
  {
    id: '2026-10-14_17-45-12',
    startedAt: '2026-10-14T15:45:12.000Z',
    siteUrl: 'http://localhost:4000',
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    baseline: [0, 1],
    webmcp: [0, 1],
    stoppedByUser: true,
  },
];

async function writePastRun(runsDir: string, fixture: PastRunFixture): Promise<void> {
  const lane = ([pass, fail]: [number, number]) => ({
    pass,
    fail,
    durationMs: 0,
    steps: 0,
    tokens: {
      input: 0,
      cacheRead: 0,
      cacheWrite: 0,
      output: 0,
      reasoning: 0,
      screenshotEstimate: 0,
    },
    costUsd: 0,
    toolCalls: {},
    toolCallsTotal: 0,
    screenshots: 0,
  });
  const results = {
    run: {
      id: fixture.id,
      startedAt: fixture.startedAt,
      endedAt: fixture.startedAt,
      durationMs: 60_000,
      siteUrl: fixture.siteUrl,
      provider: fixture.provider,
      model: fixture.model,
      effort: 'medium',
      attempts: 1,
      limits: { maxSteps: 50, maxDurationMs: 300_000, maxCostUsd: 2 },
      scenarioIds: ['first-open-todo'],
      priceTableVersion: 'test',
      priceTableOverride: null,
      systemPromptVersion: '1',
      stoppedByUser: fixture.stoppedByUser ?? false,
      error: null,
    },
    summary: { baseline: lane(fixture.baseline), webmcp: lane(fixture.webmcp) },
    scenarios: [],
    suite: {
      source: 'scenarios:\n  - id: first-open-todo\n    prompt: Hi\n',
      scenarios: [],
    },
  };
  await mkdir(join(runsDir, fixture.id), { recursive: true });
  await writeFile(join(runsDir, fixture.id, 'results.json'), JSON.stringify(results));
}

describe('web UI', () => {
  let app: FastifyInstance;
  let browser: Browser;
  let page: Page;
  let tmp: string;
  let url: string;
  let site: RunningFixtureSite;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'webmcp-comparer-ui-'));
    const webDist = join(tmp, 'web');
    const runsDir = join(tmp, 'runs');
    await build({
      configFile: viteConfigFile,
      logLevel: 'error',
      build: { outDir: webDist, emptyOutDir: true },
    });
    for (const fixture of PAST_RUNS) await writePastRun(runsDir, fixture);
    site = await startFixtureSite();
    app = await createApp({
      webDist,
      runs: {
        runsDir,
        defaultSuiteFile: fixtureSuiteFile,
        env: { ANTHROPIC_API_KEY: 'placeholder-not-a-real-key' },
        // The key check answers OK without a network call; the Lanes get the scripted model.
        fetch: okFetch,
        loadPriceTable: () => Promise.resolve({ ...bundledPriceTable(), override: null }),
        createModel: ({ lane, scenario, attempt }) =>
          scriptedModel(script(lane, scenario, attempt), { delayMs: 450 }),
        laneOptions: {
          browser: { actionTimeoutMs: 3_000, navigationTimeoutMs: 5_000 },
          toolTimeouts: { waitForTextMs: 2_000, pauseMs: 100 },
          webmcpCallTimeoutMs: 2_000,
          maxRetries: 0,
        },
      },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    url = `http://127.0.0.1:${address.port}/`;
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await app?.close();
    await site?.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it('renders Setup with the prefilled Site URL, Suite and settings, and the Past Runs', async () => {
    await page.goto(url);
    await page.getByRole('heading', { name: 'Setup' }).waitFor({ timeout: 60_000 });

    expect(await page.getByLabel('Site URL').inputValue()).toBe('http://localhost:4000');

    const editorLines = page.locator('.monaco-editor .view-lines');
    await expect
      .poll(() => editorLines.textContent(), { timeout: 60_000 })
      .toContain('first-open-todo');
    await expect.poll(() => page.getByText('Valid Suite, 4 Scenarios').count()).toBe(1);

    const boxes = page.locator('.scenario-list input[type=checkbox]');
    expect(await boxes.count()).toBe(4);
    const checked = [];
    for (let i = 0; i < 4; i++) checked.push(await boxes.nth(i).isChecked());
    expect(checked).toEqual([true, false, false, false]);

    expect(await page.getByLabel('Model').inputValue()).toBe('claude-haiku-5-5');
    expect(await page.getByLabel('API key').getAttribute('placeholder')).toBe('Loaded from .env');
    expect(await page.getByLabel('Repeat').inputValue()).toBe('1');
    expect(await page.getByLabel('Max Steps').inputValue()).toBe('50');
    expect(await page.getByLabel('Max minutes').inputValue()).toBe('5');
    expect(await page.getByLabel('Max cost').inputValue()).toBe('2.00');

    const run = page.getByRole('button', { name: 'Run 1 Scenario' });
    expect(await run.isEnabled()).toBe(true);
    await page.getByRole('button', { name: 'Select all' }).click();
    await page.getByRole('button', { name: 'Run 4 Scenarios' }).waitFor();
    await page.getByRole('button', { name: 'Select none' }).click();
    await page.locator('.scenario-list input[type=checkbox]').nth(0).check();
    await page.locator('.scenario-list input[type=checkbox]').nth(1).check();
    await page.getByRole('button', { name: 'Run 2 Scenarios' }).waitFor();

    const items = page.locator('.run-item');
    expect(await items.count()).toBe(3);
    expect(await items.first().textContent()).toContain('Haiku 5.5');
    expect(await items.nth(1).textContent()).toContain('shop.example.com/de');

    if (screenshotDir) {
      await page.evaluate('document.fonts.ready');
      await page.mouse.move(0, 999);
      await page.screenshot({ path: join(screenshotDir, 'setup.png'), fullPage: true });
    }
  }, 120_000);

  it('validates the Suite live, marks the line in the editor and disables Run', async () => {
    await page.locator('.monaco-editor .view-line').first().click();
    await page.locator('.monaco-editor.focused').waitFor();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
    await page.keyboard.type('owner: me\n');
    // Monaco renders spaces as no-break spaces.
    const editorText = async () =>
      (await page.locator('.monaco-editor .view-lines').textContent())?.replaceAll('\u00a0', ' ');
    await expect.poll(editorText).toContain('owner: me');

    await page.getByText('1 error in the Suite').waitFor();
    expect(await page.locator('.error-line').first().textContent()).toContain('Line 1');
    await expect
      .poll(() => page.locator('.monaco-editor .squiggly-error').count(), { timeout: 10_000 })
      .toBeGreaterThan(0);
    expect(await page.getByRole('button', { name: 'Run 2 Scenarios' }).isDisabled()).toBe(true);
    expect(await page.getByText('Fix the Suite errors to run.').count()).toBe(1);

    // Delete the added line again.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Backspace');
    await page.getByText('Valid Suite, 4 Scenarios').waitFor();
    expect(await page.getByRole('button', { name: 'Run 2 Scenarios' }).isEnabled()).toBe(true);
  }, 60_000);

  it('runs a Run end to end: Live streams both Lanes, then Results shows the Scenarios', async () => {
    await page.getByLabel('Site URL').fill(site.baseUrl);
    await page.getByLabel('Repeat').fill('2');
    await page.getByRole('button', { name: 'Run 2 Scenarios, 2 Attempts each' }).click();

    // Live: both Lanes with frames, Step meters, the scoreboard and the tool-call logs.
    const live = page.locator('#live');
    await live.getByText('Scenario 1 of 2').waitFor({ timeout: 30_000 });
    expect(await live.textContent()).toContain('first-open-todo');
    expect(await live.textContent()).toContain('Attempt 1 of 2');
    await expect
      .poll(() => live.locator('canvas[data-frame="drawn"]').count(), { timeout: 30_000 })
      .toBe(2);
    const baselineLog = page.getByRole('log', { name: 'Baseline tool calls, newest first' });
    const webmcpLog = page.getByRole('log', { name: 'WebMCP tool calls, newest first' });
    await expect
      .poll(() => baselineLog.locator('.tool-row').count(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(3);
    await expect
      .poll(() => webmcpLog.locator('.tool-row[data-source="webmcp"]').count())
      .toBeGreaterThanOrEqual(1);
    expect(await webmcpLog.locator('.tool-row').first().locator('.tool-name').textContent()).toBe(
      'list_todos',
    );
    // Newest first: the Baseline's latest call is above its first one.
    const names = await baselineLog.locator('.tool-name').allTextContents();
    expect(names.at(-1)).toBe('read_page');
    expect(
      await live.getByRole('meter', { name: 'Baseline Steps' }).getAttribute('aria-valuemax'),
    ).toBe('50');
    expect(await live.locator('.scoreboard tbody tr').count()).toBe(6);
    expect(await live.getByRole('button', { name: 'Stop Run' }).isEnabled()).toBe(true);
    await sectionScreenshot(page, '#live', 'live.png');

    // Results, once the Run ends: one row per Scenario, collapsed, with the verdicts.
    const results = page.locator('#results');
    await results.getByRole('heading', { name: 'Run summary' }).waitFor({ timeout: 120_000 });
    expect(await live.getByText('Run ended').count()).toBe(1);
    expect(await live.getByRole('button', { name: 'Stop Run' }).count()).toBe(0);
    expect(await results.textContent()).toContain('Baseline passed 2/4');
    expect(await results.textContent()).toContain('WebMCP passed 4/4');
    const rows = results.locator('.scenario-row');
    expect(await rows.count()).toBe(2);
    expect(await rows.nth(0).locator('.scenario-name').textContent()).toBe('first-open-todo');
    const verdicts = await rows.nth(1).locator('.scenario-verdict').allTextContents();
    expect(verdicts[0]).toMatch(/^BaselineFail 0\/2Attempt 2: /);
    expect(verdicts[1]).toBe('WebMCPPass 2/2');
    expect(await results.locator('.scenario-body').count()).toBe(0);

    await rows.nth(0).getByRole('button').click();
    const body = rows.nth(0).locator('.scenario-body');
    expect(await body.textContent()).toContain('Averages over 2 Attempts');
    expect(await body.locator('.attempt-table tbody tr').count()).toBe(2);
    expect(await body.locator('[data-metric="steps"] .bar-range').count()).toBe(2);
    if (screenshotDir) {
      // Let the bars finish growing.
      await page.waitForTimeout(900);
      await sectionScreenshot(page, '#results', 'results.png');
    }
  }, 180_000);

  it('opens a Past Run into Setup, Live and Results', async () => {
    await page.getByRole('button', { name: 'Open Run 2026-10-15_11-02-41' }).click();
    // Results already shows the Run above; wait for the opened one.
    await page.locator('#results').getByText('shop.example.com/de', { exact: false }).waitFor();
    expect(await page.getByLabel('Site URL').inputValue()).toBe('https://shop.example.com/de');
    expect(await page.getByLabel('Provider').inputValue()).toBe('openai');
    expect(await page.getByLabel('Model').inputValue()).toBe('gpt-6-luna');
    expect(await page.getByLabel('API key').inputValue()).toBe('');
    expect(await page.locator('#results').textContent()).toContain('Baseline passed 1/2');
    // The fixture Run took no screenshots: both screens show the empty state.
    expect(await page.locator('#live').getByText('No screenshots in this Run').count()).toBe(2);
  }, 60_000);

  it("shows each Lane's last screenshot when a Run with screenshots is opened", async () => {
    // The Run made above is the newest.
    await page
      .locator('.run-item')
      .first()
      .getByRole('button', { name: /^Open Run / })
      .click();
    const live = page.locator('#live');
    await live.getByText('Past Run').waitFor();
    const image = live.locator('.lane[data-lane="baseline"] img');
    expect(await image.getAttribute('src')).toMatch(
      /\/baseline\/screenshots\/004-add-todo-attempt-2\.jpg$/,
    );
    await expect
      .poll(() =>
        image.evaluate((element) => {
          const img = element as unknown as { complete: boolean; naturalWidth: number };
          return img.complete ? img.naturalWidth : 0;
        }),
      )
      .toBeGreaterThan(0);
    expect(
      await live
        .locator('.lane[data-lane="webmcp"]')
        .getByText('No screenshots in this Run')
        .count(),
    ).toBe(1);
  }, 60_000);
});
