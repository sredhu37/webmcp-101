import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LogRecord } from '../agent/lane-log.ts';
import { DEFAULT_LIMITS } from '../agent/run-lane.ts';
import { SYSTEM_PROMPT_VERSION } from '../agent/prompts.ts';
import { bundledPriceTable } from '../pricing/price-table.ts';
import {
  fixtureSuiteFile,
  startFixtureSite,
  type RunningFixtureSite,
} from '../testing/fixture-site.ts';
import { fakeRunLane, type FakeLanePlan } from '../testing/fake-run-lane.ts';
import {
  scriptedModel,
  type ScriptedModel,
  type ScriptedReply,
} from '../testing/scripted-model.ts';
import { ApiKeys } from './keys.ts';
import {
  RunError,
  RunManager,
  type LanePage,
  type ModelRequest,
  type RunEvent,
  type RunManagerOptions,
} from './orchestrator.ts';
import type { Results } from './results.ts';
import { parseRunRequest, type RunRequest } from './settings.ts';

const testTimeout = 60_000;
const SUITE = readFileSync(fixtureSuiteFile, 'utf8');
const ENV_KEY = 'sk-ant-env-0123456789abcdefghijklmnopqrstuvwxyz';
const PASTED_KEY = 'sk-ant-pasted-0123456789abcdefghijklmnopqrstuvwxyz';
const FIXED_START = new Date(2026, 9, 15, 14, 30, 5);

let runsRoot: string;

beforeAll(async () => {
  runsRoot = await mkdtemp(join(tmpdir(), 'orchestrator-'));
});

afterAll(async () => {
  await rm(runsRoot, { recursive: true, force: true });
});

function request(body: Record<string, unknown> = {}): RunRequest {
  const parsed = parseRunRequest({
    siteUrl: 'http://127.0.0.1:9',
    suite: SUITE,
    scenarioIds: ['first-open-todo'],
    model: 'claude-haiku-5-5',
    ...body,
  });
  if (!parsed.ok) throw new Error(parsed.errors.join(' '));
  return parsed.request;
}

const okFetch = (() =>
  Promise.resolve(new Response('{"data":[]}', { status: 200 }))) as typeof globalThis.fetch;

interface Harness {
  manager: RunManager;
  runsDir: string;
  events: RunEvent[];
  pages: LanePage[];
  models: ModelRequest[];
  keys: ApiKeys;
}

let harnessCount = 0;

function harness(options: Partial<RunManagerOptions> = {}): Harness {
  harnessCount += 1;
  const runsDir = join(runsRoot, `runs-${harnessCount}`);
  const keys = options.keys ?? new ApiKeys({ ANTHROPIC_API_KEY: ENV_KEY });
  const models: ModelRequest[] = [];
  const manager = new RunManager({
    runsDir,
    keys,
    fetch: okFetch,
    loadPriceTable: () => Promise.resolve({ ...bundledPriceTable(), override: null }),
    createModel: (model) => {
      models.push(model);
      return scriptedModel([]);
    },
    now: () => FIXED_START,
    ...options,
  });
  const events: RunEvent[] = [];
  const pages: LanePage[] = [];
  manager.subscribe({
    event: (event) => events.push(event),
    page: (page) => void pages.push(page),
  });
  return { manager, runsDir, events, pages, models, keys };
}

/** The event types without the Lane log records, `scenario_start:<id>` style. */
function flow(events: RunEvent[]): string[] {
  return events
    .filter((event) => event.type !== 'lane')
    .map((event) => {
      const parts: string[] = [event.type];
      if ('scenario' in event) parts.push(event.scenario);
      if ('attempt' in event) parts.push(String(event.attempt));
      return parts.join(':');
    });
}

