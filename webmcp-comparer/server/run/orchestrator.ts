import type { Page } from 'playwright';
import { openLaneOutput, type LaneOutput, type LogRecord } from '../agent/lane-log.ts';
import { API_KEY_ENV, EFFORT, createModelHandle, type ModelHandle } from '../agent/models.ts';
import { SYSTEM_PROMPT_VERSION } from '../agent/prompts.ts';
import { createRedactor, redactValue, type Redactor } from '../agent/redact.ts';
import { runLane, type LaneAttemptResult, type RunLaneOptions } from '../agent/run-lane.ts';
import type { LaneId } from '../lane/browser.ts';
import { errorMessage } from '../lane/tool.ts';
import { loadPriceTable, type LoadedPriceTable } from '../pricing/price-table.ts';
import type { Scenario } from '../suite/parse.ts';
import { resolveStartUrl } from '../suite/start-url.ts';
import { ApiKeys, PROVIDER_NAMES, checkKey, type KeySource } from './keys.ts';
import {
  LANES,
  compareLanes,
  laneAttempt,
  summarize,
  type LaneAttempt,
  type LaneComparison,
  type Results,
  type RunInfo,
  type ScenarioResult,
  type ScenarioStatus,
} from './results.ts';
import { createRunFolder, writeResults } from './run-folder.ts';
import type { RunRequest, RunSettings } from './settings.ts';
import {
  checkStartPageTools,
  webMcpWarnings,
  type StartPageTools,
  type WebMcpCheckOptions,
} from './webmcp-check.ts';

/** Run progress for the live view; every event is redacted and JSON-safe. */
export type RunEvent =
  | { type: 'run_start'; runId: string; run: RunInfo }
  | { type: 'scenario_start'; runId: string; scenario: string; index: number }
  | { type: 'attempt_start'; runId: string; scenario: string; attempt: number }
  /** A Lane's `log.jsonl` record, as it is written. */
  | { type: 'lane'; runId: string; record: LogRecord }
  | {
      type: 'attempt_end';
      runId: string;
      scenario: string;
      attempt: number;
      lanes: Record<LaneId, LaneAttempt>;
    }
  | {
      type: 'scenario_end';
      runId: string;
      scenario: string;
      status: ScenarioStatus;
      comparison: Record<LaneId, LaneComparison> | null;
    }
  | { type: 'scenario_skipped'; runId: string; scenario: string }
  | {
      type: 'run_end';
      runId: string;
      stoppedByUser: boolean;
      error: string | null;
      summary: Results['summary'];
    };

/** A Lane's page, handed out before its start page opens so the screencast can attach. */
export interface LanePage {
  runId: string;
  lane: LaneId;
  scenario: string;
  attempt: number;
  page: Page;
}

export interface RunListener {
  event?(event: RunEvent): void;
  /** Awaited before the Lane opens its start page; a failure here does not end the Lane. */
  page?(lanePage: LanePage): void | Promise<void>;
}

export interface ModelRequest {
  modelId: string;
  apiKey: string;
  lane: LaneId;
  scenario: string;
  attempt: number;
}

export type LaneRunner = (options: RunLaneOptions) => Promise<LaneAttemptResult>;

export type LaneRunOptions = Pick<
  RunLaneOptions,
  'browser' | 'toolTimeouts' | 'webmcpCallTimeoutMs' | 'maxRetries'
>;

export interface RunManagerOptions {
  /** Parent of the Run folders. */
  runsDir: string;
  keys: ApiKeys;
  /** HTTP client of the key check, for tests. */
  fetch?: typeof globalThis.fetch;
  keyCheckTimeoutMs?: number;
  /** Builds the model of one Lane for one Attempt. */
  createModel?: (request: ModelRequest) => ModelHandle;
  loadPriceTable?: () => Promise<LoadedPriceTable>;
  runLane?: LaneRunner;
  laneOptions?: LaneRunOptions;
  webmcpCheck?: WebMcpCheckOptions;
  now?: () => Date;
}

/** An HTTP-mappable failure to start a Run or run its checks. */
export class RunError extends Error {
  override name = 'RunError';
  readonly statusCode: 400 | 409 | 500;

  constructor(message: string, statusCode: 400 | 409 | 500) {
    super(message);
    this.statusCode = statusCode;
  }
}

