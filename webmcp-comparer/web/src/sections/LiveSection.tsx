import { memo, useEffect, useRef, useState } from 'react';
import { LANES, type LaneId, type Results } from '../api.ts';
import { Icon } from '../components/Icon.tsx';
import { scrollToSection } from '../format.ts';
import { emptyLiveState, screenshotUrl, type LiveState } from '../live/client.ts';
import type { FrameBus } from '../live/frames.ts';
import { laneElapsedMs, laneMetrics, runProgress } from '../live/view.ts';
import { lastAttempt, lastScreenshotFile } from '../results/view.ts';
import { LaneColumn, type LaneView } from './live/LaneColumn.tsx';
import { Scoreboard } from './live/Scoreboard.tsx';
import { ToolLog } from './live/ToolLog.tsx';

export interface LiveSectionProps {
  /** The live state from `GET /api/live`. */
  live: LiveState;
  frames: FrameBus;
  /** The Run that is going, or null. */
  runningId: string | null;
  /** A past Run opened from the sidebar, shown with each Lane's last screenshot. */
  past: Results | null;
  stopping: boolean;
  onStop: () => void;
}

const MemoToolLog = memo(ToolLog);

/** How often the running clocks redraw. */
const CLOCK_MS = 100;

/**
 * The Live section: both Lanes side by side, the scoreboard, the tool-call logs and Stop Run.
 * A Run going on (or the last one, after it ended) streams in; a past Run opened from the
 * sidebar shows each Lane's last screenshot and the Run totals.
 */
export function LiveSection({ live, frames, runningId, past, stopping, onStop }: LiveSectionProps) {
  const section = useRef<HTMLElement>(null);

  useEffect(() => {
    if (runningId) scrollToSection(section.current);
  }, [runningId]);

  const showLive = runningId !== null || (!past && live.run !== null);
  if (!showLive && !past) return null;
  return (
    <section className="section" aria-labelledby="live-title" id="live" ref={section}>
      {showLive ? (
        <LiveRunView
          // A new Run starts with fresh logs, screens and value ticks.
          key={runningId ?? live.run?.id}
          live={live}
          frames={frames}
          runningId={runningId}
          stopping={stopping}
          onStop={onStop}
        />
      ) : (
        past && <PastRunView key={past.run.id} results={past} />
      )}
    </section>
  );
}

function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => window.clearInterval(timer);
  }, [ticking]);
  return now;
}

function LiveRunView({
  live,
  frames,
  runningId,
  stopping,
  onStop,
}: Omit<LiveSectionProps, 'past'>) {
  // Until the live state knows a Run this page just started, its Lanes are blank.
  const state = runningId === null || live.run?.id === runningId ? live : emptyLiveState();
  const run = state.run;
  const running = runningId !== null;
  const ticking = LANES.some((lane) => state.lanes[lane].status === 'running');
  const now = useNow(ticking);
  const progress = runProgress(run);

  const view = (lane: LaneId): LaneView => {
    const value = state.lanes[lane];
    return {
      lane,
      status: value.status,
      reason: value.reason,
      durationMs: laneElapsedMs(value, now),
      step: value.step,
      maxSteps: value.maxSteps ?? run?.limits.maxSteps ?? null,
      screen: { kind: 'live', frames },
    };
  };

  return (
    <>
      <header className="section-head">
        <h2 id="live-title">Live</h2>
        {progress ? (
          <span className="section-meta meta-list">
            <span>
              Scenario {progress.scenarioNumber} of {progress.scenarioCount}
            </span>
            <span className="num">{progress.scenario}</span>
            {progress.attempt !== null && (
              <span>
                Attempt {progress.attempt} of {progress.attempts}
              </span>
            )}
          </span>
        ) : (
          <span className="section-meta num">Run {run?.id ?? runningId}</span>
        )}
        {running ? (
          <span className="pill running">{stopping ? 'Stopping' : 'Running'}</span>
        ) : run?.stoppedByUser ? (
          <span className="pill neutral">Stopped by user</span>
        ) : (
          <span className="pill neutral">Run ended</span>
        )}
      </header>
      <div className="lane-cols">
        <LaneColumn view={view('baseline')} />
        <div className="lane-rule" aria-hidden="true" />
        <LaneColumn view={view('webmcp')} />
      </div>
      <Scoreboard
        caption="Current Attempt"
        values={{
          baseline: laneMetrics(state.lanes.baseline, now),
          webmcp: laneMetrics(state.lanes.webmcp, now),
        }}
      />
      <div className="lane-cols">
        <MemoToolLog lane="baseline" calls={state.lanes.baseline.toolCalls} />
        <div className="lane-rule" aria-hidden="true" />
        <MemoToolLog lane="webmcp" calls={state.lanes.webmcp.toolCalls} />
      </div>
      {running && (
        <div className="actions">
          <button type="button" className="button danger" onClick={onStop} disabled={stopping}>
            <Icon name="stop" />
            {stopping ? 'Stopping' : 'Stop Run'}
          </button>
        </div>
      )}
    </>
  );
}

function PastRunView({ results }: { results: Results }) {
  const { run, summary } = results;
  const view = (lane: LaneId): LaneView => {
    const last = lastAttempt(results, lane);
    const file = lastScreenshotFile(results, lane);
    return {
      lane,
      status: last ? last.result.outcome : 'idle',
      reason: last?.result.reason ?? null,
      durationMs: last?.result.durationMs ?? 0,
      step: last?.result.steps ?? 0,
      maxSteps: run.limits.maxSteps,
      screen: { kind: 'screenshot', url: file ? screenshotUrl(run.id, lane, file) : null },
      idleLabel: 'No Attempts',
    };
  };
  const last = lastAttempt(results, 'baseline');

  return (
    <>
      <header className="section-head">
        <h2 id="live-title">Live</h2>
        <span className="section-meta meta-list">
          <span className="num">Run {run.id}</span>
          {last && (
            <span>
              Last Attempt <span className="num">{last.scenario}</span>, Attempt {last.attempt}
            </span>
          )}
        </span>
        <span className="pill neutral">Past Run</span>
      </header>
      <div className="lane-cols">
        <LaneColumn view={view('baseline')} />
        <div className="lane-rule" aria-hidden="true" />
        <LaneColumn view={view('webmcp')} />
      </div>
      <Scoreboard caption="Whole Run" values={summary} />
      <p className="live-note">
        Each screen is the Lane&apos;s last screenshot of the Run. The tool calls of each Attempt
        are in Results.
      </p>
    </>
  );
}
