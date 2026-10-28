import { describe, expect, it, vi } from 'vitest';
import {
  applyLiveMessage,
  emptyLiveState,
  emptyTotals,
  type LiveMessage,
  type LiveRun,
  type LiveState,
  type LiveToolCall,
} from './client.ts';
import { FrameBus } from './frames.ts';
import {
  formatToolInput,
  laneElapsedMs,
  laneMetrics,
  runProgress,
  runningRunId,
  toolLog,
} from './view.ts';

const T0 = Date.parse('2026-10-16T10:00:00.000Z');
const at = (ms: number) => new Date(T0 + ms).toISOString();

function liveRun(overrides: Partial<LiveRun> = {}): LiveRun {
  return {
    id: 'run-1',
    startedAt: at(0),
    endedAt: null,
    siteUrl: 'http://localhost:4000',
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    attempts: 2,
    limits: { maxSteps: 50, maxDurationMs: 300_000, maxCostUsd: 2 },
    scenarios: [
      { id: 'first', status: 'done' },
      { id: 'second', status: 'running' },
    ],
    current: { scenario: 'second', attempt: 1 },
    running: true,
    stoppedByUser: false,
    error: null,
    ...overrides,
  };
}

function call(step: number, name: string, overrides: Partial<LiveToolCall> = {}): LiveToolCall {
  return {
    t: at(step * 1000),
    scenario: 'second',
    attempt: 1,
    step,
    id: `call-${step}`,
    name,
    source: 'browser',
    webmcpName: null,
    input: {},
    isError: false,
    result: 'ok',
    screenshot: null,
    durationMs: 10,
    ...overrides,
  };
}

const totals = (steps: number, extra: Partial<ReturnType<typeof emptyTotals>> = {}) => ({
  ...emptyTotals(),
  steps,
  durationMs: steps * 1000,
  ...extra,
});

/** The messages of the WebMCP Lane's first Attempt, as the server sends them. */
const MESSAGES: LiveMessage[] = [
  { type: 'run', run: liveRun() },
  {
    type: 'lane_start',
    lane: 'webmcp',
    t: at(0),
    scenario: 'second',
    attempt: 1,
    maxSteps: 50,
  },
  { type: 'step', lane: 'webmcp', t: at(900), step: 1, durationMs: 900, totals: totals(1) },
  {
    type: 'tool_call',
    lane: 'webmcp',
    call: call(1, 'search_products', { source: 'webmcp', input: { color: 'red' } }),
    totals: totals(1, { toolCallsTotal: 1, toolCalls: { search_products: 1 } }),
  },
  { type: 'step', lane: 'webmcp', t: at(1800), step: 2, durationMs: 900, totals: totals(2) },
  {
    type: 'tool_call',
    lane: 'webmcp',
    call: call(2, 'screenshot', { screenshot: '001-second-attempt-1.jpg' }),
    totals: totals(2, { toolCallsTotal: 2, screenshots: 1 }),
  },
];

function reduce(messages: LiveMessage[], state: LiveState = emptyLiveState()): LiveState {
  return messages.reduce(applyLiveMessage, state);
}

describe('live view', () => {
  it('turns the live events into Lane state: status, Step, totals, log and last screenshot', () => {
    const state = reduce(MESSAGES);
    const lane = state.lanes.webmcp;
    expect(lane).toMatchObject({
      status: 'running',
      scenario: 'second',
      attempt: 1,
      step: 2,
      maxSteps: 50,
      lastScreenshot: '/api/runs/run-1/webmcp/screenshots/001-second-attempt-1.jpg',
    });
    expect(toolLog(lane).map((c) => c.name)).toEqual(['screenshot', 'search_products']);
    expect(state.lanes.baseline.status).toBe('idle');
  });

  it('ends a Lane with its Outcome and stops its clock at the final time', () => {
    const state = reduce([
      ...MESSAGES,
      {
        type: 'outcome',
        lane: 'webmcp',
        t: at(2500),
        scenario: 'second',
        attempt: 1,
        outcome: 'fail',
        reason: 'check failed',
        answer: null,
        totals: totals(2, { durationMs: 2_500 }),
      },
    ]);
    const lane = state.lanes.webmcp;
    expect(lane).toMatchObject({ status: 'fail', reason: 'check failed', step: 2 });
    expect(laneElapsedMs(lane, T0 + 60_000)).toBe(2_500);
  });

  it('ticks the clock of a running Lane from its start', () => {
    const lane = reduce(MESSAGES).lanes.webmcp;
    expect(laneElapsedMs(lane, T0 + 4_200)).toBe(4_200);
    // Never behind the server's own total.
    expect(laneElapsedMs(lane, T0 + 100)).toBe(2_000);
    expect(laneMetrics(lane, T0 + 4_200)).toMatchObject({
      durationMs: 4_200,
      steps: 2,
      toolCallsTotal: 2,
      screenshots: 1,
    });
  });

  it('keeps the log across Attempts and starts the next Attempt with fresh totals', () => {
    const state = reduce([
      ...MESSAGES,
      {
        type: 'lane_start',
        lane: 'webmcp',
        t: at(5000),
        scenario: 'second',
        attempt: 2,
        maxSteps: 50,
      },
    ]);
    expect(state.lanes.webmcp).toMatchObject({ status: 'running', attempt: 2, step: 0 });
    expect(state.lanes.webmcp.totals.toolCallsTotal).toBe(0);
    expect(state.lanes.webmcp.toolCalls).toHaveLength(2);
  });

  it('titles the Run with the current Scenario and Attempt', () => {
    expect(runProgress(liveRun())).toEqual({
      scenarioNumber: 2,
      scenarioCount: 2,
      scenario: 'second',
      attempt: 1,
      attempts: 2,
    });
    expect(runProgress(liveRun({ running: false, current: null }))).toBeNull();
    expect(runProgress(null)).toBeNull();
  });

  it('knows the running Run from the live state, or from the start this page just made', () => {
    const running = reduce(MESSAGES);
    expect(runningRunId(running, null)).toBe('run-1');
    const ended = reduce([{ type: 'run', run: liveRun({ running: false, current: null }) }]);
    expect(runningRunId(ended, null)).toBeNull();
    // Started here, not yet in the live state (which still shows the previous Run).
    expect(runningRunId(ended, 'run-2')).toBe('run-2');
    // The live state knows it and says it ended.
    expect(runningRunId(ended, 'run-1')).toBeNull();
  });

  it('writes a tool input as key: value pairs', () => {
    expect(formatToolInput({ color: 'red', maxPrice: 30 })).toBe('color: "red", maxPrice: 30');
    expect(formatToolInput({})).toBe('');
    expect(formatToolInput(null)).toBe('');
    expect(formatToolInput('raw')).toBe('"raw"');
  });

  it('hands each Lane its frames and replays the newest to a late listener', () => {
    const bus = new FrameBus();
    const early = vi.fn();
    const off = bus.subscribe('baseline', early);
    const a = new Uint8Array([1]);
    const b = new Uint8Array([2]);
    bus.push('baseline', a);
    bus.push('webmcp', b);
    expect(early).toHaveBeenCalledExactlyOnceWith(a);

    const late = vi.fn();
    bus.subscribe('webmcp', late);
    expect(late).toHaveBeenCalledExactlyOnceWith(b);

    off();
    bus.push('baseline', b);
    expect(early).toHaveBeenCalledTimes(1);

    bus.clear();
    const afterClear = vi.fn();
    bus.subscribe('baseline', afterClear);
    expect(afterClear).not.toHaveBeenCalled();
  });
});
