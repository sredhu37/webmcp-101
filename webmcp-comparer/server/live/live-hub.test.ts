import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Page } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createApp, type AppOptions } from '../app.ts';
import { bundledPriceTable } from '../pricing/price-table.ts';
import { parseRunRequest } from '../run/settings.ts';
import {
  fixtureSuiteFile,
  startFixtureSite,
  type RunningFixtureSite,
} from '../testing/fixture-site.ts';
import {
  scriptedModel,
  type ScriptedModel,
  type ScriptedReply,
} from '../testing/scripted-model.ts';
import { FRAME_SIZE } from './live-hub.ts';
import {
  LANE_BYTE,
  LIVE_LANES,
  LIVE_PATH,
  applyLiveMessage,
  decodeFrame,
  emptyLiveState,
  parseLiveMessage,
  type LiveLaneId,
  type LiveMessage,
  type LiveState,
} from './protocol.ts';

const testTimeout = 60_000;
const SUITE = readFileSync(fixtureSuiteFile, 'utf8');
const SCENARIO = 'first-open-todo';

const okFetch = (() =>
  Promise.resolve(new Response('{"data":[]}', { status: 200 }))) as typeof globalThis.fetch;

const laneOptions = {
  browser: { actionTimeoutMs: 3_000, navigationTimeoutMs: 5_000 },
  toolTimeouts: { waitForTextMs: 2_000, pauseMs: 100 },
  webmcpCallTimeoutMs: 2_000,
  maxRetries: 0,
};

let root: string;
let webDist: string;
let site: RunningFixtureSite;
let app: FastifyInstance | undefined;
let appCount = 0;
const viewers: Viewer[] = [];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'live-'));
  webDist = join(root, 'web');
  await mkdir(webDist);
  await writeFile(join(webDist, 'index.html'), '<!doctype html><title>app</title>');
  site = await startFixtureSite();
}, testTimeout);

afterAll(async () => {
  await site?.close();
  await rm(root, { recursive: true, force: true });
});

afterEach(async () => {
  for (const viewer of viewers.splice(0)) viewer.ws.terminate();
  await app?.close();
  app = undefined;
});

interface Started {
  app: FastifyInstance;
  base: string;
  runsDir: string;
}

