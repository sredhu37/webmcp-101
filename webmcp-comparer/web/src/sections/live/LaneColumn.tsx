import { memo } from 'react';
import type { LaneId } from '../../api.ts';
import { Icon } from '../../components/Icon.tsx';
import { LaneName } from '../../components/LaneName.tsx';
import { formatDuration } from '../../metrics.ts';
import { LANE_NAMES } from '../../results/view.ts';
import { LaneScreen, type ScreenSource } from './LaneScreen.tsx';

export type LaneStatus = 'idle' | 'running' | 'pass' | 'fail';

export interface LaneView {
  lane: LaneId;
  status: LaneStatus;
  reason: string | null;
  /** The Lane's time, shown next to Pass or Fail. */
  durationMs: number;
  step: number;
  maxSteps: number | null;
  screen: ScreenSource;
  /** What the status says before the Lane has started. */
  idleLabel?: string;
}

const MemoScreen = memo(LaneScreen);

/** One Lane's column: name and status, its screen and its Step meter. */
export function LaneColumn({ view }: { view: LaneView }) {
  const { lane, status } = view;
  const ended = status === 'pass' || status === 'fail';
  return (
    <div className="lane" data-lane={lane} data-status={status}>
      <div className="lane-head">
        <LaneName lane={lane} />
        <LaneStatusPill view={view} />
      </div>
      {status === 'fail' && view.reason && (
        <p className="lane-reason" title={view.reason}>
          {view.reason}
        </p>
      )}
      <MemoScreen lane={lane} source={view.screen} ended={ended} />
      <StepMeter lane={lane} step={view.step} maxSteps={view.maxSteps} />
    </div>
  );
}

function LaneStatusPill({ view }: { view: LaneView }) {
  switch (view.status) {
    case 'idle':
      return <span className="pill neutral">{view.idleLabel ?? 'Waiting'}</span>;
    case 'running':
      return <span className="pill running">Running</span>;
    case 'pass':
    case 'fail':
      return (
        <span className={`pill ${view.status}`}>
          <Icon name={view.status === 'pass' ? 'check' : 'x'} />
          {view.status === 'pass' ? 'Pass' : 'Fail'}
          <span className="num pill-time">{formatDuration(view.durationMs)}</span>
        </span>
      );
  }
}

function StepMeter({
  lane,
  step,
  maxSteps,
}: {
  lane: LaneId;
  step: number;
  maxSteps: number | null;
}) {
  const percent = maxSteps ? Math.min(100, (step / maxSteps) * 100) : 0;
  return (
    <div className="step-meter">
      <span className="num">Step {step}</span>
      <span
        className="step-track"
        role="meter"
        aria-label={`${LANE_NAMES[lane]} Steps`}
        aria-valuemin={0}
        aria-valuemax={maxSteps ?? undefined}
        aria-valuenow={step}
      >
        <span className="step-fill" data-lane={lane} style={{ width: `${percent}%` }} />
      </span>
      <span className="num muted">{maxSteps === null ? 'no limit' : `limit ${maxSteps}`}</span>
    </div>
  );
}
