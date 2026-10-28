import { useEffect, useState } from 'react';
import { LANES, type LaneComparison, type LaneId, type MetricValues } from '../../api.ts';
import { METRICS, barPercent, metricPair } from '../../metrics.ts';
import { LANE_NAMES, rangeText } from '../../results/view.ts';

export interface PairedBarsProps {
  values: Record<LaneId, MetricValues>;
  /** A Scenario's comparison: with min and max, each value gets its range. */
  comparison?: Record<LaneId, LaneComparison> | null;
  label: string;
}

/**
 * One row per metric: a bar per Lane, scaled to the longer of the two, and the value coloured
 * lower green, higher red. The bars grow once when they first show.
 */
export function PairedBars({ values, comparison, label }: PairedBarsProps) {
  const [grown, setGrown] = useState(false);

  useEffect(() => {
    // One frame at zero width first, so the bars have somewhere to grow from.
    const frame = window.requestAnimationFrame(() => setGrown(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <dl className="bars" aria-label={label} data-grown={grown ? '' : undefined}>
      {METRICS.map((metric) => {
        const pair = metricPair(metric, values);
        return (
          <div key={metric.key} className="bar-metric" data-metric={metric.key}>
            <dt>{metric.label}</dt>
            {LANES.map((lane) => {
              const other = lane === 'baseline' ? 'webmcp' : 'baseline';
              const cell = pair[lane];
              const range = comparison ? rangeText(metric, comparison[lane]) : null;
              return (
                <dd key={lane} className="bar-row" data-lane={lane}>
                  <span className="bar-track">
                    <span
                      className="bar"
                      data-lane={lane}
                      style={{ width: `${barPercent(cell.value, pair[other].value)}%` }}
                    />
                  </span>
                  <span className="bar-value num" data-compare={cell.comparison}>
                    <span className="visually-hidden">{LANE_NAMES[lane]}: </span>
                    {cell.text}
                  </span>
                  {range && <span className="bar-range num">{range}</span>}
                </dd>
              );
            })}
          </div>
        );
      })}
    </dl>
  );
}
