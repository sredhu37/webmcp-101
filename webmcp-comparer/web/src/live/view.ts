/** What the Live section reads out of the live state: title, clocks, the tool-call log. */
import type { MetricValues } from '../api.ts';
import type { LiveLane, LiveRun, LiveState, LiveToolCall } from './client.ts';

/** Where the Run is: "Scenario 2 of 3", its id, "Attempt 1 of 2". Null when nothing runs. */
export interface RunProgress {
  scenarioNumber: number;
  scenarioCount: number;
  scenario: string;
  attempt: number | null;
  attempts: number;
}

export function runProgress(run: LiveRun | null): RunProgress | null {
  if (!run?.running || !run.current) return null;
  const index = run.scenarios.findIndex((scenario) => scenario.id === run.current?.scenario);
  return {
    scenarioNumber: index + 1,
    scenarioCount: run.scenarios.length,
    scenario: run.current.scenario,
    attempt: run.current.attempt,
    attempts: run.attempts,
  };
}

/** Milliseconds the Lane has run: ticking from `startedAt` while it runs, else its total. */
export function laneElapsedMs(lane: LiveLane, now: number): number {
  if (lane.status !== 'running' || !lane.startedAt) return lane.totals.durationMs;
  const started = Date.parse(lane.startedAt);
  if (Number.isNaN(started)) return lane.totals.durationMs;
  return Math.max(lane.totals.durationMs, now - started);
}

/** The scoreboard values of a Lane in the current Attempt. */
export function laneMetrics(lane: LiveLane, now: number): MetricValues {
  const { totals } = lane;
  return {
    durationMs: laneElapsedMs(lane, now),
    steps: totals.steps,
    tokens: totals.tokens,
    costUsd: totals.costUsd,
    toolCalls: totals.toolCalls,
    toolCallsTotal: totals.toolCallsTotal,
    screenshots: totals.screenshots,
  };
}

/** The Lane's tool calls of the whole Run, newest first. */
export function toolLog(lane: LiveLane): LiveToolCall[] {
  return [...lane.toolCalls].reverse();
}

/** `color: "red", category: "shirts"` for a tool input; inputs that are not objects as JSON. */
export function formatToolInput(input: unknown): string {
  if (input === null || input === undefined) return '';
  if (typeof input !== 'object' || Array.isArray(input)) return JSON.stringify(input);
  return Object.entries(input as Record<string, unknown>)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(', ');
}

/**
 * The id of the Run going on. The live state decides once it knows the Run; until then a Run this
 * page just started counts as running (`startedId`), so Live opens without waiting for a message.
 */
export function runningRunId(state: LiveState, startedId: string | null): string | null {
  if (state.run?.running) return state.run.id;
  if (startedId && state.run?.id !== startedId) return startedId;
  return null;
}
