import type { LaneAttemptResult, RunLaneOptions } from '../agent/run-lane.ts';
import type { LaneRunner } from '../run/orchestrator.ts';

export interface FakeLanePlan {
  /** Fields of the returned result; the rest are zero metrics and a Pass. */
  result?: Partial<Omit<LaneAttemptResult, 'lane' | 'scenario' | 'attempt'>>;
  /** How long the Lane takes; Stop Run cuts it short. */
  delayMs?: number;
  /** Runs until Stop Run, then Fails `stopped by user` like the real loop. */
  untilStopped?: boolean;
}

export interface FakeLaneRunner extends LaneRunner {
  calls: RunLaneOptions[];
  /** `start:<lane>:<scenario>:<attempt>` and `end:...`, in the order they happened. */
  timeline: string[];
}

/**
 * Stands in for `runLane` in orchestrator tests: writes `lane_start` and `lane_end` to the Lane's
 * log like the real loop, waits, and returns the planned result.
 */
export function fakeRunLane(
  plan: (options: RunLaneOptions) => FakeLanePlan = () => ({}),
): FakeLaneRunner {
  const calls: RunLaneOptions[] = [];
  const timeline: string[] = [];
  const runner = async (options: RunLaneOptions): Promise<LaneAttemptResult> => {
    calls.push(options);
    const { lane, scenario, attempt, output, signal } = options;
    const tag = `${lane}:${scenario.id}:${attempt}`;
    const log = (event: 'lane_start' | 'lane_end', fields: Record<string, unknown> = {}): void => {
      options.onEvent?.(output.log.write(scenario.id, attempt, event, fields));
    };
    const planned = plan(options);
    timeline.push(`start:${tag}`);
    log('lane_start', { model: options.model.modelId, limits: options.limits });

    await new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      const timer = planned.untilStopped ? undefined : setTimeout(resolve, planned.delayMs ?? 0);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });

    const stopped = signal?.aborted === true;
    const result: LaneAttemptResult = {
      lane,
      scenario: scenario.id,
      attempt,
      outcome: 'pass',
      reason: null,
      answer: 'done',
      durationMs: 1_000,
      steps: 1,
      tokens: {
        input: 100,
        cacheRead: 0,
        cacheWrite: 0,
        output: 10,
        reasoning: 0,
        screenshotEstimate: 0,
      },
      costUsd: 0.001,
      toolCalls: {},
      toolCallsTotal: 0,
      screenshots: 0,
      webmcpTools: [],
      ...planned.result,
      ...(stopped ? { outcome: 'fail' as const, reason: 'stopped by user', answer: null } : {}),
    };
    timeline.push(`end:${tag}`);
    log('lane_end', { outcome: result.outcome, reason: result.reason, answer: result.answer });
    return result;
  };
  return Object.assign(runner, { calls, timeline });
}
