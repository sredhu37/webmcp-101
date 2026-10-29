import type { LaneId, MetricValues } from '../../api.ts';
import { LaneName } from '../../components/LaneName.tsx';
import { TickValue } from '../../components/TickValue.tsx';
import { METRICS, metricPair, type Comparison } from '../../metrics.ts';

export interface ScoreboardProps {
  values: Record<LaneId, MetricValues>;
  /** What the values cover, e.g. "Current Attempt" or "Whole Run". */
  caption: string;
}

const SPOKEN: Record<Comparison, string> = {
  lower: ', lower',
  higher: ', higher',
  equal: '',
  none: '',
};

/** Both Lanes' metrics face to face; per row the lower value is green and the higher red. */
export function Scoreboard({ values, caption }: ScoreboardProps) {
  return (
    <table className="scoreboard">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">
            <LaneName lane="baseline" />
          </th>
          <th scope="col">
            <span className="visually-hidden">Metric</span>
          </th>
          <th scope="col">
            <LaneName lane="webmcp" />
          </th>
        </tr>
      </thead>
      <tbody>
        {METRICS.map((metric) => {
          const pair = metricPair(metric, values);
          const cell = (lane: LaneId) => (
            <td key={lane} className="score-value num" data-compare={pair[lane].comparison}>
              <TickValue text={pair[lane].text} tick={metric.key !== 'durationMs'} />
              <span className="visually-hidden">{SPOKEN[pair[lane].comparison]}</span>
            </td>
          );
          return (
            <tr key={metric.key} data-metric={metric.key}>
              {cell('baseline')}
              <th scope="row" className="score-label">
                {metric.label}
              </th>
              {cell('webmcp')}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
