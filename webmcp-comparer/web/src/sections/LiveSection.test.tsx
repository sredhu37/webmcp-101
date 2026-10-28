// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyLiveMessage,
  emptyLiveState,
  emptyTotals,
  type LiveMessage,
  type LiveState,
  type LiveToolCall,
} from '../live/client.ts';
import { FrameBus } from '../live/frames.ts';
import { RESULTS } from '../testing/fixtures.ts';
import { LiveSection } from './LiveSection.tsx';

afterEach(cleanup);

const T0 = Date.parse('2026-10-16T10:00:00.000Z');
const at = (ms: number) => new Date(T0 + ms).toISOString();

function call(lane: 'baseline' | 'webmcp', step: number, name: string): LiveToolCall {
  return {
    t: at(step * 1000),
    scenario: 'first',
    attempt: 1,
    step,
    id: `${lane}-${step}`,
    name,
    source: name === 'search_products' ? 'webmcp' : 'browser',
    webmcpName: null,
    input: name === 'navigate' ? { url: '/search' } : {},
    isError: false,
    result: 'ok',
    screenshot: null,
    durationMs: 5,
  };
}

const totals = (values: Partial<ReturnType<typeof emptyTotals>>) => ({
  ...emptyTotals(),
  ...values,
});

function liveState(extra: LiveMessage[] = []): LiveState {
  const messages: LiveMessage[] = [
    {
      type: 'run',
      run: {
        id: 'run-1',
        startedAt: at(0),
        endedAt: null,
        siteUrl: 'http://localhost:4000',
        provider: 'anthropic',
        model: 'claude-haiku-5-5',
        attempts: 1,
        limits: { maxSteps: 20, maxDurationMs: 300_000, maxCostUsd: 2 },
        scenarios: [
          { id: 'first', status: 'running' },
          { id: 'second', status: 'pending' },
        ],
        current: { scenario: 'first', attempt: 1 },
        running: true,
        stoppedByUser: false,
        error: null,
      },
    },
    ...(['baseline', 'webmcp'] as const).map((lane): LiveMessage => ({
      type: 'lane_start',
      lane,
      t: at(0),
      scenario: 'first',
      attempt: 1,
      maxSteps: 20,
    })),
    {
      type: 'tool_call',
      lane: 'baseline',
      call: call('baseline', 1, 'navigate'),
      totals: totals({ steps: 1, toolCallsTotal: 1 }),
    },
    {
      type: 'step',
      lane: 'baseline',
      t: at(2000),
      step: 2,
      durationMs: 1000,
      totals: totals({ steps: 2, toolCallsTotal: 1, costUsd: 0.003 }),
    },
    {
      type: 'tool_call',
      lane: 'baseline',
      call: call('baseline', 2, 'screenshot'),
      totals: totals({ steps: 2, toolCallsTotal: 2, screenshots: 1, costUsd: 0.003 }),
    },
    {
      type: 'tool_call',
      lane: 'webmcp',
      call: call('webmcp', 1, 'search_products'),
      totals: totals({ steps: 1, toolCallsTotal: 1, costUsd: 0.001 }),
    },
    {
      type: 'outcome',
      lane: 'webmcp',
      t: at(1500),
      scenario: 'first',
      attempt: 1,
      outcome: 'pass',
      reason: null,
      answer: '19.99',
      totals: totals({ steps: 1, toolCallsTotal: 1, costUsd: 0.001, durationMs: 1_500 }),
    },
    ...extra,
  ];
  return messages.reduce(applyLiveMessage, emptyLiveState());
}

function renderLive(state: LiveState, props: Partial<Parameters<typeof LiveSection>[0]> = {}) {
  const onStop = vi.fn();
  const view = render(
    <LiveSection
      live={state}
      frames={new FrameBus()}
      runningId={state.run?.running ? state.run.id : null}
      past={null}
      stopping={false}
      onStop={onStop}
      {...props}
    />,
  );
  return { ...view, onStop };
}

const laneColumn = (lane: string) => {
  const element = document.querySelector<HTMLElement>(`.lane[data-lane="${lane}"]`);
  if (!element) throw new Error(`No ${lane} column`);
  return within(element);
};

