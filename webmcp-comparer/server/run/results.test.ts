import { describe, expect, it } from 'vitest';
import { compareLanes, summarize, type AttemptRecord, type LaneAttempt } from './results.ts';

function lane(overrides: Partial<LaneAttempt> = {}): LaneAttempt {
  return {
    outcome: 'pass',
    reason: null,
    answer: 'ok',
    durationMs: 1_000,
    steps: 2,
    tokens: {
      input: 100,
      cacheRead: 10,
      cacheWrite: 5,
      output: 50,
      reasoning: 20,
      screenshotEstimate: 0,
    },
    costUsd: 0.01,
    toolCalls: {},
    toolCallsTotal: 0,
    screenshots: 0,
    webmcpTools: [],
    ...overrides,
  };
}

function attempt(n: number, baseline: LaneAttempt, webmcp: LaneAttempt = lane()): AttemptRecord {
  return { attempt: n, baseline, webmcp };
}

describe('compareLanes', () => {
  it('returns null before any Attempt has finished', () => {
    expect(compareLanes([], 1)).toBeNull();
  });

  it('keeps the raw values of a single Attempt, without min, max or pass rate', () => {
    const baseline = lane({
      durationMs: 1_234,
      steps: 5,
      toolCalls: { click: 2, read_page: 1 },
      toolCallsTotal: 3,
      screenshots: 1,
    });
    const comparison = compareLanes([attempt(1, baseline)], 1)!;

    expect(comparison.baseline).toEqual({
      attempts: 1,
      pass: 1,
      fail: 0,
      durationMs: 1_234,
      steps: 5,
      tokens: baseline.tokens,
      costUsd: 0.01,
      toolCalls: { click: 2, read_page: 1 },
      toolCallsTotal: 3,
      screenshots: 1,
      webmcpTools: [],
    });
    expect(Object.keys(comparison)).toEqual(['baseline', 'webmcp']);
  });

  it('averages over Attempts with min, max and pass rate when Attempts > 1', () => {
    const attempts = [
      attempt(
        1,
        lane({ durationMs: 1_000, steps: 2, costUsd: 0.01, toolCalls: { click: 2 } }),
        lane({ webmcpTools: ['add_to_cart'], toolCalls: { add_to_cart: 1 }, toolCallsTotal: 1 }),
      ),
      attempt(
        2,
        lane({
          outcome: 'fail',
          reason: 'step limit',
          durationMs: 2_000,
          steps: 6,
          costUsd: 0.03,
          toolCalls: { navigate: 3 },
          toolCallsTotal: 3,
          tokens: {
            input: 300,
            cacheRead: 30,
            cacheWrite: 15,
            output: 150,
            reasoning: 60,
            screenshotEstimate: 1_334,
          },
          screenshots: 1,
        }),
        lane({
          webmcpTools: ['search_products', 'add_to_cart'],
          toolCalls: { search_products: 1, add_to_cart: 1 },
          toolCallsTotal: 2,
        }),
      ),
      attempt(3, lane({ durationMs: 3_000, steps: 4, costUsd: 0.02 })),
    ];
    const { baseline, webmcp } = compareLanes(attempts, 3)!;

    expect(baseline).toMatchObject({
      attempts: 3,
      pass: 2,
      fail: 1,
      passRate: 2 / 3,
      durationMs: 2_000,
      steps: 4,
      costUsd: (0.01 + 0.03 + 0.02) / 3,
      toolCalls: { click: 2 / 3, navigate: 1 },
      toolCallsTotal: 1,
      screenshots: 1 / 3,
    });
    expect(baseline.tokens.input).toBeCloseTo(500 / 3);
    expect(baseline.tokens.screenshotEstimate).toBeCloseTo(1_334 / 3);
    expect(baseline.min).toEqual({
      durationMs: 1_000,
      steps: 2,
      tokens: {
        input: 100,
        cacheRead: 10,
        cacheWrite: 5,
        output: 50,
        reasoning: 20,
        screenshotEstimate: 0,
      },
      costUsd: 0.01,
      toolCalls: { click: 0, navigate: 0 },
      toolCallsTotal: 0,
      screenshots: 0,
    });
    expect(baseline.max).toMatchObject({
      durationMs: 3_000,
      steps: 6,
      costUsd: 0.03,
      toolCalls: { click: 2, navigate: 3 },
      toolCallsTotal: 3,
      screenshots: 1,
      tokens: { input: 300, screenshotEstimate: 1_334 },
    });
    expect(webmcp.passRate).toBe(1);
    expect(webmcp.webmcpTools).toEqual(['add_to_cart', 'search_products']);
  });

  it('uses the Run setting for min/max even when Stop Run left only one Attempt', () => {
    const { baseline } = compareLanes([attempt(1, lane())], 3)!;
    expect(baseline).toMatchObject({ attempts: 1, passRate: 1 });
    expect(baseline.min).toEqual(baseline.max);
  });

  it('gives a null cost when any Attempt could not be priced', () => {
    const { baseline } = compareLanes(
      [attempt(1, lane()), attempt(2, lane({ costUsd: null }))],
      2,
    )!;
    expect(baseline.costUsd).toBeNull();
    expect(baseline.min?.costUsd).toBeNull();
  });

  it('stores raw values only: no percentages and no difference fields', () => {
    const comparison = compareLanes([attempt(1, lane()), attempt(2, lane())], 2)!;
    const keys = JSON.stringify(comparison).match(/"[A-Za-z]+":/g) ?? [];
    expect(keys.some((key) => /percent|pct|diff|delta|saving|speedup/i.test(key))).toBe(false);
  });
});

describe('summarize', () => {
  it('sums every Attempt of every Scenario per Lane', () => {
    const scenario = (attempts: AttemptRecord[]) => ({
      id: 's',
      prompt: 'p',
      startUrl: 'http://x/',
      status: 'done' as const,
      comparison: null,
      attempts,
    });
    const summary = summarize([
      scenario([attempt(1, lane({ toolCalls: { click: 1 }, toolCallsTotal: 1 }))]),
      scenario([
        attempt(1, lane({ outcome: 'fail', reason: 'cost limit', screenshots: 2 })),
        attempt(2, lane({ toolCalls: { click: 2, navigate: 1 }, toolCallsTotal: 3 })),
      ]),
    ]);

    expect(Object.keys(summary)).toEqual(['baseline', 'webmcp']);
    expect(summary.baseline).toEqual({
      pass: 2,
      fail: 1,
      durationMs: 3_000,
      steps: 6,
      tokens: {
        input: 300,
        cacheRead: 30,
        cacheWrite: 15,
        output: 150,
        reasoning: 60,
        screenshotEstimate: 0,
      },
      costUsd: 0.01 + 0.01 + 0.01,
      toolCalls: { click: 3, navigate: 1 },
      toolCallsTotal: 4,
      screenshots: 2,
    });
    expect(summary.webmcp.pass).toBe(3);
  });

  it('is all zeros before anything ran', () => {
    expect(summarize([]).baseline).toMatchObject({ pass: 0, fail: 0, steps: 0, costUsd: 0 });
  });
});
