/**
 * The live view wire format of `GET /api/live` (WebSocket), shared by the server and web/.
 *
 * - Binary message: one screencast frame, `1 byte Lane id` + JPEG bytes (see `LANE_BYTE`).
 * - Text message: one JSON `LiveMessage`.
 *
 * On connect the server sends a `snapshot` (the current Run state), then the last frame of each
 * Lane it has. After that it sends every change as it happens. `applyLiveMessage` turns the
 * messages into the same `LiveState` on both sides.
 *
 * This file has no imports on purpose: Node (server) and the browser bundle (web/) both compile it.
 */

export type LiveLaneId = 'baseline' | 'webmcp';

export const LIVE_LANES: readonly LiveLaneId[] = ['baseline', 'webmcp'];

export const LIVE_PATH = '/api/live';

/** First byte of a binary frame message. */
export const LANE_BYTE: Readonly<Record<LiveLaneId, number>> = { baseline: 0, webmcp: 1 };

/** Frames per second per Lane, at most. */
export const LIVE_MAX_FPS = 10;

/** Tool results in live tool calls are cut to this many characters (the log keeps 2,000). */
export const LIVE_RESULT_LIMIT = 300;

export interface LiveTokens {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  screenshotEstimate: number;
}

/** Running totals of a Lane in the current Attempt, the scoreboard values. */
export interface LiveTotals {
  durationMs: number;
  steps: number;
  tokens: LiveTokens;
  costUsd: number | null;
  toolCalls: Record<string, number>;
  toolCallsTotal: number;
  screenshots: number;
  webmcpTools: string[];
}

export interface LiveToolCall {
  /** ISO time the call finished. */
  t: string;
  scenario: string;
  attempt: number;
  step: number;
  id: string;
  /** The name the model used. */
  name: string;
  /** `webmcp` for the site's WebMCP tools, null for unknown tools. */
  source: 'browser' | 'webmcp' | null;
  /** The site's tool name when the model saw it renamed. */
  webmcpName: string | null;
  input: unknown;
  isError: boolean;
  /** The result text, cut to `LIVE_RESULT_LIMIT` characters. */
  result: string;
  /** File name of the agent screenshot this call took. */
  screenshot: string | null;
  durationMs: number;
}

export type LiveLaneStatus = 'idle' | 'running' | 'pass' | 'fail';

export interface LiveLane {
  lane: LiveLaneId;
  /** `running` from Lane start, then `pass` / `fail` until the next Attempt starts. */
  status: LiveLaneStatus;
  scenario: string | null;
  attempt: number | null;
  /** ISO times, so the UI can tick the clock while the Lane runs. */
  startedAt: string | null;
  endedAt: string | null;
  /** The Step limit, for the Step meter. */
  maxSteps: number | null;
  /** Model calls made so far in this Attempt. */
  step: number;
  totals: LiveTotals;
  /** Fail reason, once the Lane has ended. */
  reason: string | null;
  answer: string | null;
  /** Every tool call of the Run in this Lane, oldest first. */
  toolCalls: LiveToolCall[];
  /** URL of the last agent screenshot of the Run, under `/api/runs/...`. */
  lastScreenshot: string | null;
}

export type LiveScenarioStatus = 'pending' | 'running' | 'done' | 'stopped' | 'skipped';

export interface LiveRun {
  id: string;
  startedAt: string;
  endedAt: string | null;
  siteUrl: string;
  provider: string;
  model: string;
  attempts: number;
  limits: { maxSteps: number; maxDurationMs: number; maxCostUsd: number };
  scenarios: { id: string; status: LiveScenarioStatus }[];
  /** The Scenario and Attempt going on; null before the first and after the Run. */
  current: { scenario: string; attempt: number | null } | null;
  running: boolean;
  stoppedByUser: boolean;
  error: string | null;
}

export interface LiveState {
  /** The Run going on, or the last one since the server started; null before any Run. */
  run: LiveRun | null;
  lanes: Record<LiveLaneId, LiveLane>;
}

export type LiveMessage =
  /** The whole state, first message on every connection. */
  | { type: 'snapshot'; state: LiveState }
  /** The Run changed: started, next Scenario or Attempt, Scenario ended or skipped, Run ended. */
  | { type: 'run'; run: LiveRun }
  | {
      type: 'lane_start';
      lane: LiveLaneId;
      t: string;
      scenario: string;
      attempt: number;
      maxSteps: number | null;
    }
  /** One model call ended. */
  | {
      type: 'step';
      lane: LiveLaneId;
      t: string;
      step: number;
      durationMs: number;
      totals: LiveTotals;
    }
  /** One tool call ended, sent as it happens; its screenshot, if any, is in `call.screenshot`. */
  | { type: 'tool_call'; lane: LiveLaneId; call: LiveToolCall; totals: LiveTotals }
  /** The Lane ended its Attempt. */
  | {
      type: 'outcome';
      lane: LiveLaneId;
      t: string;
      scenario: string;
      attempt: number;
      outcome: 'pass' | 'fail';
      reason: string | null;
      answer: string | null;
      totals: LiveTotals;
    };

