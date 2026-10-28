import { useEffect, useRef } from 'react';
import { LANES, type ModelsInfo, type Results } from '../api.ts';
import { LaneLegend } from '../components/LaneName.tsx';
import { formatRunDate, scrollToSection, siteLabel } from '../format.ts';
import { LANE_NAMES } from '../results/view.ts';
import { PairedBars } from './results/PairedBars.tsx';
import { ScenarioRow } from './results/ScenarioRow.tsx';

export interface ResultsSectionProps {
  results: Results | null;
  models: ModelsInfo;
}

/**
 * The Results section: one Lane legend, the Run summary (pass counts and paired bars per
 * metric), then every Scenario collapsed to its verdicts.
 */
export function ResultsSection({ results, models }: ResultsSectionProps) {
  const section = useRef<HTMLElement>(null);
  const id = results?.run.id ?? null;

  useEffect(() => {
    if (id) scrollToSection(section.current);
  }, [id]);

  if (!results) return null;
  const { run, summary, scenarios } = results;
  const model = models.models.find((option) => option.id === run.model);
  return (
    <section className="section" aria-labelledby="results-title" id="results" ref={section}>
      <header className="section-head">
        <h2 id="results-title">Results</h2>
        <span className="section-meta">
          {formatRunDate(run.startedAt)}, {siteLabel(run.siteUrl)}, {model?.name ?? run.model}
          {run.attempts > 1 && `, ${run.attempts} Attempts each`}
        </span>
      </header>
      <LaneLegend />

      <div className="results-block" key={run.id}>
        <div className="summary-head">
          <h3>Run summary</h3>
          {LANES.map((lane) => {
            const { pass, fail } = summary[lane];
            const total = pass + fail;
            const tone = total === 0 ? 'neutral' : fail === 0 ? 'pass' : 'fail';
            return (
              <span key={lane} className={`pill ${tone}`}>
                {LANE_NAMES[lane]} passed{' '}
                <span className="num">
                  {pass}/{total}
                </span>
              </span>
            );
          })}
          {run.stoppedByUser && <span className="pill neutral">Stopped by user</span>}
          {run.endedAt === null && <span className="pill neutral">Incomplete</span>}
          {run.error && <span className="pill fail">{run.error}</span>}
        </div>
        <PairedBars values={summary} label="Run summary, totals over every Attempt" />
      </div>

      <div className="results-block">
        <div className="summary-head">
          <h3>Scenarios</h3>
          <span className="section-meta">
            {scenarios.length} {scenarios.length === 1 ? 'Scenario' : 'Scenarios'}
          </span>
        </div>
        {scenarios.length === 0 ? (
          <p className="scenario-empty">This Run has no Scenario results.</p>
        ) : (
          <ul className="scenario-rows" key={run.id}>
            {scenarios.map((scenario) => (
              <ScenarioRow key={scenario.id} scenario={scenario} runAttempts={run.attempts} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
