import { LANES, zipUrl, type LaneId, type ModelsInfo, type RunListItem } from '../api.ts';
import { Icon } from '../components/Icon.tsx';
import { formatRunDate, siteLabel } from '../format.ts';

export interface PastRunsProps {
  /** Null while the first list is loading. */
  runs: RunListItem[] | null;
  error: string | null;
  models: ModelsInfo;
  open: boolean;
  onToggle: () => void;
  onOpen: (id: string) => void;
  onRetry: () => void;
  /** The Run shown in Results, highlighted in the list. */
  openedId: string | null;
  /** Opening is disabled while a Run is going, since Setup is locked. */
  busy: boolean;
}

const LANE_NAMES: Record<LaneId, string> = { baseline: 'Baseline', webmcp: 'WebMCP' };

export function PastRuns(props: PastRunsProps) {
  const { open, onToggle } = props;
  return (
    <aside className="sidebar" data-open={open || undefined} aria-label="Past Runs">
      <div className="sidebar-top">
        <button
          type="button"
          className="icon-button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls="past-runs-list"
          title={open ? 'Hide Past Runs' : 'Show Past Runs'}
        >
          <Icon name="sidebar" label={open ? 'Hide Past Runs' : 'Show Past Runs'} />
        </button>
        {open && <h2 className="sidebar-title">Past Runs</h2>}
      </div>
      <div className="sidebar-body" id="past-runs-list" hidden={!open}>
        <RunList {...props} />
      </div>
    </aside>
  );
}

function RunList({ runs, error, models, onOpen, onRetry, openedId, busy }: PastRunsProps) {
  if (error) {
    return (
      <div className="sidebar-note">
        <p>Could not load Past Runs: {error}</p>
        <button type="button" className="rail-action" onClick={onRetry}>
          <Icon name="retry" />
          Try again
        </button>
      </div>
    );
  }
  if (!runs) return <p className="sidebar-note">Loading Past Runs</p>;
  if (runs.length === 0) {
    return <p className="sidebar-note">No Runs yet. Each Run you start is listed here.</p>;
  }
  const now = new Date();
  return (
    <ol className="run-list">
      {runs.map((run) => {
        const model = models.models.find((option) => option.id === run.model);
        const state = run.running
          ? 'Running'
          : run.stoppedByUser
            ? 'Stopped'
            : run.endedAt === null
              ? 'Incomplete'
              : null;
        return (
          <li key={run.id} className="run-item" aria-current={run.id === openedId || undefined}>
            <div className="run-item-head">
              <span className="run-date">{formatRunDate(run.startedAt, now)}</span>
              {state && (
                <span className="run-state" data-state={state.toLowerCase()}>
                  {state}
                </span>
              )}
            </div>
            <p className="run-meta">
              <span className="run-site" title={run.siteUrl}>
                {siteLabel(run.siteUrl)}
              </span>
              <span className="run-model">{model?.name ?? run.model}</span>
            </p>
            <p className="run-score">
              {LANES.map((lane) => {
                const { pass, fail } = run.pass[lane];
                return (
                  <span
                    key={lane}
                    className="run-lane"
                    aria-label={`${LANE_NAMES[lane]} passed ${pass} of ${pass + fail}`}
                  >
                    <span className="swatch" data-lane={lane} aria-hidden="true" />
                    <span className="num" aria-hidden="true">
                      {pass}/{pass + fail}
                    </span>
                  </span>
                );
              })}
            </p>
            <div className="run-actions">
              <button
                type="button"
                className="rail-action"
                onClick={() => onOpen(run.id)}
                disabled={busy}
                title={busy ? 'Setup is locked while a Run is going' : undefined}
                aria-label={`Open Run ${run.id}`}
              >
                <Icon name="open" />
                Open
              </button>
              {run.running ? (
                <span
                  className="rail-action"
                  aria-disabled="true"
                  title="Available when the Run ends"
                >
                  <Icon name="download" />
                  Zip
                </span>
              ) : (
                <a
                  className="rail-action"
                  href={zipUrl(run.id)}
                  download
                  aria-label={`Download Run ${run.id} as a zip`}
                >
                  <Icon name="download" />
                  Zip
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
