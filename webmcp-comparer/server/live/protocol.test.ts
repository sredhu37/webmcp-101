import { describe, expect, it } from 'vitest';
import type { LogRecord } from '../agent/lane-log.ts';
import { laneMessage } from './events.ts';
import {
  LIVE_RESULT_LIMIT,
  applyLiveMessage,
  decodeFrame,
  emptyLiveState,
  emptyTotals,
  encodeFrame,
  parseLiveMessage,
  screenshotUrl,
  type LiveMessage,
  type LiveRun,
  type LiveToolCall,
} from './protocol.ts';

const T = '2026-10-16T10:00:00.000Z';

function record(event: LogRecord['event'], fields: Record<string, unknown> = {}): LogRecord {
  return { t: T, lane: 'webmcp', scenario: 's1', attempt: 2, event, ...fields };
}

const totals = {
  durationMs: 1234,
  steps: 2,
  tokens: {
    input: 10,
    cacheRead: 1,
    cacheWrite: 2,
    output: 3,
    reasoning: 1,
    screenshotEstimate: 0,
  },
  costUsd: 0.000123,
  toolCalls: { search_products: 1 },
  toolCallsTotal: 1,
  screenshots: 0,
  webmcpTools: ['search_products'],
};

function liveRun(id: string, running = true): LiveRun {
  return {
    id,
    startedAt: T,
    endedAt: null,
    siteUrl: 'http://localhost:4000',
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    attempts: 1,
    limits: { maxSteps: 50, maxDurationMs: 300_000, maxCostUsd: 2 },
    scenarios: [{ id: 's1', status: 'running' }],
    current: { scenario: 's1', attempt: 1 },
    running,
    stoppedByUser: false,
    error: null,
  };
}

function call(fields: Partial<LiveToolCall> = {}): LiveToolCall {
  return {
    t: T,
    scenario: 's1',
    attempt: 1,
    step: 1,
    id: 'c1',
    name: 'screenshot',
    source: 'browser',
    webmcpName: null,
    input: {},
    isError: false,
    result: '',
    screenshot: null,
    durationMs: 5,
    ...fields,
  };
}

describe('frames', () => {
  it('puts the Lane byte before the JPEG and reads it back', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    for (const [lane, byte] of [
      ['baseline', 0],
      ['webmcp', 1],
    ] as const) {
      const message = encodeFrame(lane, jpeg);
      expect(message[0]).toBe(byte);
      expect([...message.subarray(1)]).toEqual([...jpeg]);
      const decoded = decodeFrame(message.buffer as ArrayBuffer);
      expect(decoded?.lane).toBe(lane);
      expect([...decoded!.jpeg]).toEqual([...jpeg]);
    }
  });

  it('rejects messages that are not frames', () => {
    expect(decodeFrame(new Uint8Array([]))).toBeNull();
    expect(decodeFrame(new Uint8Array([0]))).toBeNull();
    expect(decodeFrame(new Uint8Array([7, 0xff, 0xd8]))).toBeNull();
  });
});

describe('parseLiveMessage', () => {
  it('accepts known message types only', () => {
    expect(parseLiveMessage('{"type":"run","run":{}}')).toEqual({ type: 'run', run: {} });
    expect(parseLiveMessage('{"type":"other"}')).toBeNull();
    expect(parseLiveMessage('[1]')).toBeNull();
    expect(parseLiveMessage('null')).toBeNull();
    expect(parseLiveMessage('not json')).toBeNull();
  });
});

describe('laneMessage', () => {
  it('turns Lane start into a lane_start with the Step limit', () => {
    expect(laneMessage(record('lane_start', { limits: { maxSteps: 12 } }))).toEqual({
      type: 'lane_start',
      lane: 'webmcp',
      t: T,
      scenario: 's1',
      attempt: 2,
      maxSteps: 12,
    });
  });

  it('turns a model call into a Step with running totals', () => {
    expect(
      laneMessage(record('model_call', { step: 2, durationMs: 40, text: 'hi', totals })),
    ).toEqual({ type: 'step', lane: 'webmcp', t: T, step: 2, durationMs: 40, totals });
  });

  it('turns a tool call into a live tool call with a short result', () => {
    const message = laneMessage(
      record('tool_call', {
        step: 1,
        id: 'call-1',
        name: 'cart_peek',
        source: 'webmcp',
        webmcpName: 'cart.peek',
        input: { a: 1 },
        isError: true,
        result: 'x'.repeat(2_000),
        durationMs: 7,
        totals,
      }),
    );
    expect(message).toEqual({
      type: 'tool_call',
      lane: 'webmcp',
      call: {
        t: T,
        scenario: 's1',
        attempt: 2,
        step: 1,
        id: 'call-1',
        name: 'cart_peek',
        source: 'webmcp',
        webmcpName: 'cart.peek',
        input: { a: 1 },
        isError: true,
        result: `${'x'.repeat(LIVE_RESULT_LIMIT)}...`,
        screenshot: null,
        durationMs: 7,
      },
      totals,
    });
  });

  it('marks unknown tools as having no source and keeps the screenshot file', () => {
    const unknown = laneMessage(record('tool_call', { name: 'nope', isError: true, totals }));
    expect(unknown).toMatchObject({ call: { source: null, isError: true } });
    const shot = laneMessage(
      record('tool_call', { name: 'screenshot', source: 'browser', screenshot: '001-s1.jpg' }),
    );
    expect(shot).toMatchObject({ call: { screenshot: '001-s1.jpg' }, totals: emptyTotals() });
  });

  it('turns Lane end into the Outcome with its metrics', () => {
    expect(
      laneMessage(
        record('lane_end', { outcome: 'fail', reason: 'step limit', answer: null, ...totals }),
      ),
    ).toEqual({
      type: 'outcome',
      lane: 'webmcp',
      t: T,
      scenario: 's1',
      attempt: 2,
      outcome: 'fail',
      reason: 'step limit',
      answer: null,
      totals,
    });
  });

  it('keeps a null cost (unpriced Step)', () => {
    const message = laneMessage(record('model_call', { totals: { ...totals, costUsd: null } }));
    expect(message).toMatchObject({ totals: { costUsd: null } });
  });

  it('skips records the live view does not show', () => {
    for (const event of ['webmcp_tools_changed', 'reminder', 'finish', 'check', 'error'] as const) {
      expect(laneMessage(record(event))).toBeNull();
    }
  });
});

