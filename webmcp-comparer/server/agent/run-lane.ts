import { streamText, type ModelMessage, type ToolResultPart } from 'ai';
import type { Page } from 'playwright';
import {
  BROWSER_TOOL_NAMES,
  FINISH_TOOL_NAME,
  createBrowserTools,
  type BrowserToolTimeouts,
} from '../lane/browser-tools.ts';
import { launchLaneBrowser, type LaneBrowserOptions, type LaneId } from '../lane/browser.ts';
import { errorMessage, errorResult, type LaneTool, type ToolResult } from '../lane/tool.ts';
import { WebMcpTools, type WebMcpRefresh } from '../lane/webmcp-adapter.ts';
import { computeCost } from '../pricing/cost.ts';
import { estimateScreenshotTokens } from '../pricing/images.ts';
import type { PriceTable } from '../pricing/price-table.ts';
import { normalizeUsage, type NormalizedUsage } from '../pricing/usage.ts';
import { decideFinish, describeCheck, type FinishReport } from '../suite/checks.ts';
import type { Scenario } from '../suite/parse.ts';
import { resolveStartUrl } from '../suite/start-url.ts';
import { cutForLog, type LaneOutput, type LogEventName, type LogRecord } from './lane-log.ts';
import { MetricsCounter, type AttemptMetrics } from './metrics.ts';
import { redactValue } from './redact.ts';
import { EFFORT, EFFORT_PROVIDER_OPTIONS, type ModelHandle } from './models.ts';
import { REMINDER, SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION, userMessage } from './prompts.ts';
import { ToolNameMap } from './tool-names.ts';
import { modelToolSet, parseFinishInput, resultText, toModelOutput } from './tool-set.ts';

export interface LaneLimits {
  /** Model calls per Attempt. */
  maxSteps: number;
  maxDurationMs: number;
  maxCostUsd: number;
}

export const DEFAULT_LIMITS: LaneLimits = {
  maxSteps: 50,
  maxDurationMs: 5 * 60_000,
  maxCostUsd: 2,
};

export type Outcome = 'pass' | 'fail';

export interface LaneAttemptResult extends AttemptMetrics {
  lane: LaneId;
  scenario: string;
  attempt: number;
  outcome: Outcome;
  /** Fail reason from spec section 5; null on Pass. */
  reason: string | null;
  /** The `finish` answer, when the agent called it. */
  answer: string | null;
}

export interface RunLaneOptions {
  lane: LaneId;
  scenario: Scenario;
  attempt: number;
  siteUrl: string;
  limits: LaneLimits;
  model: ModelHandle;
  priceTable: PriceTable;
  /** The Lane's log and screenshots folder for the whole Run. */
  output: LaneOutput;
  /** Aborted by Stop Run. */
  signal?: AbortSignal;
  /** Every log record, after redaction, as it is written. */
  onEvent?: (record: LogRecord) => void;
  /** Called once the Lane's page exists, before the start page opens (for the live view). */
  onPage?: (page: Page) => void | Promise<void>;
  browser?: LaneBrowserOptions;
  toolTimeouts?: Partial<BrowserToolTimeouts>;
  webmcpCallTimeoutMs?: number;
  /** Retries of a failed model call inside one Step. */
  maxRetries?: number;
}

const START_PAGE_TIMEOUT_MS = 15_000;

/** Ends the Attempt with a Fail reason from inside the loop. */
class LaneFail extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

interface StepResult {
  toolCalls: ModelToolCall[];
  messages: ModelMessage[];
}

interface ModelToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
  invalid?: boolean;
  error?: unknown;
}

/**
 * Runs one Lane for one Attempt of a Scenario: opens the start page in a fresh Chromium, loops
 * Steps until `finish`, a limit, Stop Run or an error, and returns the Outcome with its metrics.
 */
export async function runLane(options: RunLaneOptions): Promise<LaneAttemptResult> {
  return new LaneAttempt(options).run();
}

