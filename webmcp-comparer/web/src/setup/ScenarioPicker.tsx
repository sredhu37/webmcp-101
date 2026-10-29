import type { Dispatch } from 'react';
import type { SetupAction, SetupForm } from './form.ts';

export interface ScenarioPickerProps {
  form: SetupForm;
  dispatch: Dispatch<SetupAction>;
}

/** Scenario checkboxes in Suite order, with Select all / Select none. */
export function ScenarioPicker({ form, dispatch }: ScenarioPickerProps) {
  const { scenarios, selected } = form;
  const stale = !form.suite.ok && scenarios.length > 0;
  const all = scenarios.length > 0 && selected.length === scenarios.length;

  return (
    <fieldset className="field scenarios" aria-describedby="scenarios-count">
      <legend className="field-label-row">
        <span className="field-label">Scenarios</span>
        <span className="field-aside">
          <button
            type="button"
            className="link-button"
            onClick={() => dispatch({ type: 'selectAll' })}
            disabled={all}
          >
            Select all
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() => dispatch({ type: 'selectNone' })}
            disabled={selected.length === 0}
          >
            Select none
          </button>
        </span>
      </legend>
      {scenarios.length === 0 ? (
        <p className="scenario-empty">Scenarios appear here once the Suite is valid.</p>
      ) : (
        <ul className="scenario-list" data-stale={stale || undefined}>
          {scenarios.map((scenario) => (
            <li key={scenario.id}>
              <label className="scenario">
                <input
                  type="checkbox"
                  checked={selected.includes(scenario.id)}
                  onChange={() => dispatch({ type: 'toggleScenario', id: scenario.id })}
                />
                <span className="scenario-text">
                  <span className="scenario-id">{scenario.id}</span>
                  <span className="scenario-prompt">{scenario.prompt}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="field-hint" id="scenarios-count">
        {stale
          ? 'Showing the last valid Suite until the errors are fixed.'
          : `${selected.length} of ${scenarios.length} selected`}
      </p>
    </fieldset>
  );
}