async function readJson(path: string): Promise<Results> {
  return JSON.parse(await readFile(path, 'utf8')) as Results;
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

describe('orchestration (stand-in Lanes)', () => {
  it('runs Scenarios one at a time, Attempts in order, and both Lanes in parallel', async () => {
    const runLane = fakeRunLane((o) => ({ delayMs: o.lane === 'baseline' ? 40 : 10 }));
    const h = harness({ runLane });
    const run = await h.manager.start(
      request({
        scenarioIds: ['add-todo', 'first-open-todo'],
        attempts: 2,
        limits: { maxSteps: 7, maxDurationMs: 60_000, maxCostUsd: 0.25 },
      }),
    );
    expect(run.id).toBe('2026-10-15_14-30-05');
    await run.done;

    const s1 = 'first-open-todo';
    const s2 = 'add-todo';
    const lanes = (s: string, n: number): string[] => [
      `start:baseline:${s}:${n}`,
      `start:webmcp:${s}:${n}`,
      `end:webmcp:${s}:${n}`,
      `end:baseline:${s}:${n}`,
    ];
    expect(runLane.timeline).toEqual([
      ...lanes(s1, 1),
      ...lanes(s1, 2),
      ...lanes(s2, 1),
      ...lanes(s2, 2),
    ]);
    expect(flow(h.events)).toEqual([
      'run_start',
      `scenario_start:${s1}`,
      `attempt_start:${s1}:1`,
      `attempt_end:${s1}:1`,
      `attempt_start:${s1}:2`,
      `attempt_end:${s1}:2`,
      `scenario_end:${s1}`,
      `scenario_start:${s2}`,
      `attempt_start:${s2}:1`,
      `attempt_end:${s2}:1`,
      `attempt_start:${s2}:2`,
      `attempt_end:${s2}:2`,
      `scenario_end:${s2}`,
      'run_end',
    ]);

    // Limits, Site URL, abort signal and one model per Lane per Attempt.
    for (const call of runLane.calls) {
      expect(call.limits).toEqual({ maxSteps: 7, maxDurationMs: 60_000, maxCostUsd: 0.25 });
      expect(call.siteUrl).toBe('http://127.0.0.1:9');
      expect(call.signal).toBeInstanceOf(AbortSignal);
    }
    expect(h.models).toHaveLength(8);
    expect(h.models[0]).toEqual({
      modelId: 'claude-haiku-5-5',
      apiKey: ENV_KEY,
      lane: 'baseline',
      scenario: s1,
      attempt: 1,
    });
    // Each Lane shares one log for the whole Run.
    const lane = h.events.filter((e) => e.type === 'lane').map((e) => e.record.event);
    expect(lane).toHaveLength(16);
  });

  it('writes results.json: run, summary, scenarios (comparison, attempts), suite', async () => {
    const plans: Record<string, FakeLanePlan['result']> = {
      'baseline:1': {
        durationMs: 3_000,
        steps: 6,
        costUsd: 0.03,
        toolCalls: { click: 4 },
        toolCallsTotal: 4,
        screenshots: 2,
      },
      'baseline:2': {
        outcome: 'fail',
        reason: 'step limit',
        durationMs: 5_000,
        steps: 10,
        costUsd: 0.05,
        toolCalls: { click: 9, navigate: 1 },
        toolCallsTotal: 10,
      },
      'baseline:3': { durationMs: 4_000, steps: 8, costUsd: 0.04 },
      'webmcp:1': {
        durationMs: 1_000,
        steps: 2,
        costUsd: 0.01,
        toolCalls: { add_todo: 1 },
        toolCallsTotal: 1,
        webmcpTools: ['add_todo'],
      },
      'webmcp:2': { durationMs: 2_000, steps: 3, costUsd: 0.02 },
      'webmcp:3': { durationMs: 3_000, steps: 4, costUsd: 0.03 },
    };
    const runLane = fakeRunLane((o) => ({ result: plans[`${o.lane}:${o.attempt}`] }));
    const h = harness({ runLane });
    const run = await h.manager.start(request({ attempts: 3 }));
    const final = await run.done;
    const results = await readJson(join(run.dir, 'results.json'));

    expect(results).toEqual(final);
    expect(Object.keys(results)).toEqual(['run', 'summary', 'scenarios', 'suite']);
    expect(results.run).toMatchObject({
      id: run.id,
      startedAt: FIXED_START.toISOString(),
      siteUrl: 'http://127.0.0.1:9',
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      effort: 'medium',
      attempts: 3,
      limits: DEFAULT_LIMITS,
      scenarioIds: ['first-open-todo'],
      priceTableVersion: bundledPriceTable().version,
      priceTableOverride: null,
      systemPromptVersion: SYSTEM_PROMPT_VERSION,
      stoppedByUser: false,
      error: null,
    });
    expect(results.run.durationMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(results.run.endedAt!)).toBeGreaterThanOrEqual(FIXED_START.getTime());

    expect(results.summary.baseline).toMatchObject({
      pass: 2,
      fail: 1,
      durationMs: 12_000,
      steps: 24,
      toolCalls: { click: 13, navigate: 1 },
      toolCallsTotal: 14,
      screenshots: 2,
    });
    expect(results.summary.baseline.costUsd).toBeCloseTo(0.12);
    expect(results.summary.webmcp).toMatchObject({ pass: 3, fail: 0, durationMs: 6_000 });

    const [scenario] = results.scenarios;
    expect(Object.keys(scenario!)).toEqual([
      'id',
      'prompt',
      'startUrl',
      'status',
      'comparison',
      'attempts',
    ]);
    expect(scenario).toMatchObject({
      id: 'first-open-todo',
      startUrl: 'http://127.0.0.1:9/',
      status: 'done',
    });
    const { baseline, webmcp } = scenario!.comparison!;
    expect(baseline).toMatchObject({
      attempts: 3,
      pass: 2,
      fail: 1,
      passRate: 2 / 3,
      durationMs: 4_000,
      steps: 8,
      toolCalls: { click: 13 / 3, navigate: 1 / 3 },
      min: { durationMs: 3_000, steps: 6, costUsd: 0.03, toolCalls: { click: 0, navigate: 0 } },
      max: { durationMs: 5_000, steps: 10, costUsd: 0.05, toolCalls: { click: 9, navigate: 1 } },
    });
    expect(baseline.costUsd).toBeCloseTo(0.04);
    expect(webmcp).toMatchObject({
      passRate: 1,
      durationMs: 2_000,
      steps: 3,
      webmcpTools: ['add_todo'],
      min: { durationMs: 1_000 },
      max: { durationMs: 3_000 },
    });
    expect(
      scenario!.attempts.map((a) => [a.attempt, a.baseline.outcome, a.baseline.reason]),
    ).toEqual([
      [1, 'pass', null],
      [2, 'fail', 'step limit'],
      [3, 'pass', null],
    ]);
    expect(Object.keys(scenario!.attempts[0]!)).toEqual(['attempt', 'baseline', 'webmcp']);
    expect(Object.keys(scenario!.attempts[0]!.baseline)).toEqual([
      'outcome',
      'reason',
      'answer',
      'durationMs',
      'steps',
      'tokens',
      'costUsd',
      'toolCalls',
      'toolCallsTotal',
      'screenshots',
      'webmcpTools',
    ]);
    expect(results.suite.source).toBe(SUITE);
    expect(results.suite.scenarios.map((s) => s.id)).toHaveLength(4);
  });

  it('Stop Run keeps finished Lanes, Fails running ones and skips the rest', async () => {
    const stopAt = 'add-todo';
    const runLane = fakeRunLane((o) =>
      o.scenario.id === stopAt && o.lane === 'webmcp' ? { untilStopped: true } : {},
    );
    const h = harness({ runLane });
    const stops: boolean[] = [];
    h.manager.subscribe({
      event: (event) => {
        if (
          event.type === 'lane' &&
          event.record.event === 'lane_end' &&
          event.record.lane === 'baseline' &&
          event.record.scenario === stopAt
        ) {
          stops.push(h.manager.stop(event.runId));
        }
      },
    });
    const run = await h.manager.start(
      request({
        scenarioIds: ['first-open-todo', stopAt, 'create-from-new-page', 'finish-watering'],
        attempts: 2,
      }),
    );
    const results = await run.done;

    expect(stops).toEqual([true]);
    expect(results.run.stoppedByUser).toBe(true);
    expect(results.scenarios.map((s) => [s.id, s.status, s.attempts.length])).toEqual([
      ['first-open-todo', 'done', 2],
      [stopAt, 'stopped', 1],
      ['create-from-new-page', 'skipped', 0],
      ['finish-watering', 'skipped', 0],
    ]);
    const stopped = results.scenarios[1]!.attempts[0]!;
    expect(stopped.baseline).toMatchObject({ outcome: 'pass', reason: null, steps: 1 });
    expect(stopped.webmcp).toMatchObject({ outcome: 'fail', reason: 'stopped by user', steps: 1 });
    expect(results.scenarios[2]!.comparison).toBeNull();
    expect(results.summary.baseline).toMatchObject({ pass: 3, fail: 0 });
    expect(results.summary.webmcp).toMatchObject({ pass: 2, fail: 1 });
    expect(runLane.calls).toHaveLength(6);
    expect(flow(h.events).slice(-5)).toEqual([
      `attempt_end:${stopAt}:1`,
      `scenario_end:${stopAt}`,
      'scenario_skipped:create-from-new-page',
      'scenario_skipped:finish-watering',
      'run_end',
    ]);
    expect(h.manager.current).toBeNull();
    expect(h.manager.stop(run.id)).toBe(false);
  });

  it('skips every Scenario when Stop Run comes before any Lane starts', async () => {
    const runLane = fakeRunLane();
    const h = harness({ runLane });
    const run = await h.manager.start(
      request({ scenarioIds: ['first-open-todo', 'finish-watering'] }),
    );
    run.stop();
    const results = await run.done;
    expect(results.scenarios.map((s) => s.status)).toEqual(['skipped', 'skipped']);
    expect(results.run.stoppedByUser).toBe(true);
    expect(runLane.calls).toHaveLength(0);
  });

  it('allows one Run at a time', async () => {
    const runLane = fakeRunLane(() => ({ untilStopped: true }));
    const h = harness({ runLane });
    const first = await h.manager.start(request());
    const second = h.manager.start(request());
    await expect(second).rejects.toThrow(RunError);
    await expect(second).rejects.toMatchObject({
      statusCode: 409,
      message: `A Run is already going: ${first.id}`,
    });
    expect(h.manager.current).toBe(first);

    await h.manager.close();
    expect((await first.done).run.stoppedByUser).toBe(true);
    const again = await h.manager.start(request());
    expect(again.id).toBe(`${first.id}-2`);
    h.manager.stop();
    await again.done;
  });

  it('errors before any Lane starts when the key is rejected or missing', async () => {
    const runLane = fakeRunLane();
    const rejected = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 }),
      )) as typeof globalThis.fetch;
    const h = harness({ runLane, fetch: rejected });

    await expect(h.manager.start(request())).rejects.toMatchObject({
      statusCode: 400,
      message: 'Anthropic rejected the API key (HTTP 401: invalid x-api-key).',
    });
    const noKey = harness({ runLane, keys: new ApiKeys({}) });
    await expect(noKey.manager.start(request())).rejects.toMatchObject({
      statusCode: 400,
      message: 'No Anthropic API key: paste one or set ANTHROPIC_API_KEY in .env.',
    });

    expect(runLane.calls).toHaveLength(0);
    await expect(readdir(h.runsDir)).rejects.toThrow('ENOENT');
    expect(h.events).toEqual([]);
  });

  it('keeps a pasted key for the session once it passes the key check', async () => {
    const h = harness({ runLane: fakeRunLane() });
    const run = await h.manager.start(request({ apiKey: PASTED_KEY }));
    await run.done;
    expect(h.models[0]?.apiKey).toBe(PASTED_KEY);
    expect(h.keys.status().anthropic).toMatchObject({ inEnv: true, inSession: true });
    expect(h.keys.resolve('anthropic')).toMatchObject({ source: 'session' });
  });

  it('redacts keys in results.json and in events', async () => {
    const runLane = fakeRunLane(() => ({
      result: { answer: `my keys are ${PASTED_KEY} and ${ENV_KEY}` },
    }));
    const h = harness({ runLane });
    const suite = `scenarios:\n  - id: leak\n    prompt: Use ${PASTED_KEY} to log in.\n`;
    const run = await h.manager.start(
      request({ suite, scenarioIds: ['leak'], apiKey: PASTED_KEY }),
    );
    await run.done;

    const text = await readFile(join(run.dir, 'results.json'), 'utf8');
    expect(text).toContain('[redacted]');
    for (const key of [PASTED_KEY, ENV_KEY]) {
      expect(text).not.toContain(key);
      expect(JSON.stringify(h.events)).not.toContain(key);
      expect(JSON.stringify(run.results)).not.toContain(key);
    }
  });
});