class LaneAttempt {
  readonly #o: RunLaneOptions;
  readonly #metrics = new MetricsCounter();
  readonly #timeLimit = new AbortController();
  readonly #abort: AbortSignal;
  #answer: string | null = null;

  constructor(options: RunLaneOptions) {
    this.#o = options;
    this.#abort = options.signal
      ? AbortSignal.any([options.signal, this.#timeLimit.signal])
      : this.#timeLimit.signal;
  }

  async run(): Promise<LaneAttemptResult> {
    const { lane, scenario, limits, model } = this.#o;
    const timer = setTimeout(() => this.#timeLimit.abort(), limits.maxDurationMs);
    let outcome: { outcome: Outcome; reason: string | null };
    let close: (() => Promise<void>) | undefined;

    try {
      const startUrl = resolveStartUrl(this.#o.siteUrl, scenario);
      this.#log('lane_start', {
        startUrl,
        prompt: scenario.prompt,
        provider: model.provider,
        model: model.modelId,
        effort: EFFORT,
        systemPromptVersion: SYSTEM_PROMPT_VERSION,
        limits,
      });
      this.#throwIfInterrupted();
      const laneBrowser = await launchLaneBrowser(lane, this.#o.browser);
      close = () => laneBrowser.close();
      const { page } = laneBrowser;
      await this.#o.onPage?.(page);
      await page.goto(startUrl, { timeout: START_PAGE_TIMEOUT_MS });
      outcome = await this.#loop(page, startUrl);
    } catch (error) {
      outcome = { outcome: 'fail', reason: this.#failReason(error) };
      if (outcome.reason?.startsWith('error: ')) {
        this.#log('error', { message: outcome.reason.slice('error: '.length) });
      }
    } finally {
      clearTimeout(timer);
    }
    this.#metrics.end();
    await close?.().catch(() => undefined);

    const fields = redactValue(
      { ...outcome, answer: this.#answer, ...this.#metrics.snapshot() },
      this.#o.output.log.redact,
    );
    this.#log('lane_end', fields);
    return { lane, scenario: scenario.id, attempt: this.#o.attempt, ...fields };
  }

  async #loop(page: Page, startUrl: string): Promise<{ outcome: Outcome; reason: string | null }> {
    const { lane, scenario, attempt, output, limits } = this.#o;
    const browserTools = createBrowserTools({
      page,
      screenshots: output.screenshots,
      scenarioId: scenario.id,
      attempt,
      ...(this.#o.toolTimeouts ? { timeouts: this.#o.toolTimeouts } : {}),
    });
    const webmcp =
      lane === 'webmcp'
        ? new WebMcpTools(page, {
            ...(this.#o.webmcpCallTimeoutMs ? { callTimeoutMs: this.#o.webmcpCallTimeoutMs } : {}),
          })
        : null;
    const names = new ToolNameMap([...BROWSER_TOOL_NAMES, FINISH_TOOL_NAME]);
    const messages: ModelMessage[] = [
      { role: 'user', content: userMessage(scenario.prompt, startUrl) },
    ];
    let reminded = false;

    for (;;) {
      this.#throwIfInterrupted();
      if (this.#metrics.steps >= limits.maxSteps) throw new LaneFail('step limit');

      const tools: LaneTool[] = webmcp
        ? [...browserTools, ...(await this.#refreshWebMcp(page, webmcp, names))]
        : browserTools;
      const step = await this.#modelCall(messages, tools, names);
      messages.push(...step.messages);

      if (step.toolCalls.length === 0) {
        if (reminded) throw new LaneFail('did not call finish');
        reminded = true;
        this.#log('reminder', { step: this.#metrics.steps, text: REMINDER });
        messages.push({ role: 'user', content: REMINDER });
      } else {
        const { results, finish } = await this.#runToolCalls(step.toolCalls, tools, names);
        if (finish) return this.#finish(page, finish);
        messages.push({ role: 'tool', content: results });
      }

      this.#throwIfInterrupted();
      if (this.#metrics.pricedCostUsd >= limits.maxCostUsd) throw new LaneFail('cost limit');
    }
  }

  async #refreshWebMcp(page: Page, webmcp: WebMcpTools, names: ToolNameMap): Promise<LaneTool[]> {
    let refresh: WebMcpRefresh;
    try {
      refresh = await webmcp.refresh();
    } catch (error) {
      if (page.isClosed()) throw error;
      await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined);
      refresh = await webmcp.refresh();
    }
    const renamed = names.add(refresh.tools.map((tool) => tool.name));
    if (refresh.change) {
      const modelNames = (list: string[]): string[] => list.map((name) => names.modelName(name));
      this.#log('webmcp_tools_changed', {
        step: this.#metrics.steps + 1,
        added: modelNames(refresh.change.added),
        removed: modelNames(refresh.change.removed),
        changed: modelNames(refresh.change.changed),
        tools: refresh.tools.map((tool) => names.modelName(tool.name)),
        renamed: renamed.length > 0 ? renamed : undefined,
      });
    }
    return refresh.tools;
  }

  async #modelCall(
    messages: ModelMessage[],
    tools: LaneTool[],
    names: ToolNameMap,
  ): Promise<StepResult> {
    const { model, priceTable } = this.#o;
    const started = performance.now();
    let streamError: unknown;
    const stream = streamText({
      model: model.model,
      instructions: SYSTEM_PROMPT,
      messages,
      tools: modelToolSet(tools, names),
      providerOptions: EFFORT_PROVIDER_OPTIONS[model.provider],
      abortSignal: this.#abort,
      ...(this.#o.maxRetries === undefined ? {} : { maxRetries: this.#o.maxRetries }),
      onError: ({ error }) => {
        streamError ??= error;
      },
    });

    let usage: NormalizedUsage | null = null;
    let costUsd: number | null = null;
    let step: StepResult | null = null;
    let finishReason: string | undefined;
    let text = '';
    let reasoning: string | undefined;
    try {
      for await (const part of stream.fullStream) {
        if (part.type === 'error') streamError ??= part.error;
      }
      const metadata = await stream.providerMetadata;
      const serviceTier = metadata?.openai?.serviceTier;
      usage = normalizeUsage(model.provider, await stream.usage, {
        serviceTier: typeof serviceTier === 'string' ? serviceTier : null,
      });
      const cost = computeCost(priceTable, model.modelId, usage);
      costUsd = cost.costUsd;
      finishReason = await stream.finishReason;
      text = await stream.text;
      reasoning = await stream.reasoningText;
      const toolCalls = (await stream.toolCalls) as ModelToolCall[];
      const responseMessages = await stream.responseMessages;
      step = {
        toolCalls,
        messages: responseMessages.filter((message) => message.role === 'assistant'),
      };
    } catch (error) {
      streamError ??= error;
    }

    this.#metrics.addStep(hasTokens(usage) ? usage : null, hasTokens(usage) ? costUsd : null);
    const interrupted = this.#abort.aborted;
    const error = streamError !== undefined && !interrupted ? errorMessage(streamError) : undefined;
    this.#log('model_call', {
      step: this.#metrics.steps,
      durationMs: Math.round(performance.now() - started),
      finishReason: interrupted ? 'aborted' : finishReason,
      text,
      reasoning: reasoning || undefined,
      toolCalls: step?.toolCalls.map((call) => ({
        id: call.toolCallId,
        name: call.toolName,
        input: call.input,
      })),
      usage: usage ? usageFields(usage) : undefined,
      costUsd,
      error,
      totals: this.#metrics.snapshot(),
    });

    this.#throwIfInterrupted();
    if (streamError !== undefined) throw new Error(errorMessage(streamError));
    if (!step) throw new Error('model call failed');
    return step;
  }

  async #runToolCalls(
    calls: ModelToolCall[],
    tools: LaneTool[],
    names: ToolNameMap,
  ): Promise<{ results: ToolResultPart[]; finish: FinishReport | null }> {
    const byName = new Map(tools.map((tool) => [names.modelName(tool.name), tool]));
    const results: ToolResultPart[] = [];
    const step = this.#metrics.steps;

    for (const call of calls) {
      this.#throwIfInterrupted();
      const reply = (result: Pick<ToolResult, 'isError' | 'content'>): void => {
        results.push({
          type: 'tool-result',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: toModelOutput(result),
        });
      };

      if (call.toolName === FINISH_TOOL_NAME && !call.invalid) {
        const finish = parseFinishInput(call.input);
        if (typeof finish !== 'string') return { results, finish };
        this.#log('finish', { step, input: call.input, error: finish });
        reply(errorResult(finish));
        continue;
      }

      const tool = call.invalid ? undefined : byName.get(call.toolName);
      const started = performance.now();
      const result = tool
        ? await tool.execute(call.input)
        : errorResult(
            call.error === undefined
              ? `Unknown tool ${call.toolName}.`
              : errorMessage(call.error).replace(/^AI_\w+: /, ''),
          );
      const durationMs = Math.round(performance.now() - started);

      this.#metrics.addToolCall(call.toolName, tool?.source === 'webmcp');
      const screenshot = result.meta.screenshot;
      if (screenshot) {
        this.#metrics.addScreenshot(
          estimateScreenshotTokens(
            this.#o.priceTable,
            this.#o.model.modelId,
            screenshot.width,
            screenshot.height,
          ),
        );
      }
      this.#log('tool_call', {
        step,
        id: call.toolCallId,
        name: call.toolName,
        source: tool?.source,
        webmcpName: result.meta.webmcpName,
        input: call.input,
        target: result.meta.target,
        isError: result.isError,
        webmcpFailure: result.meta.webmcpFailure,
        result: cutForLog(resultText(result)),
        screenshot: screenshot?.fileName,
        durationMs,
        totals: this.#metrics.snapshot(),
      });
      reply(result);
    }
    return { results, finish: null };
  }

  async #finish(
    page: Page,
    finish: FinishReport,
  ): Promise<{ outcome: Outcome; reason: string | null }> {
    this.#answer = finish.answer;
    this.#log('finish', {
      step: this.#metrics.steps,
      success: finish.success,
      answer: finish.answer,
    });
    const decision = await decideFinish(page, finish, this.#o.scenario.success);
    for (const check of decision.checks) {
      this.#log('check', {
        check: describeCheck(check.check),
        pass: check.pass,
        detail: check.detail,
      });
    }
    return decision.pass
      ? { outcome: 'pass', reason: null }
      : { outcome: 'fail', reason: decision.reason };
  }

  #throwIfInterrupted(): void {
    const reason = this.#interruption();
    if (reason) throw new LaneFail(reason);
  }

  /** Stop Run wins over the time limit; both win over anything that failed because of them. */
  #interruption(): string | null {
    if (this.#o.signal?.aborted) return 'stopped by user';
    if (
      this.#timeLimit.signal.aborted ||
      this.#metrics.elapsedMs() >= this.#o.limits.maxDurationMs
    ) {
      return 'time limit';
    }
    return null;
  }

  #failReason(error: unknown): string {
    if (error instanceof LaneFail) return error.reason;
    return this.#interruption() ?? `error: ${errorMessage(error)}`;
  }

  #log(event: LogEventName, fields: Record<string, unknown>): void {
    const record = this.#o.output.log.write(this.#o.scenario.id, this.#o.attempt, event, fields);
    try {
      this.#o.onEvent?.(record);
    } catch {
      // A failing listener must not end the Lane.
    }
  }
}

function hasTokens(usage: NormalizedUsage | null): usage is NormalizedUsage {
  return usage !== null && usage.totalInput + usage.output > 0;
}

function usageFields(usage: NormalizedUsage): Record<string, unknown> {
  return {
    input: usage.input,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    cacheWrite1h: usage.cacheWrite1h,
    output: usage.output,
    reasoning: usage.reasoning,
    serviceTier: usage.serviceTier,
    speed: usage.speed,
    inferenceGeo: usage.inferenceGeo,
    raw: usage.raw,
  };
}