async function startApp(
  createModel: (lane: LiveLaneId) => ScriptedModel,
  options: Partial<AppOptions> = {},
): Promise<Started> {
  appCount += 1;
  const runsDir = join(root, `runs-${appCount}`);
  app = await createApp({
    webDist,
    runs: {
      runsDir,
      env: { ANTHROPIC_API_KEY: 'test-key' },
      fetch: okFetch,
      loadPriceTable: () => Promise.resolve({ ...bundledPriceTable(), override: null }),
      createModel: ({ lane }) => createModel(lane),
      laneOptions,
    },
    ...options,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address() as AddressInfo;
  return { app, base: `127.0.0.1:${port}`, runsDir };
}

function startRun(started: Started, scenarioIds: string[] = [SCENARIO]) {
  const parsed = parseRunRequest({
    siteUrl: site.baseUrl,
    suite: SUITE,
    scenarioIds,
    model: 'claude-haiku-5-5',
  });
  if (!parsed.ok) throw new Error(parsed.errors.join(' '));
  return started.app.runs.start(parsed.request);
}

type Received =
  | { kind: 'text'; message: LiveMessage; at: number }
  | { kind: 'frame'; lane: LiveLaneId; jpeg: Uint8Array; raw: Buffer; at: number };

interface Viewer {
  ws: WebSocket;
  received: Received[];
  messages(): LiveMessage[];
  frames(lane?: LiveLaneId): Extract<Received, { kind: 'frame' }>[];
  closed: Promise<number>;
}

function watch(base: string, headers: Record<string, string> = {}): Viewer {
  const ws = new WebSocket(`ws://${base}${LIVE_PATH}`, { headers });
  const received: Received[] = [];
  // Refused or terminated sockets report an error; the tests check the status instead.
  ws.on('error', () => undefined);
  ws.on('message', (data: Buffer, isBinary: boolean) => {
    const at = performance.now();
    if (isBinary) {
      const frame = decodeFrame(data);
      if (!frame) throw new Error('Not a frame message');
      received.push({ kind: 'frame', ...frame, raw: data, at });
    } else {
      const message = parseLiveMessage(data.toString('utf8'));
      if (!message) throw new Error(`Not a live message: ${data.toString('utf8')}`);
      received.push({ kind: 'text', message, at });
    }
  });
  const viewer: Viewer = {
    ws,
    received,
    messages: () => received.flatMap((r) => (r.kind === 'text' ? [r.message] : [])),
    frames: (lane) =>
      received.flatMap((r) => (r.kind === 'frame' && (!lane || r.lane === lane) ? [r] : [])),
    closed: new Promise((resolve) => ws.on('close', (code: number) => resolve(code))),
  };
  viewers.push(viewer);
  return viewer;
}

async function open(viewer: Viewer): Promise<Viewer> {
  await new Promise<void>((resolve, reject) => {
    viewer.ws.once('open', () => resolve());
    viewer.ws.once('error', reject);
  });
  await expect.poll(() => viewer.messages().length).toBeGreaterThan(0);
  return viewer;
}

function reduce(messages: LiveMessage[]): LiveState {
  return messages.reduce(applyLiveMessage, emptyLiveState());
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  // Walk the JPEG markers up to the first start-of-frame segment.
  let i = 2;
  while (i < bytes.length) {
    const marker = bytes[i + 1]!;
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: (bytes[i + 5]! << 8) | bytes[i + 6]!,
        width: (bytes[i + 7]! << 8) | bytes[i + 8]!,
      };
    }
    i += 2 + length;
  }
  throw new Error('No JPEG frame header');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('live transport (real Lanes, scripted model, fixture site)', () => {
  const finish = (answer: string): ScriptedReply => ({
    toolCalls: [{ name: 'finish', input: { success: true, answer } }],
  });
  const scripts: Record<LiveLaneId, ScriptedReply[]> = {
    baseline: [
      { toolCalls: [{ name: 'navigate', input: { url: '/done' } }] },
      { toolCalls: [{ name: 'screenshot' }] },
      finish('Water the plants'),
    ],
    webmcp: [
      { toolCalls: [{ name: 'list_todos', input: {} }] },
      { toolCalls: [{ name: 'screenshot' }] },
      finish('Water the plants'),
    ],
  };

  it(
    'streams JPEG frames tagged by Lane and every live event as it happens',
    async () => {
      const started = await startApp((lane) => scriptedModel(scripts[lane]));
      const viewer = await open(watch(started.base));
      expect(viewer.received[0]).toMatchObject({
        kind: 'text',
        message: { type: 'snapshot', state: emptyLiveState() },
      });

      const run = await startRun(started);
      const results = await run.done;
      await expect
        .poll(() => viewer.messages().some((m) => m.type === 'run' && !m.run.running))
        .toBe(true);

      // Frames: one socket, both Lanes, each a JPEG at the frame size behind its Lane byte.
      for (const lane of LIVE_LANES) {
        const frames = viewer.frames(lane);
        expect(frames.length).toBeGreaterThan(0);
        for (const frame of frames) {
          expect(frame.raw[0]).toBe(LANE_BYTE[lane]);
          expect(isJpeg(frame.jpeg)).toBe(true);
        }
        const size = jpegSize(frames.at(-1)!.jpeg);
        expect(size.width).toBeLessThanOrEqual(FRAME_SIZE.width);
        expect(size.height).toBeLessThanOrEqual(FRAME_SIZE.height);
      }

      // Lane events, in order: start, then each Step and each tool call, then the Outcome.
      const laneFlow = (lane: LiveLaneId) =>
        viewer.messages().flatMap((m) => {
          if (!('lane' in m) || m.lane !== lane) return [];
          return [m.type === 'tool_call' ? `tool_call:${m.call.name}` : m.type];
        });
      expect(laneFlow('baseline')).toEqual([
        'lane_start',
        'step',
        'tool_call:navigate',
        'step',
        'tool_call:screenshot',
        'step',
        'outcome',
      ]);
      expect(laneFlow('webmcp')).toEqual([
        'lane_start',
        'step',
        'tool_call:list_todos',
        'step',
        'tool_call:screenshot',
        'step',
        'outcome',
      ]);

      const messages = viewer.messages();
      const of = <T extends LiveMessage['type']>(type: T, lane: LiveLaneId) =>
        messages.filter(
          (m): m is Extract<LiveMessage, { type: T }> =>
            m.type === type && 'lane' in m && m.lane === lane,
        );

      expect(of('lane_start', 'baseline')[0]).toMatchObject({
        scenario: SCENARIO,
        attempt: 1,
        maxSteps: 50,
      });
      // Steps carry the running totals: tokens and cost grow with every model call.
      const steps = of('step', 'baseline');
      expect(steps.map((m) => m.step)).toEqual([1, 2, 3]);
      expect(steps.map((m) => m.totals.tokens.input)).toEqual([1_000, 2_000, 3_000]);
      expect(steps[0]!.totals.costUsd).toBeGreaterThan(0);
      expect(steps[2]!.totals.costUsd).toBeCloseTo(steps[0]!.totals.costUsd! * 3, 12);

      // Each tool call as it happens, with its source and its screenshot.
      const webmcpCalls = of('tool_call', 'webmcp');
      expect(webmcpCalls[0]!.call).toMatchObject({
        scenario: SCENARIO,
        attempt: 1,
        step: 1,
        name: 'list_todos',
        source: 'webmcp',
        input: {},
        isError: false,
        screenshot: null,
      });
      expect(webmcpCalls[0]!.totals).toMatchObject({
        toolCallsTotal: 1,
        webmcpTools: ['list_todos'],
      });
      expect(webmcpCalls[1]!.call).toMatchObject({
        name: 'screenshot',
        source: 'browser',
        screenshot: `001-${SCENARIO}-attempt-1.jpg`,
      });
      expect(webmcpCalls[1]!.totals.screenshots).toBe(1);

      // Outcome totals are the Attempt's metrics in results.json.
      for (const lane of LIVE_LANES) {
        const outcome = of('outcome', lane)[0]!;
        const attempt = results.scenarios[0]!.attempts[0]![lane];
        expect(outcome).toMatchObject({
          outcome: 'pass',
          reason: null,
          answer: 'Water the plants',
        });
        const { durationMs, steps, tokens, costUsd, toolCalls, toolCallsTotal, screenshots } =
          attempt;
        expect(outcome.totals).toEqual({
          durationMs,
          steps,
          tokens,
          costUsd,
          toolCalls,
          toolCallsTotal,
          screenshots,
          webmcpTools: attempt.webmcpTools,
        });
      }

      // Run messages: started, Scenario, Attempt, Scenario ended, Run ended.
      const runs = messages.flatMap((m) => (m.type === 'run' ? [m.run] : []));
      expect(runs.map((r) => [r.running, r.current, r.scenarios[0]!.status])).toEqual([
        [true, null, 'pending'],
        [true, { scenario: SCENARIO, attempt: null }, 'running'],
        [true, { scenario: SCENARIO, attempt: 1 }, 'running'],
        [true, null, 'done'],
        [false, null, 'done'],
      ]);
      expect(runs.at(-1)).toMatchObject({
        id: run.id,
        siteUrl: site.baseUrl,
        model: 'claude-haiku-5-5',
        attempts: 1,
        limits: { maxSteps: 50 },
        endedAt: results.run.endedAt,
        stoppedByUser: false,
        error: null,
      });

      // The viewer's own state equals the server's, and its screenshot link works.
      const state = reduce(messages);
      expect(state).toEqual(started.app.live.state);
      expect(state.lanes.webmcp).toMatchObject({ status: 'pass', step: 3 });
      expect(state.lanes.webmcp.toolCalls.map((c) => c.name)).toEqual(['list_todos', 'screenshot']);
      const shot = await started.app.inject({ url: state.lanes.baseline.lastScreenshot! });
      expect(shot.statusCode).toBe(200);
      expect(shot.headers['content-type']).toBe('image/jpeg');
    },
    testTimeout,
  );

  it(
    'does not change the agent screenshot count',
    async () => {
      const started = await startApp((lane) => scriptedModel(scripts[lane]));
      const viewer = await open(watch(started.base));
      const run = await startRun(started);
      const results = await run.done;

      for (const lane of LIVE_LANES) {
        // Frames were streamed the whole time...
        expect(started.app.live.stats.received[lane]).toBeGreaterThan(0);
        expect(viewer.frames(lane).length).toBeGreaterThan(0);
        // ...yet only the agent's one screenshot() call is counted and saved.
        expect(results.scenarios[0]!.attempts[0]![lane].screenshots).toBe(1);
        expect(results.summary[lane].screenshots).toBe(1);
        expect(await readdir(join(run.dir, lane, 'screenshots'))).toEqual([
          `001-${SCENARIO}-attempt-1.jpg`,
        ]);
      }
      expect(started.app.live.state.lanes.baseline.totals.screenshots).toBe(1);
    },
    testTimeout,
  );

  it(
    'caps each Lane at 10 fps on a busy page and cleans up on Stop Run',
    async () => {
      const models: ScriptedModel[] = [];
      const started = await startApp(() => {
        const model = scriptedModel(() => ({ hang: true }));
        models.push(model);
        return model;
      });
      const pages = new Map<LiveLaneId, Page>();
      started.app.runs.subscribe({ page: ({ lane, page }) => void pages.set(lane, page) });
      const viewer = await open(watch(started.base));
      const run = await startRun(started, [SCENARIO, 'finish-watering']);
      await expect
        .poll(() => models.length === 2 && models.every((m) => m.calls.length === 1), {
          timeout: 20_000,
        })
        .toBe(true);

      // Repaint on every animation frame, the worst case for the screencast.
      await Promise.all(
        [...pages.values()].map((page) =>
          page.evaluate(`(() => {
            const box = document.createElement('div');
            box.style.cssText = 'position:fixed;inset:0;z-index:99999;font:64px sans-serif';
            document.body.append(box);
            let i = 0;
            const tick = () => {
              i += 1;
              box.style.background = 'hsl(' + ((i * 7) % 360) + ' 80% 50%)';
              box.textContent = String(i);
              requestAnimationFrame(tick);
            };
            tick();
          })()`),
        ),
      );
      await sleep(500);

      const { stats } = started.app.live;
      const windowMs = 2_000;
      const before = structuredClone(stats);
      const t0 = performance.now();
      await sleep(windowMs);
      const t1 = performance.now();
      const after = structuredClone(stats);

      for (const lane of LIVE_LANES) {
        const sent = after.sent[lane] - before.sent[lane];
        const received = after.received[lane] - before.received[lane];
        const cap = Math.ceil(((t1 - t0) / 1000) * 10) + 1;
        expect(sent).toBeLessThanOrEqual(cap);
        expect(sent).toBeGreaterThanOrEqual(10);
        // The screencast delivered far more than the cap let through.
        expect(received).toBeGreaterThan(sent + 5);
        const seen = viewer.frames(lane).filter((f) => f.at >= t0 && f.at <= t1).length;
        expect(seen).toBeLessThanOrEqual(cap + 1);
      }

      expect(started.app.live.streaming).toEqual(['baseline', 'webmcp']);
      expect(started.app.runs.stop(run.id)).toBe(true);
      await run.done;
      await expect
        .poll(() => viewer.messages().some((m) => m.type === 'run' && !m.run.running))
        .toBe(true);

      // Cleanup: no screencast, no frame waiting for its slot, no frame after the Run ended.
      expect(started.app.live.streaming).toEqual([]);
      expect(started.app.live.waitingFrames).toEqual([]);
      expect([...pages.values()].every((page) => page.isClosed())).toBe(true);
      const framesAtEnd = viewer.frames().length;
      const lastRun = viewer.received.findLastIndex(
        (r) => r.kind === 'text' && r.message.type === 'run',
      );
      expect(viewer.received.slice(lastRun + 1)).toEqual([]);
      await sleep(400);
      expect(viewer.frames().length).toBe(framesAtEnd);

      // Hundreds of streamed frames, and still no agent screenshot.
      const results = await run.done;
      for (const lane of LIVE_LANES) {
        expect(stats.received[lane]).toBeGreaterThan(20);
        expect(results.summary[lane].screenshots).toBe(0);
        const files = await readdir(join(run.dir, lane, 'screenshots')).catch(() => []);
        expect(files).toEqual([]);
      }

      const state = started.app.live.state;
      expect(state.run).toMatchObject({ running: false, stoppedByUser: true });
      expect(state.run!.scenarios.map((s) => s.status)).toEqual(['stopped', 'skipped']);
      for (const lane of LIVE_LANES) {
        expect(state.lanes[lane]).toMatchObject({
          status: 'fail',
          reason: 'stopped by user',
          step: 1,
        });
      }
    },
    testTimeout,
  );

  it(
    'replays the current state and the last frame per Lane to late viewers',
    async () => {
      const models: ScriptedModel[] = [];
      const started = await startApp(() => {
        const model = scriptedModel(() => ({ hang: true }));
        models.push(model);
        return model;
      });
      const run = await startRun(started);
      await expect
        .poll(
          () =>
            models.length === 2 &&
            models.every((m) => m.calls.length === 1) &&
            LIVE_LANES.every((lane) => started.app.live.lastFrame(lane)),
          { timeout: 20_000 },
        )
        .toBe(true);

      // A viewer joining mid-Run: the state so far, then one frame per Lane.
      const late = await open(watch(started.base));
      // The replay is one frame per Lane; a page still painting under load may stream more after.
      await expect.poll(() => late.frames().length).toBeGreaterThanOrEqual(2);
      const [snapshot, ...rest] = late.received;
      expect(snapshot).toMatchObject({ kind: 'text', message: { type: 'snapshot' } });
      const state = (snapshot as { message: Extract<LiveMessage, { type: 'snapshot' }> }).message
        .state;
      expect(state).toEqual(started.app.live.state);
      expect(state.run).toMatchObject({
        id: run.id,
        running: true,
        current: { scenario: SCENARIO, attempt: 1 },
      });
      for (const lane of LIVE_LANES) {
        expect(state.lanes[lane]).toMatchObject({
          status: 'running',
          scenario: SCENARIO,
          attempt: 1,
          maxSteps: 50,
        });
      }
      const replayed = rest.slice(0, 2) as Extract<Received, { kind: 'frame' }>[];
      expect(replayed.map((f) => f.lane)).toEqual(['baseline', 'webmcp']);
      for (const frame of replayed) {
        expect(isJpeg(frame.jpeg)).toBe(true);
      }

      started.app.runs.stop(run.id);
      await run.done;

      // After the Run: the final state and each Lane's final screen.
      const after = await open(watch(started.base));
      await expect.poll(() => after.frames().length).toBe(2);
      const finalState = (after.messages()[0] as Extract<LiveMessage, { type: 'snapshot' }>).state;
      expect(finalState.run).toMatchObject({ id: run.id, running: false, stoppedByUser: true });
      expect(finalState.lanes.baseline).toMatchObject({
        status: 'fail',
        reason: 'stopped by user',
      });
      for (const frame of after.frames()) {
        expect(Buffer.from(frame.raw)).toEqual(
          Buffer.from(started.app.live.lastFrame(frame.lane)!),
        );
      }
    },
    testTimeout,
  );
});

describe('live socket', () => {
  const idle = () => scriptedModel([]);

  it('refuses viewers from another origin and accepts same-origin ones', async () => {
    const started = await startApp(idle);
    const foreign = watch(started.base, { origin: 'http://evil.example' });
    const status = await new Promise<number>((resolve) => {
      foreign.ws.on('unexpected-response', (_request, response) => resolve(response.statusCode!));
    });
    expect(status).toBe(403);

    const same = await open(watch(started.base, { origin: `http://${started.base}` }));
    expect(same.messages()[0]).toMatchObject({ type: 'snapshot' });
    expect(started.app.live.clientCount).toBe(1);
  });

  it('refuses WebSocket upgrades to other paths in production', async () => {
    const started = await startApp(idle);
    const ws = new WebSocket(`ws://${started.base}/api/other`);
    ws.on('error', () => undefined);
    const status = await new Promise<number>((resolve) => {
      ws.on('unexpected-response', (_request, response) => resolve(response.statusCode!));
    });
    ws.terminate();
    expect(status).toBe(404);
  });

  it('closes viewers when the server closes', async () => {
    const started = await startApp(idle);
    const viewer = await open(watch(started.base));
    await started.app.close();
    app = undefined;
    expect(await viewer.closed).toBe(1001);
  });

  it(
    'leaves the Vite HMR socket alone in dev',
    async () => {
      const started = await startApp(idle, { dev: true });
      const hmr = new WebSocket(`ws://${started.base}/`, 'vite-hmr');
      const first = await new Promise<string>((resolve, reject) => {
        hmr.once('message', (data: Buffer) => resolve(data.toString('utf8')));
        hmr.once('error', reject);
      });
      expect(JSON.parse(first)).toMatchObject({ type: 'connected' });
      hmr.terminate();

      const viewer = await open(watch(started.base));
      expect(viewer.messages()[0]).toMatchObject({ type: 'snapshot' });
    },
    testTimeout,
  );
});
