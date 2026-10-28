import type { AttemptMetrics, AttemptTokens } from '../agent/metrics.ts';
import type { LaneAttemptResult, LaneLimits, Outcome } from '../agent/run-lane.ts';
import type { LaneId } from '../lane/browser.ts';
import type { Provider } from '../pricing/price-table.ts';
import type { Scenario } from '../suite/parse.ts';

export const LANES: readonly LaneId[] = ['baseline', 'webmcp'];

/** results.json, keys in this order: run, summary, scenarios, suite. */
export interface Results {
  run: RunInfo;
  summary: Record<LaneId, LaneSummary>;
  scenarios: ScenarioResult[];
  /** Copy of the Suite that ran: the YAML as entered and the parsed Scenarios. */
  suite: { source: string; scenarios: Scenario[] };
}

export interface RunInfo {
  /** The Run folder name, `YYYY-MM-DD_HH-mm-ss` in local time. */
  id: string;
  startedAt: string;
  /** Null while the Run is going (or when the server died during it). */
  endedAt: string | null;
  durationMs: number | null;
  siteUrl: string;
  provider: Provider;
  model: string;
  effort: string;
  attempts: number;
  limits: LaneLimits;
  /** The selected Scenarios, in the order they run. */
  scenarioIds: string[];
  priceTableVersion: string;
  /** Models whose prices came from the user override file; null without one. */
  priceTableOverride: string[] | null;
  systemPromptVersion: string;
  stoppedByUser: boolean;
  /** Set when the Run itself failed, outside any Lane. */
  error: string | null;
}

/** Sums over every Attempt of the Lane in the Run. */
export interface LaneSummary {
  pass: number;
  fail: number;
  durationMs: number;
  steps: number;
  tokens: AttemptTokens;
  costUsd: number | null;
  toolCalls: Record<string, number>;
  toolCallsTotal: number;
  screenshots: number;
}

export type ScenarioStatus = 'pending' | 'running' | 'done' | 'stopped' | 'skipped';

export interface ScenarioResult {
  id: string;
  prompt: string;
  startUrl: string;
  /** `stopped`: Stop Run ended it before all its Attempts finished; `skipped`: it never started. */
  status: ScenarioStatus;
  /** Null until an Attempt has finished. */
  comparison: Record<LaneId, LaneComparison> | null;
  attempts: AttemptRecord[];
}

/** One Lane's metrics, as `LaneAttemptResult` without the fields the context already gives. */
export interface LaneAttempt extends AttemptMetrics {
  outcome: Outcome;
  reason: string | null;
  answer: string | null;
}

export interface AttemptRecord {
  attempt: number;
  baseline: LaneAttempt;
  webmcp: LaneAttempt;
}

/** Metric values of one Lane: means over Attempts, or the min or max. */
export interface MetricValues {
  durationMs: number;
  steps: number;
  tokens: AttemptTokens;
  costUsd: number | null;
  toolCalls: Record<string, number>;
  toolCallsTotal: number;
  screenshots: number;
}

/**
 * One Lane of a Scenario: the metric fields are means over its finished Attempts (the value
 * itself with one Attempt). `passRate`, `min` and `max` are present when the Run has Attempts > 1.
 */
export interface LaneComparison extends MetricValues {
  attempts: number;
  pass: number;
  fail: number;
  passRate?: number;
  min?: MetricValues;
  max?: MetricValues;
  /** WebMCP tools used in any Attempt, in first-use order. */
  webmcpTools: string[];
}

const TOKEN_FIELDS = [
  'input',
  'cacheRead',
  'cacheWrite',
  'output',
  'reasoning',
  'screenshotEstimate',
] as const satisfies readonly (keyof AttemptTokens)[];

export function laneAttempt(result: LaneAttemptResult): LaneAttempt {
  return {
    outcome: result.outcome,
    reason: result.reason,
    answer: result.answer,
    durationMs: result.durationMs,
    steps: result.steps,
    tokens: { ...result.tokens },
    costUsd: result.costUsd,
    toolCalls: { ...result.toolCalls },
    toolCallsTotal: result.toolCallsTotal,
    screenshots: result.screenshots,
    webmcpTools: [...result.webmcpTools],
  };
}

/** Per Lane, averaged over the Attempts; min, max and pass rate when the Run has Attempts > 1. */
export function compareLanes(
  attempts: readonly AttemptRecord[],
  runAttempts: number,
): Record<LaneId, LaneComparison> | null {
  if (attempts.length === 0) return null;
  const compare = (lane: LaneId): LaneComparison => {
    const results = attempts.map((attempt) => attempt[lane]);
    const pass = results.filter((result) => result.outcome === 'pass').length;
    const comparison: LaneComparison = {
      attempts: results.length,
      pass,
      fail: results.length - pass,
      ...aggregate(results, mean),
      webmcpTools: [...new Set(results.flatMap((result) => result.webmcpTools))],
    };
    if (runAttempts > 1) {
      comparison.passRate = pass / results.length;
      comparison.min = aggregate(results, (values) => Math.min(...values));
      comparison.max = aggregate(results, (values) => Math.max(...values));
    }
    return comparison;
  };
  return { baseline: compare('baseline'), webmcp: compare('webmcp') };
}

/** Sums per Lane over every Attempt of every Scenario. */
export function summarize(scenarios: readonly ScenarioResult[]): Record<LaneId, LaneSummary> {
  const summary = (lane: LaneId): LaneSummary => {
    const results = scenarios.flatMap((scenario) =>
      scenario.attempts.map((attempt) => attempt[lane]),
    );
    const pass = results.filter((result) => result.outcome === 'pass').length;
    return {
      pass,
      fail: results.length - pass,
      ...aggregate(results, sum),
    };
  };
  return { baseline: summary('baseline'), webmcp: summary('webmcp') };
}

function aggregate(
  results: readonly LaneAttempt[],
  reduce: (values: number[]) => number,
): MetricValues {
  const of = (pick: (result: LaneAttempt) => number): number => reduce(results.map(pick));
  const toolNames = [...new Set(results.flatMap((result) => Object.keys(result.toolCalls)))];
  const costs = results.map((result) => result.costUsd);
  return {
    durationMs: of((result) => result.durationMs),
    steps: of((result) => result.steps),
    tokens: Object.fromEntries(
      TOKEN_FIELDS.map((field) => [field, of((result) => result.tokens[field])]),
    ) as unknown as AttemptTokens,
    costUsd: costs.some((cost) => cost === null) ? null : reduce(costs as number[]),
    toolCalls: Object.fromEntries(
      toolNames.map((name) => [name, of((result) => result.toolCalls[name] ?? 0)]),
    ),
    toolCallsTotal: of((result) => result.toolCallsTotal),
    screenshots: of((result) => result.screenshots),
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}
