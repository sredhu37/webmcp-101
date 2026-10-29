import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type RunApiAppOptions } from '../app.ts';
import { DEFAULT_LIMITS } from '../agent/run-lane.ts';
import { bundledPriceTable } from '../pricing/price-table.ts';
import { parseSuite } from '../suite/parse.ts';
import { fakeRunLane, type FakeLaneRunner } from '../testing/fake-run-lane.ts';
import { fixtureSuiteFile } from '../testing/fixture-site.ts';
import { scriptedModel } from '../testing/scripted-model.ts';
import { PLACEHOLDER_SUITE } from './api.ts';
import type { RunListItem } from './run-folder.ts';
import type { Results } from './results.ts';

const testTimeout = 30_000;
const SUITE = readFileSync(fixtureSuiteFile, 'utf8');
const ENV_KEY = 'sk-ant-env-0123456789abcdefghijklmnopqrstuvwxyz';
const PASTED_KEY = 'sk-ant-pasted-0123456789abcdefghijklmnopqrstuvwxyz';

let webDist: string;
let root: string;
let app: FastifyInstance | undefined;
let appCount = 0;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'run-api-'));
  webDist = join(root, 'web');
  await mkdir(webDist);
  await writeFile(join(webDist, 'index.html'), '<!doctype html><title>app</title>');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const okFetch = (() =>
  Promise.resolve(new Response('{"data":[]}', { status: 200 }))) as typeof globalThis.fetch;

async function start(
  options: RunApiAppOptions = {},
): Promise<{ app: FastifyInstance; runsDir: string; runLane: FakeLaneRunner }> {
  appCount += 1;
  const runsDir = join(root, `runs-${appCount}`);
  const runLane = (options.runLane as FakeLaneRunner | undefined) ?? fakeRunLane();
  app = await createApp({
    webDist,
    runs: {
      runsDir,
      env: { ANTHROPIC_API_KEY: ENV_KEY },
      fetch: okFetch,
      loadPriceTable: () => Promise.resolve({ ...bundledPriceTable(), override: null }),
      createModel: () => scriptedModel([]),
      defaultSuiteFile: fixtureSuiteFile,
      ...options,
      runLane,
    },
  });
  return { app, runsDir, runLane };
}

const runBody = (body: Record<string, unknown> = {}): Record<string, unknown> => ({
  siteUrl: 'http://127.0.0.1:9',
  suite: SUITE,
  scenarioIds: ['first-open-todo', 'finish-watering'],
  model: 'claude-haiku-5-5',
  ...body,
});

describe('setup endpoints', () => {
  it('lists the models with labels and the default per provider', async () => {
    const { app } = await start();
    const response = await app.inject({ method: 'GET', url: '/api/models' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      effort: string;
      providers: unknown[];
      models: { id: string; label: string; default: boolean }[];
    }>();
    expect(body.effort).toBe('medium');
    expect(body.providers).toEqual([
      { id: 'anthropic', name: 'Anthropic', defaultModel: 'claude-haiku-5-5' },
      { id: 'openai', name: 'OpenAI', defaultModel: 'gpt-6-luna' },
    ]);
    expect(body.models.map((m) => [m.id, m.label, m.default])).toEqual([
      ['claude-haiku-5-5', 'recommended', true],
      ['claude-sonnet-5-5', 'ok', false],
      ['claude-opus-5-5', 'not recommended', false],
      ['gpt-6-luna', 'recommended', true],
      ['gpt-6.1-sol', 'ok', false],
      ['gpt-5.6-sol', 'not recommended', false],
    ]);
  });

  it('says which keys are in the environment without returning them', async () => {
    const { app } = await start();
    const response = await app.inject({ method: 'GET', url: '/api/keys' });
    expect(response.json()).toEqual({
      anthropic: { envVar: 'ANTHROPIC_API_KEY', inEnv: true, inSession: false },
      openai: { envVar: 'OPENAI_API_KEY', inEnv: false, inSession: false },
    });
    expect(response.body).not.toContain(ENV_KEY);
  });

  it('gives the default Site URL, fixture Suite and Run settings', async () => {
    const { app } = await start();
    const response = await app.inject({ method: 'GET', url: '/api/defaults' });
    expect(response.json()).toEqual({
      siteUrl: 'http://localhost:4000',
      suite: SUITE,
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      attempts: 1,
      maxAttempts: 100,
      limits: DEFAULT_LIMITS,
    });
  });

  it('falls back to a placeholder Suite when the default Suite file is missing', async () => {
    const { app } = await start({ defaultSuiteFile: join(root, 'no-such-suite.yaml') });
    const response = await app.inject({ method: 'GET', url: '/api/defaults' });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ suite: string }>().suite).toBe(PLACEHOLDER_SUITE);
    expect(parseSuite(PLACEHOLDER_SUITE).ok).toBe(true);
  });
});

