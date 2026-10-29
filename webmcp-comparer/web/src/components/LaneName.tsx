import { LANES, type LaneId } from '../api.ts';
import { LANE_NAMES } from '../results/view.ts';

/** A Lane's colour swatch and name. */
export function LaneName({ lane }: { lane: LaneId }) {
  return (
    <span className="lane-name">
      <span className="swatch" data-lane={lane} aria-hidden="true" />
      {LANE_NAMES[lane]}
    </span>
  );
}

/** The one legend for the Lane colours. */
export function LaneLegend() {
  return (
    <div className="legend" aria-label="Lane colours">
      {LANES.map((lane) => (
        <LaneName key={lane} lane={lane} />
      ))}
    </div>
  );
}