describe('applyLiveMessage', () => {
  const run1 = liveRun('run-1');

  it('starts each new Run with fresh Lanes and keeps them within a Run', () => {
    let state = applyLiveMessage(emptyLiveState(), { type: 'run', run: run1 });
    state = applyLiveMessage(state, {
      type: 'lane_start',
      lane: 'baseline',
      t: T,
      scenario: 's1',
      attempt: 1,
      maxSteps: 50,
    });
    const same = applyLiveMessage(state, { type: 'run', run: { ...run1, running: false } });
    expect(same.lanes.baseline.status).toBe('running');
    expect(same.run?.running).toBe(false);

    const next = applyLiveMessage(same, { type: 'run', run: liveRun('run-2') });
    expect(next.lanes).toEqual(emptyLiveState().lanes);
  });

  it('follows a Lane through an Attempt and keeps the Run tool-call log across Attempts', () => {
    const messages: LiveMessage[] = [
      { type: 'run', run: run1 },
      { type: 'lane_start', lane: 'baseline', t: T, scenario: 's1', attempt: 1, maxSteps: 50 },
      { type: 'step', lane: 'baseline', t: T, step: 1, durationMs: 10, totals },
      {
        type: 'tool_call',
        lane: 'baseline',
        call: call({ screenshot: '001-s1-attempt-1.jpg' }),
        totals: { ...totals, screenshots: 1 },
      },
      {
        type: 'outcome',
        lane: 'baseline',
        t: T,
        scenario: 's1',
        attempt: 1,
        outcome: 'pass',
        reason: null,
        answer: 'ok',
        totals,
      },
    ];
    const state = messages.reduce(applyLiveMessage, emptyLiveState());
    expect(state.lanes.baseline).toMatchObject({
      status: 'pass',
      scenario: 's1',
      attempt: 1,
      startedAt: T,
      endedAt: T,
      maxSteps: 50,
      step: 2,
      answer: 'ok',
      lastScreenshot: screenshotUrl('run-1', 'baseline', '001-s1-attempt-1.jpg'),
    });
    expect(state.lanes.baseline.lastScreenshot).toBe(
      '/api/runs/run-1/baseline/screenshots/001-s1-attempt-1.jpg',
    );
    expect(state.lanes.webmcp).toEqual(emptyLiveState().lanes.webmcp);

    const second = applyLiveMessage(state, {
      type: 'lane_start',
      lane: 'baseline',
      t: T,
      scenario: 's1',
      attempt: 2,
      maxSteps: 50,
    });
    expect(second.lanes.baseline).toMatchObject({
      status: 'running',
      attempt: 2,
      step: 0,
      totals: emptyTotals(),
      reason: null,
      answer: null,
      endedAt: null,
    });
    expect(second.lanes.baseline.toolCalls).toHaveLength(1);
    expect(second.lanes.baseline.lastScreenshot).toBe(state.lanes.baseline.lastScreenshot);
  });

  it('never changes the state it is given', () => {
    const before = applyLiveMessage(emptyLiveState(), { type: 'run', run: run1 });
    const copy = structuredClone(before);
    applyLiveMessage(before, { type: 'tool_call', lane: 'webmcp', call: call(), totals });
    expect(before).toEqual(copy);
  });

  it('replaces the state with a snapshot', () => {
    const snapshot = applyLiveMessage(emptyLiveState(), { type: 'run', run: run1 });
    expect(applyLiveMessage(emptyLiveState(), { type: 'snapshot', state: snapshot })).toBe(
      snapshot,
    );
  });
});
