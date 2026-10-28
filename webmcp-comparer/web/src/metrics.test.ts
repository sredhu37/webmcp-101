import { describe, expect, it } from 'vitest';
import {
  METRICS,
  barPercent,
  compareValues,
  formatCost,
  formatCount,
  formatDuration,
  metricPair,
  totalTokens,
  type MetricKey,
} from './metrics.ts';
import { metrics } from './testing/fixtures.ts';

const metric = (key: MetricKey) => {
  const found = METRICS.find((m) => m.key === key);
  if (!found) throw new Error(key);
  return found;
};

describe('metrics', () => {
  it('lists the six compared metrics in scoreboard order', () => {
    expect(METRICS.map((m) => m.label)).toEqual([
      'Time',
      'Steps',
      'Tokens',
      'Cost',
      'Tool calls',
      'Screenshots',
    ]);
  });

  it('counts every token read or written once (reasoning is in output, screenshots in input)', () => {
    expect(
      totalTokens({
        input: 1000,
        cacheRead: 200,
        cacheWrite: 50,
        output: 300,
        reasoning: 120,
        screenshotEstimate: 800,
      }),
    ).toBe(1550);
  });

  it('formats time, counts, tokens and cost', () => {
    expect(formatDuration(2_345)).toBe('2.3 s');
    expect(formatDuration(59_940)).toBe('59.9 s');
    expect(formatDuration(125_400)).toBe('2 min 05 s');
    expect(formatCount(3)).toBe('3');
    expect(formatCount(2.333)).toBe('2.3');
    expect(metric('tokens').format(12_345.4)).toBe('12,345');
    expect(formatCost(0.001234567)).toBe('$0.0012');
  });

  describe('colouring: lower green, higher red, equal neutral', () => {
    it('marks the lower value lower and the higher one higher', () => {
      const pair = metricPair(metric('steps'), {
        baseline: metrics({ steps: 9 }),
        webmcp: metrics({ steps: 3 }),
      });
      expect(pair.baseline).toEqual({ value: 9, text: '9', comparison: 'higher' });
      expect(pair.webmcp).toEqual({ value: 3, text: '3', comparison: 'lower' });
    });

    it('leaves equal values neutral', () => {
      const pair = metricPair(metric('screenshots'), {
        baseline: metrics({ screenshots: 0 }),
        webmcp: metrics({ screenshots: 0 }),
      });
      expect(pair.baseline.comparison).toBe('equal');
      expect(pair.webmcp.comparison).toBe('equal');
    });

    it('compares at display precision, so values that read the same stay neutral', () => {
      expect(compareValues(metric('durationMs'), 2_340, 2_310)).toBe('equal');
      expect(compareValues(metric('durationMs'), 2_340, 2_240)).toBe('higher');
      expect(compareValues(metric('costUsd'), 0.00012, 0.000124)).toBe('equal');
      expect(compareValues(metric('costUsd'), 0.0002, 0.0001)).toBe('higher');
    });

    it('leaves a missing cost neutral on both sides', () => {
      const pair = metricPair(metric('costUsd'), {
        baseline: metrics({ costUsd: null }),
        webmcp: metrics({ costUsd: 0.01 }),
      });
      expect(pair.baseline).toEqual({ value: null, text: 'Not priced', comparison: 'none' });
      expect(pair.webmcp.comparison).toBe('none');
    });

    it('compares total tokens and the tool call total', () => {
      const values = {
        baseline: metrics({
          tokens: { ...metrics().tokens, input: 100, output: 10 },
          toolCallsTotal: 2,
        }),
        webmcp: metrics({
          tokens: { ...metrics().tokens, input: 50, cacheRead: 70 },
          toolCallsTotal: 5,
        }),
      };
      expect(metricPair(metric('tokens'), values).baseline.comparison).toBe('lower');
      expect(metricPair(metric('toolCalls'), values).baseline.comparison).toBe('lower');
    });
  });

  it('scales bars to the longer of the pair', () => {
    expect(barPercent(5, 10)).toBe(50);
    expect(barPercent(10, 5)).toBe(100);
    expect(barPercent(0, 0)).toBe(0);
    expect(barPercent(null, 3)).toBe(0);
    expect(barPercent(3, null)).toBe(100);
  });
});
