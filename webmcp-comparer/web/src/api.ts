/**
 * Typed client for the app server's HTTP API (see the README "Runs" section). The types cover
 * what the UI reads; the server's own types live in server/run and cannot be imported here
 * because they pull in Node-only modules.
 */

export type Provider = 'anthropic' | 'openai';
export type LaneId = 'baseline' | 'webmcp';
export type ModelLabel = 'recommended' | 'ok' | 'not recommended';

export const LANES: readonly LaneId[] = ['baseline', 'webmcp'];

export interface Limits {
  maxSteps: number;
  maxDurationMs: number;
  maxCostUsd: number;
}

export interface Defaults {
  siteUrl: string;
  /** The sample Suite YAML. */
  suite: string;
  provider: Provider;
  model: string;
  attempts: number;
  maxAttempts: number;
  limits: Limits;
}

export interface ModelOption {
  id: string;
  provider: Provider;
  name: string;
  label: ModelLabel;
  default: boolean;
}

export interface ProviderOption {
  id: Provider;
  name: string;
  defaultModel: string;
}

export interface ModelsInfo {
  effort: string;
  providers: ProviderOption[];
  models: ModelOption[];
}

export interface KeyStatus {
  envVar: string;
  inEnv: boolean;
  inSession: boolean;
}

export type KeysInfo = Record<Provider, KeyStatus>;

export interface RunRequestBody {
  siteUrl: string;
  suite: string;
  scenarioIds: string[];
  provider: Provider;
  model: string;
  apiKey?: string;
  attempts: number;
  limits: Limits;
}

export interface StartPageTools {
  scenario: string;
  startUrl: string;
  tools: string[];
  error: string | null;
}

export interface Preflight {
  ok: boolean;
  key: { ok: boolean; source: 'request' | 'session' | 'env' | null; message: string | null };
  webmcp: StartPageTools[];
  warnings: string[];
}

export interface PassCount {
  pass: number;
  fail: number;
}

export interface RunListItem {
  id: string;
  startedAt: string;
  endedAt: string | null;
  siteUrl: string;
  provider: Provider;
  model: string;
  attempts: number;
  scenarioIds: string[];
  pass: Record<LaneId, PassCount>;
  stoppedByUser: boolean;
  running: boolean;
}

export interface RunsList {
  running: string | null;
  runs: RunListItem[];
}

export interface RunInfo {
  id: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  siteUrl: string;
  provider: Provider;
  model: string;
  attempts: number;
  limits: Limits;
  scenarioIds: string[];
  stoppedByUser: boolean;
  error: string | null;
}

/** Token buckets; `reasoning` is part of `output`, `screenshotEstimate` part of the input buckets. */
export interface Tokens {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  screenshotEstimate: number;
}

/** The metric fields shared by an Attempt, a Run summary and a Scenario comparison. */
export interface MetricValues {
  durationMs: number;
  steps: number;
  tokens: Tokens;
  /** Null when a Step could not be priced. */
  costUsd: number | null;
  toolCalls: Record<string, number>;
  toolCallsTotal: number;
  screenshots: number;
}

/** Sums over every Attempt of the Lane in the Run. */
export interface LaneSummary extends MetricValues {
  pass: number;
  fail: number;
}

export type Outcome = 'pass' | 'fail';

export interface LaneAttempt extends MetricValues {
  outcome: Outcome;
  reason: string | null;
  answer: string | null;
  webmcpTools: string[];
}

export interface AttemptRecord {
  attempt: number;
  baseline: LaneAttempt;
  webmcp: LaneAttempt;
}

/** Means over the finished Attempts; `passRate`, `min` and `max` when the Run has Attempts > 1. */
export interface LaneComparison extends MetricValues {
  attempts: number;
  pass: number;
  fail: number;
  passRate?: number;
  min?: MetricValues;
  max?: MetricValues;
  webmcpTools: string[];
}

export type ScenarioStatus = 'pending' | 'running' | 'done' | 'stopped' | 'skipped';

export interface ScenarioResult {
  id: string;
  prompt: string;
  startUrl: string;
  status: ScenarioStatus;
  comparison: Record<LaneId, LaneComparison> | null;
  attempts: AttemptRecord[];
}

/** results.json, as `GET /api/runs/:id` serves it. */
export interface Results {
  run: RunInfo;
  summary: Record<LaneId, LaneSummary>;
  scenarios: ScenarioResult[];
  suite: { source: string };
}

/** A Suite error as the server reports it, 1-based. */
export interface SuiteErrorInfo {
  message: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly errors: string[];
  readonly suiteErrors: SuiteErrorInfo[];

  constructor(status: number, body: unknown) {
    const record = isRecord(body) ? body : {};
    const message =
      typeof record.error === 'string' ? record.error : `The server answered HTTP ${status}.`;
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = Array.isArray(record.errors)
      ? record.errors.filter((e): e is string => typeof e === 'string')
      : [];
    this.suiteErrors = Array.isArray(record.suiteErrors)
      ? (record.suiteErrors as SuiteErrorInfo[])
      : [];
  }
}

async function request<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!response.ok) throw new ApiError(response.status, data);
  return data as T;
}

export const api = {
  defaults: () => request<Defaults>('GET', '/api/defaults'),
  models: () => request<ModelsInfo>('GET', '/api/models'),
  keys: () => request<KeysInfo>('GET', '/api/keys'),
  preflight: (body: RunRequestBody) => request<Preflight>('POST', '/api/preflight', body),
  startRun: (body: RunRequestBody) =>
    request<{ id: string; results: Results }>('POST', '/api/runs', body),
  runs: () => request<RunsList>('GET', '/api/runs'),
  run: (id: string) => request<Results>('GET', `/api/runs/${encodeURIComponent(id)}`),
  stopRun: (id: string) => request<unknown>('POST', `/api/runs/${encodeURIComponent(id)}/stop`),
};

export function zipUrl(id: string): string {
  return `/api/runs/${encodeURIComponent(id)}/zip`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
