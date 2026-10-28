import { useId, useState } from 'react';
import { LANES, type LaneAttempt, type LaneId, type ScenarioResult } from '../../api.ts';
import { Icon } from '../../components/Icon.tsx';
import { LaneName } from '../../components/LaneName.tsx';
import { formatPassRate, scenarioHeadline, toolCallList } from '../../results/view.ts';
import { PairedBars } from './PairedBars.tsx';

export interface ScenarioRowProps {
  scenario: ScenarioResult;
  /** The Run's Attempts setting; above 1 the row shows averages, ranges and pass rates. */
  runAttempts: number;
}

/** One Scenario, collapsed to its verdicts; expanding shows its bars and tool calls per Attempt. */
export function ScenarioRow({ scenario, runAttempts }: ScenarioRowProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const { comparison } = scenario;
  const repeated = runAttempts > 1;

  return (
    <li className="scenario-row" data-open={open ? '' : undefined}>
      <button
        type="button"
        className="scenario-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
      >
        <span className="scenario-chevron">
          <Icon name="chevron" />
        </span>
        <span className="scenario-name num">{scenario.id}</span>
        {LANES.map((lane) => {
          const headline = scenarioHeadline(scenario, lane, runAttempts);
          return (
            <span key={lane} className="scenario-verdict" data-lane={lane}>
              <LaneName lane={lane} />
              <span className={`pill ${headline.tone}`}>
                {headline.tone !== 'neutral' && (
                  <Icon name={headline.tone === 'pass' ? 'check' : 'x'} />
                )}
                {headline.label}
              </span>
              {headline.reason && (
                <span className="scenario-reason" title={headline.reason}>
                  {headline.reason}
                </span>
              )}
            </span>
          );
        })}
      </button>
      {open && (
        <div className="scenario-body" id={bodyId}>
          <p className="scenario-prompt">{scenario.prompt}</p>
          {comparison ? (
            <>
              {repeated && (
                <p className="scenario-note">
                  Averages over {comparison.baseline.attempts}{' '}
                  {comparison.baseline.attempts === 1 ? 'Attempt' : 'Attempts'}, with the lowest and
                  highest value under each. Pass rate:{' '}
                  {LANES.map((lane, index) => (
                    <span key={lane}>
                      {index > 0 && ', '}
                      <LaneName lane={lane} />{' '}
                      <span className="num">{formatPassRate(comparison[lane].passRate ?? 0)}</span>
                    </span>
                  ))}
                </p>
              )}
              <PairedBars
                values={comparison}
                comparison={repeated ? comparison : null}
                label={`${scenario.id} metrics`}
              />
              <AttemptTable scenario={scenario} />
            </>
          ) : (
            <p className="scenario-note">No Attempt of this Scenario finished.</p>
          )}
        </div>
      )}
    </li>
  );
}

function AttemptTable({ scenario }: { scenario: ScenarioResult }) {
  return (
    <table className="attempt-table">
      <caption>Tool calls per Attempt</caption>
      <thead>
        <tr>
          <th scope="col">Attempt</th>
          {LANES.map((lane) => (
            <th key={lane} scope="col">
              <LaneName lane={lane} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {scenario.attempts.map((record) => (
          <tr key={record.attempt}>
            <th scope="row" className="num">
              {record.attempt}
            </th>
            {LANES.map((lane) => (
              <AttemptCell key={lane} lane={lane} result={record[lane]} />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AttemptCell({ lane, result }: { lane: LaneId; result: LaneAttempt }) {
  const calls = toolCallList(result.toolCalls);
  const webmcp = new Set(result.webmcpTools);
  return (
    <td data-lane={lane}>
      <span className={`outcome-mark ${result.outcome}`}>
        <Icon name={result.outcome === 'pass' ? 'check' : 'x'} />
        {result.outcome === 'pass' ? 'Pass' : 'Fail'}
      </span>
      {result.reason && <span className="attempt-reason">{result.reason}</span>}
      {calls.length === 0 ? (
        <span className="muted"> No tool calls</span>
      ) : (
        <ul className="call-counts">
          {calls.map((call) => (
            <li key={call.name} data-source={webmcp.has(call.name) ? 'webmcp' : 'browser'}>
              <span className="num">{call.name}</span>{' '}
              <span className="num muted">{call.count}</span>
            </li>
          ))}
        </ul>
      )}
    </td>
  );
}
