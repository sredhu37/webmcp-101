import type { LogRecord } from '../agent/lane-log.ts';
import type { Results } from '../run/results.ts';
import {
  LIVE_RESULT_LIMIT,
  emptyTotals,
  type LiveMessage,
  type LiveRun,
  type LiveToolCall,
  type LiveTotals,
} from './protocol.ts';

/** The live view's Run, from the results so far. */
export function liveRun(results: Results, running: boolean, current: LiveRun['current']): LiveRun {
  const { run } = results;
  return {
    id: run.id,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    siteUrl: run.siteUrl,
    provider: run.provider,
    model: run.model,
    attempts: run.attempts,
    limits: { ...run.limits },
    scenarios: results.scenarios.map((scenario) => ({ id: scenario.id, status: scenario.status })),
    current: running ? current : null,
    running,
    stoppedByUser: run.stoppedByUser,
    error: run.error,
  };
}

/**
 * The live message for one Lane log record: Lane start, each model call (Step), each tool call
 * and the Outcome. Null for records the live view does not show.
 */
export function laneMessage(record: LogRecord): LiveMessage | null {
  const { lane, t, scenario, attempt } = record;
  switch (record.event) {
    case 'lane_start': {
      const limits = record.limits;
      const maxSteps =
        typeof limits === 'object' && limits !== null && 'maxSteps' in limits
          ? numberOrNull(limits.maxSteps)
          : null;
      return { type: 'lane_start', lane, t, scenario, attempt, maxSteps };
    }
    case 'model_call':
      return {
        type: 'step',
        lane,
        t,
        step: numberOr(record.step, 0),
        durationMs: numberOr(record.durationMs, 0),
        totals: liveTotals(record.totals),
      };
    case 'tool_call':
      return {
        type: 'tool_call',
        lane,
        call: liveToolCall(record),
        totals: liveTotals(record.totals),
      };
    case 'lane_end':
      return {
        type: 'outcome',
        lane,
        t,
        scenario,
        attempt,
        outcome: record.outcome === 'pass' ? 'pass' : 'fail',
        reason: stringOrNull(record.reason),
        answer: stringOrNull(record.answer),
        totals: liveTotals(record),
      };
    default:
      return null;
  }
}

function liveToolCall(record: LogRecord): LiveToolCall {
  const result = stringOr(record.result, '');
  return {
    t: record.t,
    scenario: record.scenario,
    attempt: record.attempt,
    step: numberOr(record.step, 0),
    id: stringOr(record.id, ''),
    name: stringOr(record.name, ''),
    source: record.source === 'browser' || record.source === 'webmcp' ? record.source : null,
    webmcpName: stringOrNull(record.webmcpName),
    input: record.input ?? null,
    isError: record.isError === true,
    result:
      result.length <= LIVE_RESULT_LIMIT ? result : `${result.slice(0, LIVE_RESULT_LIMIT)}...`,
    screenshot: stringOrNull(record.screenshot),
    durationMs: numberOr(record.durationMs, 0),
  };
}

/** The metrics fields of a record (`totals`, or a `lane_end` record itself). */
function liveTotals(value: unknown): LiveTotals {
  const totals = emptyTotals();
  if (typeof value !== 'object' || value === null) return totals;
  const v = value as Partial<Record<keyof LiveTotals, unknown>>;
  const tokens = typeof v.tokens === 'object' && v.tokens !== null ? v.tokens : {};
  for (const key of Object.keys(totals.tokens) as (keyof LiveTotals['tokens'])[]) {
    totals.tokens[key] = numberOr((tokens as Record<string, unknown>)[key], 0);
  }
  totals.durationMs = numberOr(v.durationMs, 0);
  totals.steps = numberOr(v.steps, 0);
  totals.costUsd = v.costUsd === null ? null : numberOr(v.costUsd, 0);
  if (typeof v.toolCalls === 'object' && v.toolCalls !== null) {
    totals.toolCalls = Object.fromEntries(
      Object.entries(v.toolCalls).map(([name, count]) => [name, numberOr(count, 0)]),
    );
  }
  totals.toolCallsTotal = numberOr(v.toolCallsTotal, 0);
  totals.screenshots = numberOr(v.screenshots, 0);
  totals.webmcpTools = Array.isArray(v.webmcpTools)
    ? v.webmcpTools.filter((name): name is string => typeof name === 'string')
    : [];
  return totals;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