describe('orchestration (real Lanes, scripted model, fixture site)', () => {
  let site: RunningFixtureSite;

  beforeAll(async () => {
    site = await startFixtureSite();
  }, testTimeout);

  afterAll(async () => {
    await site?.close();
  });

  const laneOptions = {
    browser: { actionTimeoutMs: 3_000, navigationTimeoutMs: 5_000 },
    toolTimeouts: { waitForTextMs: 2_000, pauseMs: 100 },
    webmcpCallTimeoutMs: 2_000,
    maxRetries: 0,
  };

  const finish = (answer: string): ScriptedReply => ({
    toolCalls: [{ name: 'finish', input: { success: true, answer } }],
  });

  it(
    'writes the Run folder exactly as spec section 8',
    async () => {
      const scripts: Record<string, ScriptedReply[]> = {
        'baseline:first-open-todo': [
          {
            toolCalls: [{ name: 'navigate', input: { url: '/done' } }],
          },
          { toolCalls: [{ name: 'screenshot' }] },
          finish('Water the plants'),
        ],
        'webmcp:first-open-todo': [
          { toolCalls: [{ name: 'list_todos', input: {} }] },
          { toolCalls: [{ name: 'screenshot' }] },
          finish('Water the plants'),
        ],
        'baseline:create-from-new-page': [
          {
            toolCalls: [
              {
                name: 'type',
                input: { target: { selector: '#new-title' }, text: 'Call the bank' },
              },
            ],
          },
          {
            toolCalls: [{ name: 'click', input: { target: { selector: '#new-todo button' } } }],
          },
          finish('Added.'),
        ],
        'webmcp:create-from-new-page': [
          {
            toolCalls: [{ name: 'add_todo', input: { title: 'Call the bank' } }],
          },
          finish('Added.'),
        ],
      };
      const h = harness({
        laneOptions,
        createModel: ({ lane, scenario }) => scriptedModel(scripts[`${lane}:${scenario}`]!),
      });
      const run = await h.manager.start(
        request({
          siteUrl: site.baseUrl,
          scenarioIds: ['first-open-todo', 'create-from-new-page'],
        }),
      );
      const results = await run.done;

      expect(await filesUnder(run.dir)).toEqual([
        'baseline/log.jsonl',
        'baseline/screenshots/001-first-open-todo-attempt-1.jpg',
        'results.json',
        'webmcp/log.jsonl',
        'webmcp/screenshots/001-first-open-todo-attempt-1.jpg',
      ]);
      expect(
        results.scenarios.map((s) => [
          s.id,
          s.attempts[0]?.baseline.outcome,
          s.attempts[0]?.webmcp.outcome,
        ]),
      ).toEqual([
        ['first-open-todo', 'pass', 'pass'],
        ['create-from-new-page', 'pass', 'pass'],
      ]);
      expect(results.scenarios[0]!.comparison!.baseline).toMatchObject({
        steps: 3,
        screenshots: 1,
        toolCalls: { navigate: 1, screenshot: 1 },
      });
      expect(results.scenarios[0]!.comparison!.baseline.passRate).toBeUndefined();
      expect(results.scenarios[1]!.comparison!.webmcp).toMatchObject({
        steps: 2,
        webmcpTools: ['add_todo'],
      });
      expect(results.summary.webmcp).toMatchObject({ pass: 2, fail: 0, steps: 5, screenshots: 1 });

      // One log per Lane for the whole Run; every line was also sent as an event.
      for (const lane of ['baseline', 'webmcp'] as const) {
        const lines = (await readFile(join(run.dir, lane, 'log.jsonl'), 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as LogRecord);
        expect(lines.filter((l) => l.event === 'lane_start').map((l) => l.scenario)).toEqual([
          'first-open-todo',
          'create-from-new-page',
        ]);
        const sent = h.events.flatMap((e) =>
          e.type === 'lane' && e.record.lane === lane ? [e.record] : [],
        );
        expect(sent).toEqual(lines);
      }
      // The live view got each Lane's page before its start page opened.
      expect(h.pages.map((p) => `${p.lane}:${p.scenario}:${p.attempt}`).sort()).toEqual([
        'baseline:create-from-new-page:1',
        'baseline:first-open-todo:1',
        'webmcp:create-from-new-page:1',
        'webmcp:first-open-todo:1',
      ]);
    },
    testTimeout,
  );

  it(
    'Stop Run ends running Lanes as stopped by user with their metrics',
    async () => {
      const models: ScriptedModel[] = [];
      const h = harness({
        laneOptions,
        createModel: () => {
          const model = scriptedModel(() => ({ hang: true }));
          models.push(model);
          return model;
        },
      });
      const run = await h.manager.start(
        request({
          siteUrl: site.baseUrl,
          scenarioIds: ['first-open-todo', 'finish-watering'],
        }),
      );
      await expect
        .poll(() => models.length === 2 && models.every((m) => m.calls.length === 1), {
          timeout: 20_000,
        })
        .toBe(true);
      expect(h.manager.stop(run.id)).toBe(true);
      const results = await run.done;

      expect(results.run.stoppedByUser).toBe(true);
      const [first, second] = results.scenarios;
      expect(first).toMatchObject({ status: 'stopped' });
      for (const lane of ['baseline', 'webmcp'] as const) {
        expect(first!.attempts[0]![lane]).toMatchObject({
          outcome: 'fail',
          reason: 'stopped by user',
          steps: 1,
        });
        expect(first!.attempts[0]![lane].durationMs).toBeGreaterThan(0);
      }
      expect(second).toMatchObject({ status: 'skipped', attempts: [] });
      expect(h.pages.map((p) => p.page)).toHaveLength(2);
      expect(h.pages.every((p) => p.page.isClosed())).toBe(true);
    },
    testTimeout,
  );
});
