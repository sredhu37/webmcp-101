import { CodeText } from '../components/CodeText.tsx';
import { Icon } from '../components/Icon.tsx';
import type { SuiteCheck } from './suite.ts';

export interface SuiteStatusProps {
  suite: SuiteCheck;
  onReveal: (line: number, column: number) => void;
}

/** "Valid Suite, 4 Scenarios", or every error with its line, each jumping to the editor. */
export function SuiteStatus({ suite, onReveal }: SuiteStatusProps) {
  if (suite.ok) {
    const count = suite.scenarios.length;
    return (
      <p className="suite-status valid" role="status">
        <Icon name="check" />
        Valid Suite, {count} {count === 1 ? 'Scenario' : 'Scenarios'}
      </p>
    );
  }
  const count = suite.errors.length;
  return (
    <div className="suite-errors" role="status">
      <p className="suite-status invalid">
        <Icon name="alert" />
        {count === 1 ? '1 error in the Suite' : `${count} errors in the Suite`}
      </p>
      <ul>
        {suite.errors.map((error, index) => (
          <li key={`${error.line}:${error.column}:${index}`}>
            <button
              type="button"
              className="error-line"
              onClick={() => onReveal(error.line, error.column)}
            >
              <span className="num">Line {error.line}</span>
              <span className="error-message">
                <CodeText text={error.message} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
