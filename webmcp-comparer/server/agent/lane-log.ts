import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { LaneId } from '../lane/browser.ts';
import { ScreenshotFiles } from '../lane/screenshots.ts';
import { redactValue, type Redactor } from './redact.ts';

export const LOG_EVENTS = [
  'lane_start',
  'model_call',
  'tool_call',
  'webmcp_tools_changed',
  'reminder',
  'finish',
  'check',
  'lane_end',
  'error',
] as const;

export type LogEventName = (typeof LOG_EVENTS)[number];

/** One line of `log.jsonl`. */
export interface LogRecord {
  /** ISO timestamp with milliseconds. */
  t: string;
  lane: LaneId;
  scenario: string;
  attempt: number;
  event: LogEventName;
  [field: string]: unknown;
}

/** Tool results are cut to this many characters in the log. */
export const LOG_RESULT_LIMIT = 2_000;

export function cutForLog(text: string, limit: number = LOG_RESULT_LIMIT): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}... (cut, ${text.length} chars)`;
}

/**
 * The `log.jsonl` of one Lane in a Run, shared by all its Scenarios and Attempts. Every record
 * passes the redaction step before it is written or handed to listeners.
 */
export class LaneLog {
  readonly path: string;
  readonly lane: LaneId;
  /** The redaction step, for anything else the Lane hands out. */
  readonly redact: Redactor;

  constructor(path: string, lane: LaneId, redact: Redactor) {
    this.path = path;
    this.lane = lane;
    this.redact = redact;
  }

  write(
    scenario: string,
    attempt: number,
    event: LogEventName,
    fields: Record<string, unknown> = {},
  ): LogRecord {
    const record = redactValue<LogRecord>(
      {
        t: new Date().toISOString(),
        lane: this.lane,
        scenario,
        attempt,
        event,
        ...withoutUndefined(fields),
      },
      this.redact,
    );
    appendFileSync(this.path, `${JSON.stringify(record)}\n`);
    return record;
  }
}

/** Where one Lane of a Run writes: `<runDir>/<lane>/log.jsonl` and `<runDir>/<lane>/screenshots/`. */
export interface LaneOutput {
  dir: string;
  log: LaneLog;
  screenshots: ScreenshotFiles;
}

export function openLaneOutput(runDir: string, lane: LaneId, redact: Redactor): LaneOutput {
  const dir = join(runDir, lane);
  mkdirSync(dir, { recursive: true });
  return {
    dir,
    log: new LaneLog(join(dir, 'log.jsonl'), lane, redact),
    screenshots: new ScreenshotFiles(join(dir, 'screenshots')),
  };
}

function withoutUndefined(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}
