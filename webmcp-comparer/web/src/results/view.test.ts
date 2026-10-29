import { describe, expect, it } from 'vitest';
import type { LaneComparison, Results, ScenarioResult } from '../api.ts';
import { METRICS } from '../metrics.ts';
import { RESULTS, laneAttempt, metrics } from '../testing/fixtures.ts';
import {
  formatPassRate,
  lastAttempt,
  lastScreenshotFile,
  rangeText,
  scenarioHeadline,
  toolCallList,
} from './view.ts';

function scenario(attempts: ScenarioResult['attempts'], status: ScenarioResult['status'] = 'done') {
  return {
    id: 's',
    prompt: 'p',
    startUrl: 'http://localhost:4000/',
    status,
    comparison: null,
    attempts,
  } satisfies ScenarioResult;
}

describe('results view', () => {
  describe('Scenario header verdicts', () => {
    it('shows Pass, or Fail with its reason, for one Attempt', () => {
      const [first] = RESULTS.scenarios;
      if (!first) throw new Error('fixture');
      expect(scenarioHeadline(first, 'baseline', 1)).toEqual({
        tone: 'fail',
        label: 'Fail',
        reason: 'check failed: answerContains "19.99"',
      });
      expect(scenarioHeadline(first, 'webmcp', 1)).toEqual({
        tone: 'pass',
        label: 'Pass',
        reason: null,
      });
    });

    it('shows the pass count and the last Fail reason with its Attempt when Attempts > 1', () => {
      const s = scenario([
        {
          attempt: 1,
          baseline: laneAttempt('fail', { reason: 'step limit' }),
          webmcp: laneAttempt('pass'),
        },
        {
          attempt: 2,
          baseline: laneAttempt('pass'),
          webmcp: laneAttempt('pass'),
        },
        {
          attempt: 3,
          baseline: laneAttempt('fail', { reason: 'stopped by user' }),
          webmcp: laneAttempt('pass'),
        },
      ]);
      expect(scenarioHeadline(s, 'baseline', 3)).toEqual({
        tone: 'fail',
        label: 'Fail 1/3',
        reason: 'Attempt 3: stopped by user',
      });
      expect(scenarioHeadline(s, 'webmcp', 3)).toEqual({
        tone: 'pass',
        label: 'Pass 3/3',
        reason: null,
      });
    });

    it('is neutral for a Scenario that never ran', () => {
      expect(scenarioHeadline(scenario([], 'skipped'), 'webmcp', 1)).toEqual({
        tone: 'neutral',
        label: 'Skipped',
        reason: null,
      });
    });
  });

  it('formats averages: pass rate and the min to max range', () => {
    expect(formatPassRate(2 / 3)).toBe('67%');
    expect(formatPassRate(1)).toBe('100%');
    const time = METRICS[0];
    if (!time) throw new Error('metric');
    const comparison: LaneComparison = {
      ...metrics({ durationMs: 3_000 }),
      attempts: 3,
      pass: 2,
      fail: 1,
      passRate: 2 / 3,
      min: metrics({ durationMs: 2_100 }),
      max: metrics({ durationMs: 3_400 }),
      webmcpTools: [],
    };
    expect(rangeText(time, comparison)).toBe('2.1 s to 3.4 s');
    expect(rangeText(time, { ...comparison, min: undefined, max: undefined })).toBeNull();
  });

  it('lists tool calls by count, then by name', () => {
    expect(toolCallList({ click: 2, screenshot: 5, read_page: 2 })).toEqual([
      { name: 'screenshot', count: 5 },
      { name: 'click', count: 2 },
      { name: 'read_page', count: 2 },
    ]);
  });

  describe('a past Run in Live', () => {
    it("names each Lane's last screenshot from its count and the last Attempt that took one", () => {
      // Baseline took 3 screenshots: 2 in `first`, 1 in `second`. WebMCP took none.
      expect(lastScreenshotFile(RESULTS, 'baseline')).toBe('003-second-attempt-1.jpg');
      expect(lastScreenshotFile(RESULTS, 'webmcp')).toBeNull();
    });

    it('skips later Attempts without screenshots', () => {
      const results: Results = structuredClone(RESULTS);
      const second = results.scenarios[1]?.attempts[0];
      if (!second) throw new Error('fixture');
      second.baseline.screenshots = 0;
      results.summary.baseline.screenshots = 2;
      expect(lastScreenshotFile(results, 'baseline')).toBe('002-first-attempt-1.jpg');
    });

    it("gives the Lane's last Attempt", () => {
      expect(lastAttempt(RESULTS, 'baseline')).toMatchObject({
        scenario: 'second',
        attempt: 1,
        result: { outcome: 'pass', steps: 4 },
      });
      expect(lastAttempt({ ...RESULTS, scenarios: [] }, 'baseline')).toBeNull();
    });
  });
});
