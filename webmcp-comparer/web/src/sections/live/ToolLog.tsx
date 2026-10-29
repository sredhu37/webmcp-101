import { useState } from 'react';
import type { LaneId } from '../../api.ts';
import type { LiveToolCall } from '../../live/client.ts';
import { formatToolInput } from '../../live/view.ts';
import { LANE_NAMES } from '../../results/view.ts';

export interface ToolLogProps {
  lane: LaneId;
  /** Every tool call of the Run in this Lane, oldest first. */
  calls: readonly LiveToolCall[];
}

interface Group {
  key: string;
  scenario: string;
  attempt: number;
  /** Positions in `calls`, newest first. */
  indexes: number[];
}

/** Consecutive calls of one Scenario Attempt, newest group first. */
function groupCalls(calls: readonly LiveToolCall[]): Group[] {
  const groups: Group[] = [];
  calls.forEach((call, index) => {
    const last = groups.at(-1);
    if (last && last.scenario === call.scenario && last.attempt === call.attempt) {
      last.indexes.unshift(index);
    } else {
      groups.push({
        key: `${index}`,
        scenario: call.scenario,
        attempt: call.attempt,
        indexes: [index],
      });
    }
  });
  return groups.reverse();
}

/**
 * The Lane's tool-call log, newest first, WebMCP tools marked. Calls that arrive after the log
 * first rendered slide in; the ones it opened with stand still.
 */
export function ToolLog({ lane, calls }: ToolLogProps) {
  const [initialCount] = useState(calls.length);
  const groups = groupCalls(calls);
  const showGroups = groups.length > 1;

  return (
    <div
      className="tool-log"
      aria-label={`${LANE_NAMES[lane]} tool calls, newest first`}
      role="log"
    >
      {calls.length === 0 ? (
        <p className="tool-log-empty">No tool calls yet</p>
      ) : (
        <ol>
          {groups.map((group) => (
            <li key={group.key} className="tool-group">
              {showGroups && (
                <p className="tool-group-head">
                  <span className="num">{group.scenario}</span>, Attempt {group.attempt}
                </p>
              )}
              <ol>
                {group.indexes.map((index) => {
                  const call = calls[index];
                  if (!call) return null;
                  return <ToolRow key={index} call={call} entering={index >= initialCount} />;
                })}
              </ol>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ToolRow({ call, entering }: { call: LiveToolCall; entering: boolean }) {
  const input = formatToolInput(call.input);
  const webmcp = call.source === 'webmcp';
  const detail = [`${call.name}(${input})`, call.result].filter(Boolean).join('\n');
  return (
    <li
      className="tool-row"
      data-source={call.source ?? 'unknown'}
      data-error={call.isError ? '' : undefined}
      data-enter={entering ? '' : undefined}
      title={detail}
    >
      <span className="tool-step">Step {call.step}</span>
      <span className="tool-call">
        <span className="tool-name">{call.name}</span>
        {webmcp && <span className="tool-tag">WebMCP</span>}
        <span className="tool-input">({input})</span>
      </span>
      {call.isError && <span className="tool-error">Error</span>}
    </li>
  );
}