describe('Run endpoints', () => {
  it(
    'starts, lists, gets, stops and zips a Run',
    async () => {
      const { app, runsDir, runLane } = await start({
        runLane: fakeRunLane(() => ({ untilStopped: true })),
      });

      const started = await app.inject({ method: 'POST', url: '/api/runs', payload: runBody() });
      expect(started.statusCode).toBe(202);
      const { id, results } = started.json<{ id: string; results: Results }>();
      expect(id).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
      expect(results.run).toMatchObject({ id, endedAt: null, stoppedByUser: false });
      const done = app.runs.current!.done;

      const busy = await app.inject({ method: 'POST', url: '/api/runs', payload: runBody() });
      expect(busy.statusCode).toBe(409);
      expect(busy.json()).toEqual({ error: `A Run is already going: ${id}`, running: id });

      const list = await app.inject({ method: 'GET', url: '/api/runs' });
      expect(list.json<{ running: string; runs: RunListItem[] }>()).toMatchObject({
        running: id,
        runs: [{ id, running: true, model: 'claude-haiku-5-5', endedAt: null }],
      });

      const live = await app.inject({ method: 'GET', url: `/api/runs/${id}` });
      expect(live.json<Results>().scenarios.map((s) => s.status)).toEqual(['running', 'pending']);

      const zipEarly = await app.inject({ method: 'GET', url: `/api/runs/${id}/zip` });
      expect(zipEarly.statusCode).toBe(409);

      await expect.poll(() => runLane.calls.length).toBe(2);
      const stop = await app.inject({ method: 'POST', url: `/api/runs/${id}/stop` });
      expect(stop.statusCode).toBe(202);
      expect(stop.json()).toEqual({ id, stopping: true });
      await done;

      const stopAgain = await app.inject({ method: 'POST', url: `/api/runs/${id}/stop` });
      expect(stopAgain.statusCode).toBe(409);

      const final = await app.inject({ method: 'GET', url: `/api/runs/${id}` });
      const finalResults = final.json<Results>();
      expect(finalResults.run.stoppedByUser).toBe(true);
      expect(finalResults.scenarios.map((s) => s.status)).toEqual(['stopped', 'skipped']);
      expect(finalResults).toEqual(
        JSON.parse(await readFile(join(runsDir, id, 'results.json'), 'utf8')),
      );

      const after = await app.inject({ method: 'GET', url: '/api/runs' });
      expect(after.json()).toMatchObject({
        running: null,
        runs: [
          {
            id,
            running: false,
            stoppedByUser: true,
            siteUrl: 'http://127.0.0.1:9',
            provider: 'anthropic',
            attempts: 1,
            scenarioIds: ['first-open-todo', 'finish-watering'],
            pass: { baseline: { pass: 0, fail: 1 }, webmcp: { pass: 0, fail: 1 } },
          },
        ],
      });

      const zip = await app.inject({ method: 'GET', url: `/api/runs/${id}/zip` });
      expect(zip.statusCode).toBe(200);
      expect(zip.headers['content-type']).toBe('application/zip');
      expect(zip.headers['content-disposition']).toBe(
        `attachment; filename="webmcp-comparer-${id}.zip"`,
      );
      const files = unzipSync(new Uint8Array(zip.rawPayload));
      expect(Object.keys(files).sort()).toEqual([
        `${id}/baseline/log.jsonl`,
        `${id}/results.json`,
        `${id}/webmcp/log.jsonl`,
      ]);
      expect(JSON.parse(strFromU8(files[`${id}/results.json`]!))).toEqual(finalResults);
      expect(strFromU8(files[`${id}/baseline/log.jsonl`]!)).toBe(
        await readFile(join(runsDir, id, 'baseline', 'log.jsonl'), 'utf8'),
      );
    },
    testTimeout,
  );

  it('lists past Runs newest first', async () => {
    const { app } = await start();
    const ids: string[] = [];
    for (let n = 0; n < 2; n += 1) {
      const response = await app.inject({ method: 'POST', url: '/api/runs', payload: runBody() });
      ids.push(response.json<{ id: string }>().id);
      await app.runs.current?.done;
    }
    const list = await app.inject({ method: 'GET', url: '/api/runs' });
    const runs = list.json<{ runs: RunListItem[] }>().runs;
    expect(runs.map((run) => run.id)).toEqual([...ids].reverse());
    expect(runs[0]!.pass).toEqual({
      baseline: { pass: 2, fail: 0 },
      webmcp: { pass: 2, fail: 0 },
    });
  });

  it('rejects an invalid request with every error', async () => {
    const { app, runLane } = await start();
    const response = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: runBody({ suite: 'scenarios: []\n', attempts: 'two', model: 'gpt-4o' }),
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: string; errors: string[]; suiteErrors: unknown[] }>();
    expect(body.errors).toEqual([
      'Unknown model: gpt-4o',
      'attempts must be a whole number from 1 to 100.',
      'The Suite is not valid.',
    ]);
    expect(body.suiteErrors.length).toBeGreaterThan(0);
    expect(runLane.calls).toHaveLength(0);
  });

  it('errors before any Lane when the key check fails, never echoing the key', async () => {
    const echo = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: `bad key ${PASTED_KEY}` } }), {
          status: 401,
        }),
      )) as typeof globalThis.fetch;
    const { app, runLane } = await start({ fetch: echo });
    const response = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: runBody({ apiKey: PASTED_KEY }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'Anthropic rejected the API key (HTTP 401: bad key [redacted]).',
    });
    expect(runLane.calls).toHaveLength(0);
    const keys = await app.inject({ method: 'GET', url: '/api/keys' });
    expect(keys.json()).toMatchObject({ anthropic: { inSession: false } });
  });

  it('never returns a pasted key', async () => {
    const { app } = await start({
      runLane: fakeRunLane(() => ({ result: { answer: `key: ${PASTED_KEY}` } })),
    });
    const responses = [
      await app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: runBody({ apiKey: PASTED_KEY }),
      }),
    ];
    const { id } = responses[0]!.json<{ id: string }>();
    await app.runs.current?.done;
    responses.push(
      await app.inject({ method: 'GET', url: `/api/runs/${id}` }),
      await app.inject({ method: 'GET', url: '/api/runs' }),
      await app.inject({ method: 'GET', url: '/api/keys' }),
    );
    for (const response of responses) expect(response.body).not.toContain(PASTED_KEY);
    expect(responses[1]!.body).toContain('key: [redacted]');
    expect(responses[3]!.json()).toMatchObject({ anthropic: { inEnv: true, inSession: true } });
  });

  it('answers 404 for unknown Runs and anything that is not a Run id', async () => {
    const { app } = await start();
    const cases: [string, string, string][] = [
      ['GET', '/api/runs/2020-01-01_00-00-00', 'No Run 2020-01-01_00-00-00.'],
      ['GET', '/api/runs/latest', 'Not a Run id: latest'],
      ['GET', '/api/runs/..%2F..%2Fetc/zip', 'Not a Run id: ../../etc'],
      ['GET', '/api/runs/2020-01-01_00-00-00/zip', 'No Run 2020-01-01_00-00-00.'],
      ['POST', '/api/runs/2020-01-01_00-00-00/stop', 'No Run 2020-01-01_00-00-00.'],
    ];
    for (const [method, url, error] of cases) {
      const response = await app.inject({ method: method as 'GET', url });
      expect(response.statusCode, url).toBe(404);
      expect(response.json(), url).toEqual({ error });
    }
  });

  it('serves agent screenshots of a Run and nothing else', async () => {
    const { app, runsDir } = await start();
    const response = await app.inject({ method: 'POST', url: '/api/runs', payload: runBody() });
    const { id } = response.json<{ id: string }>();
    await app.runs.current?.done;
    const name = '001-finish-watering-attempt-1.jpg';
    await mkdir(join(runsDir, id, 'webmcp', 'screenshots'), { recursive: true });
    await writeFile(join(runsDir, id, 'webmcp', 'screenshots', name), 'jpeg bytes');

    const shot = await app.inject({
      method: 'GET',
      url: `/api/runs/${id}/webmcp/screenshots/${name}`,
    });
    expect(shot.statusCode).toBe(200);
    expect(shot.headers['content-type']).toBe('image/jpeg');
    expect(shot.body).toBe('jpeg bytes');

    for (const url of [
      `/api/runs/${id}/baseline/screenshots/${name}`,
      `/api/runs/${id}/other/screenshots/${name}`,
      `/api/runs/${id}/webmcp/screenshots/..%2F..%2Fresults.json`,
      `/api/runs/${id}/webmcp/screenshots/notes.txt`,
    ]) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(404);
    }
  });

  it(
    'stops a running Run when the server closes',
    async () => {
      const { app, runsDir } = await start({
        runLane: fakeRunLane(() => ({ untilStopped: true })),
      });
      const response = await app.inject({ method: 'POST', url: '/api/runs', payload: runBody() });
      const { id } = response.json<{ id: string }>();
      await app.close();
      const results = JSON.parse(
        await readFile(join(runsDir, id, 'results.json'), 'utf8'),
      ) as Results;
      expect(results.run.stoppedByUser).toBe(true);
      expect(results.run.endedAt).not.toBeNull();
    },
    testTimeout,
  );
});