describe('LiveSection', () => {
  it('titles the Run with its Scenario and Attempt progress', () => {
    renderLive(liveState());
    const head = screen.getByRole('heading', { name: 'Live' }).parentElement;
    expect(head?.textContent).toContain('Scenario 1 of 2');
    expect(head?.textContent).toContain('first');
    expect(head?.textContent).toContain('Attempt 1 of 1');
  });

  it('shows each Lane with its status, screen and Step meter', () => {
    renderLive(liveState());
    expect(laneColumn('baseline').getByText('Running')).toBeTruthy();
    const pass = laneColumn('webmcp').getByText('Pass').closest('.pill');
    expect(pass?.textContent).toBe('Pass1.5 s');
    expect(laneColumn('baseline').getByText('Waiting for the first frame')).toBeTruthy();

    const meter = laneColumn('baseline').getByRole('meter', { name: 'Baseline Steps' });
    expect(meter.getAttribute('aria-valuenow')).toBe('2');
    expect(meter.getAttribute('aria-valuemax')).toBe('20');
    expect(laneColumn('baseline').getByText('limit 20')).toBeTruthy();
  });

  it('shows a Fail with its reason', () => {
    renderLive(
      liveState([
        {
          type: 'outcome',
          lane: 'baseline',
          t: at(3000),
          scenario: 'first',
          attempt: 1,
          outcome: 'fail',
          reason: 'step limit reached',
          answer: null,
          totals: totals({ steps: 20, durationMs: 3_000 }),
        },
      ]),
    );
    expect(laneColumn('baseline').getByText('Fail').closest('.pill')?.textContent).toBe(
      'Fail3.0 s',
    );
    expect(laneColumn('baseline').getByText('step limit reached')).toBeTruthy();
  });

  it('colours the scoreboard: lower green, higher red, equal neutral', () => {
    renderLive(liveState());
    const row = (metric: string) =>
      [...document.querySelectorAll(`.scoreboard tr[data-metric="${metric}"] td`)].map(
        (cell) => [cell.textContent, cell.getAttribute('data-compare')] as const,
      );
    expect(row('steps')).toEqual([
      ['2, higher', 'higher'],
      ['1, lower', 'lower'],
    ]);
    expect(row('costUsd')).toEqual([
      ['$0.0030, higher', 'higher'],
      ['$0.0010, lower', 'lower'],
    ]);
    expect(row('tokens')).toEqual([
      ['0', 'equal'],
      ['0', 'equal'],
    ]);
  });

  it("lists each Lane's tool calls newest first and marks WebMCP tools", () => {
    renderLive(liveState());
    const baselineLog = screen.getByRole('log', { name: 'Baseline tool calls, newest first' });
    expect(
      [...baselineLog.querySelectorAll('.tool-row .tool-name')].map((n) => n.textContent),
    ).toEqual(['screenshot', 'navigate']);
    expect(baselineLog.textContent).toContain('url: "/search"');

    const webmcpLog = screen.getByRole('log', { name: 'WebMCP tool calls, newest first' });
    const row = webmcpLog.querySelector('.tool-row');
    expect(row?.getAttribute('data-source')).toBe('webmcp');
    expect(within(webmcpLog).getByText('WebMCP')).toBeTruthy();
  });

  it('slides in only the calls that arrive after the log first rendered', () => {
    const { rerender, onStop } = renderLive(liveState());
    expect(document.querySelectorAll('.tool-row[data-enter]')).toHaveLength(0);
    const next = liveState([
      {
        type: 'tool_call',
        lane: 'baseline',
        call: call('baseline', 3, 'click'),
        totals: totals({ steps: 3, toolCallsTotal: 3 }),
      },
    ]);
    rerender(
      <LiveSection
        live={next}
        frames={new FrameBus()}
        runningId="run-1"
        past={null}
        stopping={false}
        onStop={onStop}
      />,
    );
    const entering = [...document.querySelectorAll('.tool-row[data-enter]')];
    expect(entering.map((row) => row.querySelector('.tool-name')?.textContent)).toEqual(['click']);
  });

  it('stops the Run, and shows Stopping meanwhile', async () => {
    const { onStop, rerender } = renderLive(liveState());
    await userEvent.click(screen.getByRole('button', { name: 'Stop Run' }));
    expect(onStop).toHaveBeenCalledOnce();
    rerender(
      <LiveSection
        live={liveState()}
        frames={new FrameBus()}
        runningId="run-1"
        past={null}
        stopping
        onStop={onStop}
      />,
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Stopping' }).disabled).toBe(true);
  });

  it("ticks a running Lane's clock", () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      vi.setSystemTime(T0 + 2_000);
      renderLive(liveState());
      const time = () =>
        document.querySelector('.scoreboard tr[data-metric="durationMs"] td')?.textContent;
      expect(time()).toBe('2.0 s, higher');
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(time()).toBe('3.0 s, higher');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the final state after the Run, without Stop Run', () => {
    const ended = liveState([
      {
        type: 'run',
        run: { ...liveState().run!, running: false, current: null, endedAt: at(9000) },
      },
    ]);
    renderLive(ended, { runningId: null });
    expect(screen.getByText('Run ended')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop Run' })).toBeNull();
  });

  it("shows a past Run's last screenshot per Lane, or a neutral empty state", () => {
    renderLive(emptyLiveState(), { past: RESULTS, runningId: null });
    const image = laneColumn('baseline').getByRole('img');
    expect(image.getAttribute('src')).toBe(
      '/api/runs/2026-10-16_10-00-00/baseline/screenshots/003-second-attempt-1.jpg',
    );
    expect(laneColumn('webmcp').getByText('No screenshots in this Run')).toBeTruthy();
    expect(laneColumn('baseline').getByText('Pass')).toBeTruthy();
    expect(screen.getByText('Whole Run')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop Run' })).toBeNull();
  });
});