export type LiveMessageType = LiveMessage['type'];

const MESSAGE_TYPES: ReadonlySet<string> = new Set<LiveMessageType>([
  'snapshot',
  'run',
  'lane_start',
  'step',
  'tool_call',
  'outcome',
]);

export function emptyTotals(): LiveTotals {
  return {
    durationMs: 0,
    steps: 0,
    tokens: {
      input: 0,
      cacheRead: 0,
      cacheWrite: 0,
      output: 0,
      reasoning: 0,
      screenshotEstimate: 0,
    },
    costUsd: 0,
    toolCalls: {},
    toolCallsTotal: 0,
    screenshots: 0,
    webmcpTools: [],
  };
}

export function emptyLane(lane: LiveLaneId): LiveLane {
  return {
    lane,
    status: 'idle',
    scenario: null,
    attempt: null,
    startedAt: null,
    endedAt: null,
    maxSteps: null,
    step: 0,
    totals: emptyTotals(),
    reason: null,
    answer: null,
    toolCalls: [],
    lastScreenshot: null,
  };
}

export function emptyLiveState(): LiveState {
  return { run: null, lanes: { baseline: emptyLane('baseline'), webmcp: emptyLane('webmcp') } };
}

/** The URL of one agent screenshot, served by `GET /api/runs/:id/:lane/screenshots/:file`. */
export function screenshotUrl(runId: string, lane: LiveLaneId, file: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/${lane}/screenshots/${encodeURIComponent(file)}`;
}

/** The state after one message; never changes `state`. */
export function applyLiveMessage(state: LiveState, message: LiveMessage): LiveState {
  switch (message.type) {
    case 'snapshot':
      return message.state;
    case 'run':
      // A new Run starts with fresh Lanes.
      return message.run.id === state.run?.id
        ? { ...state, run: message.run }
        : { run: message.run, lanes: emptyLiveState().lanes };
    case 'lane_start':
      return withLane(state, message.lane, (lane) => ({
        ...emptyLane(message.lane),
        status: 'running',
        scenario: message.scenario,
        attempt: message.attempt,
        startedAt: message.t,
        maxSteps: message.maxSteps,
        toolCalls: lane.toolCalls,
        lastScreenshot: lane.lastScreenshot,
      }));
    case 'step':
      return withLane(state, message.lane, (lane) => ({
        ...lane,
        step: message.step,
        totals: message.totals,
      }));
    case 'tool_call': {
      const { call } = message;
      const runId = state.run?.id;
      return withLane(state, message.lane, (lane) => ({
        ...lane,
        totals: message.totals,
        toolCalls: [...lane.toolCalls, call],
        lastScreenshot:
          call.screenshot && runId
            ? screenshotUrl(runId, message.lane, call.screenshot)
            : lane.lastScreenshot,
      }));
    }
    case 'outcome':
      return withLane(state, message.lane, (lane) => ({
        ...lane,
        status: message.outcome,
        scenario: message.scenario,
        attempt: message.attempt,
        endedAt: message.t,
        step: message.totals.steps,
        totals: message.totals,
        reason: message.reason,
        answer: message.answer,
      }));
  }
}

function withLane(
  state: LiveState,
  lane: LiveLaneId,
  update: (lane: LiveLane) => LiveLane,
): LiveState {
  return { ...state, lanes: { ...state.lanes, [lane]: update(state.lanes[lane]) } };
}

/** One binary frame message: the Lane byte, then the JPEG. */
export function encodeFrame(lane: LiveLaneId, jpeg: Uint8Array): Uint8Array {
  const message = new Uint8Array(jpeg.byteLength + 1);
  message[0] = LANE_BYTE[lane];
  message.set(jpeg, 1);
  return message;
}

/** The Lane and JPEG of a binary frame message; null when it is not one. */
export function decodeFrame(
  data: ArrayBuffer | Uint8Array,
): { lane: LiveLaneId; jpeg: Uint8Array } | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < 2) return null;
  const lane = LIVE_LANES.find((id) => LANE_BYTE[id] === bytes[0]);
  if (!lane) return null;
  return { lane, jpeg: bytes.subarray(1) };
}

/** A text message as a `LiveMessage`; null when it is not JSON or has an unknown type. */
export function parseLiveMessage(text: string): LiveMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || !('type' in value)) return null;
  return typeof value.type === 'string' && MESSAGE_TYPES.has(value.type)
    ? (value as LiveMessage)
    : null;
}