describe('pre-Run checks', () => {
  let plain: Server;
  let plainUrl: string;

  beforeAll(async () => {
    plain = createServer((_request, response) => {
      response.setHeader('content-type', 'text/html');
      response.end('<!doctype html><title>No tools</title>');
    });
    await new Promise<void>((resolve) => plain.listen(0, '127.0.0.1', resolve));
    plainUrl = `http://127.0.0.1:${(plain.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => plain?.close(resolve));
  });

  it(
    'checks the key and warns about start pages without WebMCP tools',
    async () => {
      const { app } = await start({ webmcpCheck: { settleMs: 200, pollMs: 50 } });
      const response = await app.inject({
        method: 'POST',
        url: '/api/preflight',
        payload: runBody({ siteUrl: plainUrl, scenarioIds: ['create-from-new-page'] }),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ok: true,
        key: { ok: true, source: 'env', message: null },
        webmcp: [
          {
            scenario: 'create-from-new-page',
            startUrl: `${plainUrl}/new`,
            tools: [],
            error: null,
          },
        ],
        warnings: [
          `Scenario create-from-new-page: the start page ${plainUrl}/new has no WebMCP tools, so the WebMCP lane only has Browser tools.`,
        ],
      });
    },
    testTimeout,
  );

  it(
    'reports a failed key check',
    async () => {
      const { app } = await start({
        env: {},
        webmcpCheck: { settleMs: 0 },
      });
      const response = await app.inject({
        method: 'POST',
        url: '/api/preflight',
        payload: runBody({ siteUrl: plainUrl, scenarioIds: ['first-open-todo'] }),
      });
      expect(response.json()).toMatchObject({
        ok: false,
        key: {
          ok: false,
          source: null,
          message: 'No Anthropic API key: paste one or set ANTHROPIC_API_KEY in .env.',
        },
      });
    },
    testTimeout,
  );
});
