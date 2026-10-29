import type { NormalizedUsage } from '../pricing/usage.ts';

export interface AttemptTokens {
  /** Uncached input. */
  input: number;
  cacheRead: number;
  cacheWrite: number;
  /** All output, reasoning included. */
  output: number;
  /** Of `output`, the tokens spent on reasoning. */
  reasoning: number;
  /** Estimated input tokens of the screenshots the agent took; part of the input buckets. */
  screenshotEstimate: number;
}

/** Metrics of one Lane in one Attempt, recorded whatever the Outcome. */
export interface AttemptMetrics {
  durationMs: number;
  /** Model calls made. */
  steps: number;
  tokens: AttemptTokens;
  /** Approximate USD at full precision; null when a Step could not be priced. */
  costUsd: number | null;
  /** Tool calls by the name the model used; `finish` is not a tool call. */
  toolCalls: Record<string, number>;
  toolCallsTotal: number;
  screenshots: number;
  /** WebMCP tools the agent called, in first-use order. */
  webmcpTools: string[];
}

export class MetricsCounter {
  readonly #started: number;
  #steps = 0;
  #tokens: AttemptTokens = {
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    reasoning: 0,
    screenshotEstimate: 0,
  };
  #pricedCostUsd = 0;
  #unpricedSteps = 0;
  #toolCalls: Record<string, number> = {};
  #toolCallsTotal = 0;
  #screenshots = 0;
  #webmcpTools: string[] = [];
  #endedMs: number | null = null;

  constructor(started: number = performance.now()) {
    this.#started = started;
  }

  get steps(): number {
    return this.#steps;
  }

  /** Cost of the Steps that could be priced, for the cost limit. */
  get pricedCostUsd(): number {
    return this.#pricedCostUsd;
  }

  elapsedMs(): number {
    return this.#endedMs ?? performance.now() - this.#started;
  }

  addStep(usage: NormalizedUsage | null, costUsd: number | null): void {
    this.#steps += 1;
    if (usage) {
      this.#tokens.input += usage.input;
      this.#tokens.cacheRead += usage.cacheRead;
      this.#tokens.cacheWrite += usage.cacheWrite;
      this.#tokens.output += usage.output;
      this.#tokens.reasoning += usage.reasoning;
    }
    if (costUsd === null) {
      if (usage) this.#unpricedSteps += 1;
    } else {
      this.#pricedCostUsd += costUsd;
    }
  }

  addToolCall(name: string, webmcp: boolean): void {
    this.#toolCalls[name] = (this.#toolCalls[name] ?? 0) + 1;
    this.#toolCallsTotal += 1;
    if (webmcp && !this.#webmcpTools.includes(name)) this.#webmcpTools.push(name);
  }

  addScreenshot(estimatedTokens: number | null): void {
    this.#screenshots += 1;
    this.#tokens.screenshotEstimate += estimatedTokens ?? 0;
  }

  end(): void {
    this.#endedMs ??= performance.now() - this.#started;
  }

  snapshot(): AttemptMetrics {
    return {
      durationMs: Math.round(this.elapsedMs()),
      steps: this.#steps,
      tokens: { ...this.#tokens },
      costUsd: this.#unpricedSteps > 0 ? null : this.#pricedCostUsd,
      toolCalls: { ...this.#toolCalls },
      toolCallsTotal: this.#toolCallsTotal,
      screenshots: this.#screenshots,
      webmcpTools: [...this.#webmcpTools],
    };
  }
}
