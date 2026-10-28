/** What the Results section and a past Run's Live view read out of results.json. */
import type { LaneId, LaneComparison, Results, ScenarioResult } from '../api.ts';
import { formatMetric, type MetricDef } from '../metrics.ts';

export const LANE_NAMES: Record<LaneId, string> = { baseline: 'Baseline', webmcp: 'WebMCP' };

export type HeadlineTone = 'pass' | 'fail' | 'neutral';

/** A Lane's verdict in a Scenario header: Pass/Fail, the pass count when Attempts > 1, a reason. */
export interface ScenarioHeadline {
  tone: HeadlineTone;
  label: string;
  /** The Fail reason, prefixed with its Attempt when the Run has several. */
  reason: string | null;
}

const STATUS_LABEL: Record<ScenarioResult['status'], string> = {
  pending: 'Not run',
  running: 'Running',
  done: 'Done',
  stopped: 'Stopped',
  skipped: 'Skipped',
};

export function scenarioHeadline(
  scenario: ScenarioResult,
  lane: LaneId,
  runAttempts: number,
): ScenarioHeadline {
  const attempts = scenario.attempts.map((record) => ({
    attempt: record.attempt,
    ...record[lane],
  }));
  if (attempts.length === 0) {
    return { tone: 'neutral', label: STATUS_LABEL[scenario.status], reason: null };
  }
  const passed = attempts.filter((a) => a.outcome === 'pass').length;
  const failed = attempts.filter((a) => a.outcome === 'fail');
  const lastFail = failed.at(-1);
  const tone: HeadlineTone = failed.length === 0 ? 'pass' : 'fail';
  if (runAttempts <= 1) {
    return {
      tone,
      label: tone === 'pass' ? 'Pass' : 'Fail',
      reason: lastFail?.reason ?? null,
    };
  }
  return {
    tone,
    label: `${tone === 'pass' ? 'Pass' : 'Fail'} ${passed}/${attempts.length}`,
    reason: lastFail?.reason ? `Attempt ${lastFail.attempt}: ${lastFail.reason}` : null,
  };
}

/** "67%" for a pass rate of 2/3. */
export function formatPassRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** "2.1 s to 3.4 s" from the min and max of a comparison, or null without them. */
export function rangeText(metric: MetricDef, comparison: LaneComparison): string | null {
  if (!comparison.min || !comparison.max) return null;
  const low = metric.value(comparison.min);
  const high = metric.value(comparison.max);
  if (low === null || high === null) return null;
  return `${formatMetric(metric, low)} to ${formatMetric(metric, high)}`;
}

/** Tool calls by name, most used first, then by name. */
export function toolCallList(toolCalls: Record<string, number>): { name: string; count: number }[] {
  return Object.entries(toolCalls)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * File name of a Lane's last agent screenshot. Files are numbered across the Run in the order
 * taken (`NNN-<scenario>-attempt-<n>.jpg`), so the last one is the Lane's screenshot count, in
 * the last Attempt that took one. Null when the Lane took none.
 */
export function lastScreenshotFile(results: Results, lane: LaneId): string | null {
  const count = results.summary[lane].screenshots;
  if (count <= 0) return null;
  for (const scenario of [...results.scenarios].reverse()) {
    for (const record of [...scenario.attempts].reverse()) {
      if (record[lane].screenshots > 0) {
        return `${String(count).padStart(3, '0')}-${scenario.id}-attempt-${record.attempt}.jpg`;
      }
    }
  }
  return null;
}

/** The Lane's last Attempt in the Run, for a past Run's Live status. */
export function lastAttempt(results: Results, lane: LaneId) {
  for (const scenario of [...results.scenarios].reverse()) {
    const record = scenario.attempts.at(-1);
    if (record) return { scenario: scenario.id, attempt: record.attempt, result: record[lane] };
  }
  return null;
}