export interface Preflight {
  /** False when the key check failed; WebMCP warnings never block a Run. */
  ok: boolean;
  key: { ok: boolean; source: KeySource | null; message: string | null };
  webmcp: StartPageTools[];
  warnings: string[];
}

/**
 * Runs one Run at a time: Scenarios one after another, each Attempt with both Lanes in parallel,
 * Attempts one after another. Writes `runs/<start-time>/` and tells listeners as it goes.
 */
export class RunManager {
  readonly runsDir: string;
  readonly #o: RunManagerOptions;
  readonly #listeners = new Set<RunListener>();
  #current: ActiveRun | null = null;
  #starting = false;

  constructor(options: RunManagerOptions) {
    this.#o = options;
    this.runsDir = options.runsDir;
  }

  /** The Run in progress, if any. */
  get current(): ActiveRun | null {
    return this.#current;
  }

  subscribe(listener: RunListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The pre-Run checks: the key check and the WebMCP tools on each selected start page. */
  async preflight(request: RunRequest): Promise<Preflight> {
    const { settings } = request;
    const [key, webmcp] = await Promise.all([
      this.#checkKey(settings, request.apiKey).then(
        (resolved) => ({ ok: true, source: resolved.source, message: null }),
        (error: unknown) => ({
          ok: false,
          source: this.#o.keys.resolve(settings.provider, request.apiKey)?.source ?? null,
          message: errorMessage(error),
        }),
      ),
      checkStartPageTools(settings.siteUrl, settings.scenarios, this.#o.webmcpCheck),
    ]);
    return { ok: key.ok, key, webmcp, warnings: webMcpWarnings(webmcp) };
  }

  /**
   * Checks the key, creates the Run folder and starts the Run in the background. Throws a
   * `RunError` (409) while another Run is going, or (400) when the key is missing or rejected.
   */
  async start(request: RunRequest): Promise<ActiveRun> {
    if (this.#starting || this.#current) {
      throw new RunError(
        this.#current ? `A Run is already going: ${this.#current.id}` : 'A Run is starting.',
        409,
      );
    }
    this.#starting = true;
    try {
      const { key } = await this.#checkKey(request.settings, request.apiKey);
      let priceTable: LoadedPriceTable;
      try {
        priceTable = await (this.#o.loadPriceTable ?? loadPriceTable)();
      } catch (error) {
        throw new RunError(errorMessage(error), 500);
      }
      const run = await ActiveRun.open({
        settings: request.settings,
        apiKey: key,
        priceTable,
        runsDir: this.#o.runsDir,
        redact: createRedactor([key, ...this.#o.keys.all()]),
        startedAt: (this.#o.now ?? (() => new Date()))(),
        createModel:
          this.#o.createModel ??
          ((model) => createModelHandle(model.modelId, { apiKey: model.apiKey })),
        runLane: this.#o.runLane ?? runLane,
        laneOptions: this.#o.laneOptions ?? {},
        listeners: this.#listeners,
      });
      this.#current = run;
      void run.done.finally(() => {
        if (this.#current === run) this.#current = null;
      });
      run.execute();
      return run;
    } finally {
      this.#starting = false;
    }
  }

  /** Stop Run; false when no Run with that id is going. */
  stop(id?: string): boolean {
    const run = this.#current;
    if (!run || (id !== undefined && run.id !== id)) return false;
    run.stop();
    return true;
  }

  /** Stops the Run in progress and waits for it to write its results. */
  async close(): Promise<void> {
    const run = this.#current;
    if (!run) return;
    run.stop();
    await run.done;
  }

  async #checkKey(
    settings: RunSettings,
    pasted: string | undefined,
  ): Promise<{ key: string; source: KeySource }> {
    const { provider } = settings;
    const resolved = this.#o.keys.resolve(provider, pasted);
    if (!resolved) {
      throw new RunError(
        `No ${PROVIDER_NAMES[provider]} API key: paste one or set ${API_KEY_ENV[provider]} in .env.`,
        400,
      );
    }
    const check = await checkKey(provider, resolved.key, {
      ...(this.#o.fetch ? { fetch: this.#o.fetch } : {}),
      ...(this.#o.keyCheckTimeoutMs ? { timeoutMs: this.#o.keyCheckTimeoutMs } : {}),
    });
    if (!check.ok) throw new RunError(check.message, 400);
    if (resolved.source === 'request') this.#o.keys.remember(provider, resolved.key);
    return resolved;
  }
}

interface ActiveRunOptions {
  settings: RunSettings;
  apiKey: string;
  priceTable: LoadedPriceTable;
  runsDir: string;
  redact: Redactor;
  startedAt: Date;
  createModel: (request: ModelRequest) => ModelHandle;
  runLane: LaneRunner;
  laneOptions: LaneRunOptions;
  listeners: ReadonlySet<RunListener>;
}

/** One Run in progress. */
export class ActiveRun {
  readonly id: string;
  readonly dir: string;
  readonly settings: RunSettings;
  /** Resolves with the final results once the Run has ended and written them. */
  readonly done: Promise<Results>;
  readonly #o: ActiveRunOptions;
  readonly #abort = new AbortController();
  readonly #outputs: Record<LaneId, LaneOutput>;
  readonly #results: Results;
  readonly #started = performance.now();
  #resolveDone!: (results: Results) => void;
  #ended = false;

  private constructor(id: string, dir: string, options: ActiveRunOptions) {
    this.id = id;
    this.dir = dir;
    this.settings = options.settings;
    this.#o = options;
    this.done = new Promise((resolve) => {
      this.#resolveDone = resolve;
    });
    this.#outputs = {
      baseline: openLaneOutput(dir, 'baseline', options.redact),
      webmcp: openLaneOutput(dir, 'webmcp', options.redact),
    };
    const { settings, priceTable } = options;
    const scenarios: ScenarioResult[] = settings.scenarios.map((scenario) => ({
      id: scenario.id,
      prompt: scenario.prompt,
      startUrl: resolveStartUrl(settings.siteUrl, scenario),
      status: 'pending',
      comparison: null,
      attempts: [],
    }));
    this.#results = {
      run: {
        id,
        startedAt: options.startedAt.toISOString(),
        endedAt: null,
        durationMs: null,
        siteUrl: settings.siteUrl,
        provider: settings.provider,
        model: settings.modelId,
        effort: EFFORT,
        attempts: settings.attempts,
        limits: { ...settings.limits },
        scenarioIds: settings.scenarios.map((scenario) => scenario.id),
        priceTableVersion: priceTable.version,
        priceTableOverride: priceTable.override ? [...priceTable.override.models] : null,
        systemPromptVersion: SYSTEM_PROMPT_VERSION,
        stoppedByUser: false,
        error: null,
      },
      summary: summarize(scenarios),
      scenarios,
      suite: { source: settings.suiteSource, scenarios: settings.suite.scenarios },
    };
  }

  static async open(options: ActiveRunOptions): Promise<ActiveRun> {
    const { id, dir } = await createRunFolder(options.runsDir, options.startedAt);
    const run = new ActiveRun(id, dir, options);
    await run.#save();
    return run;
  }

  /** The results so far, redacted, in the shape of results.json. */
  get results(): Results {
    return redactValue(structuredClone(this.#results), this.#o.redact);
  }

  get running(): boolean {
    return !this.#ended;
  }

  /** Stop Run: running Lanes Fail `stopped by user`, Scenarios not started are skipped. */
  stop(): void {
    if (this.#ended) return;
    this.#results.run.stoppedByUser = true;
    this.#abort.abort();
  }

  execute(): void {
    this.#emit({ type: 'run_start', runId: this.id, run: this.#results.run });
    void this.#execute();
  }

  async #execute(): Promise<void> {
    try {
      for (const [index, scenario] of this.settings.scenarios.entries()) {
        const result = this.#results.scenarios[index]!;
        if (this.#abort.signal.aborted) {
          this.#skip(result);
          continue;
        }
        await this.#runScenario(scenario, result, index);
      }
    } catch (error) {
      this.#results.run.error = errorMessage(error);
    }
    for (const result of this.#results.scenarios) {
      if (result.status === 'pending') this.#skip(result);
    }
    const { run } = this.#results;
    run.endedAt = new Date(Date.parse(run.startedAt) + this.#elapsed()).toISOString();
    run.durationMs = this.#elapsed();
    this.#ended = true;
    try {
      await this.#save();
    } catch (error) {
      run.error ??= errorMessage(error);
    }
    this.#emit({
      type: 'run_end',
      runId: this.id,
      stoppedByUser: run.stoppedByUser,
      error: run.error,
      summary: this.#results.summary,
    });
    this.#resolveDone(this.results);
  }

  async #runScenario(scenario: Scenario, result: ScenarioResult, index: number): Promise<void> {
    result.status = 'running';
    this.#emit({ type: 'scenario_start', runId: this.id, scenario: scenario.id, index });
    await this.#save();

    for (let attempt = 1; attempt <= this.settings.attempts; attempt += 1) {
      if (this.#abort.signal.aborted) break;
      this.#emit({ type: 'attempt_start', runId: this.id, scenario: scenario.id, attempt });
      const [baseline, webmcp] = await Promise.all(
        LANES.map((lane) => this.#runLane(lane, scenario, attempt)),
      );
      const record = { attempt, baseline: laneAttempt(baseline!), webmcp: laneAttempt(webmcp!) };
      result.attempts.push(record);
      result.comparison = compareLanes(result.attempts, this.settings.attempts);
      this.#results.summary = summarize(this.#results.scenarios);
      await this.#save();
      this.#emit({
        type: 'attempt_end',
        runId: this.id,
        scenario: scenario.id,
        attempt,
        lanes: { baseline: record.baseline, webmcp: record.webmcp },
      });
    }

    const stopped =
      result.attempts.length < this.settings.attempts ||
      result.attempts.some((attempt) =>
        LANES.some((lane) => attempt[lane].reason === 'stopped by user'),
      );
    result.status = result.attempts.length === 0 ? 'skipped' : stopped ? 'stopped' : 'done';
    await this.#save();
    this.#emit({
      type: 'scenario_end',
      runId: this.id,
      scenario: scenario.id,
      status: result.status,
      comparison: result.comparison,
    });
  }

  async #runLane(lane: LaneId, scenario: Scenario, attempt: number): Promise<LaneAttemptResult> {
    try {
      const model = this.#o.createModel({
        modelId: this.settings.modelId,
        apiKey: this.#o.apiKey,
        lane,
        scenario: scenario.id,
        attempt,
      });
      return await this.#o.runLane({
        ...this.#o.laneOptions,
        lane,
        scenario,
        attempt,
        siteUrl: this.settings.siteUrl,
        limits: this.settings.limits,
        model,
        priceTable: this.#o.priceTable,
        output: this.#outputs[lane],
        signal: this.#abort.signal,
        onEvent: (record) => this.#emit({ type: 'lane', runId: this.id, record }),
        onPage: (page) =>
          this.#page({ runId: this.id, lane, scenario: scenario.id, attempt, page }),
      });
    } catch (error) {
      // runLane turns every failure into an Outcome; this only guards against a bug there.
      return failedLane(
        lane,
        scenario.id,
        attempt,
        `error: ${this.#o.redact(errorMessage(error))}`,
      );
    }
  }

  #skip(result: ScenarioResult): void {
    result.status = 'skipped';
    this.#emit({ type: 'scenario_skipped', runId: this.id, scenario: result.id });
  }

  #elapsed(): number {
    return Math.round(performance.now() - this.#started);
  }

  async #save(): Promise<void> {
    await writeResults(this.dir, this.results);
  }

  #emit(event: RunEvent): void {
    const redacted = redactValue(event, this.#o.redact);
    for (const listener of this.#o.listeners) {
      try {
        listener.event?.(redacted);
      } catch {
        // A failing listener must not end the Run.
      }
    }
  }

  async #page(lanePage: LanePage): Promise<void> {
    await Promise.all(
      [...this.#o.listeners].map(async (listener) => {
        try {
          await listener.page?.(lanePage);
        } catch {
          // The live view is optional; the Lane goes on without it.
        }
      }),
    );
  }
}

function failedLane(
  lane: LaneId,
  scenario: string,
  attempt: number,
  reason: string,
): LaneAttemptResult {
  return {
    lane,
    scenario,
    attempt,
    outcome: 'fail',
    reason,
    answer: null,
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
