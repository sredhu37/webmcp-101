/** Shared test data shaped like the app server's answers. */
import type {
  Defaults,
  KeysInfo,
  LaneAttempt,
  LaneSummary,
  MetricValues,
  ModelsInfo,
  Results,
} from '../api.ts';

export const SUITE = `scenarios:
  - id: first
    prompt: Find the red shirt.
  - id: second
    prompt: Add it to the cart.
  - id: third
    path: /checkout
    prompt: Check out.
`;

export const DEFAULTS: Defaults = {
  siteUrl: 'http://localhost:4000',
  suite: SUITE,
  provider: 'anthropic',
  model: 'claude-haiku-5-5',
  attempts: 1,
  maxAttempts: 100,
  limits: { maxSteps: 50, maxDurationMs: 300_000, maxCostUsd: 2 },
};

export const MODELS: ModelsInfo = {
  effort: 'medium',
  providers: [
    { id: 'anthropic', name: 'Anthropic', defaultModel: 'claude-haiku-5-5' },
    { id: 'openai', name: 'OpenAI', defaultModel: 'gpt-6-luna' },
  ],
  models: [
    {
      id: 'claude-haiku-5-5',
      provider: 'anthropic',
      name: 'Haiku 5.5',
      label: 'recommended',
      default: true,
    },
    {
      id: 'claude-sonnet-5-5',
      provider: 'anthropic',
      name: 'Sonnet 5.5',
      label: 'ok',
      default: false,
    },
    {
      id: 'claude-opus-5-5',
      provider: 'anthropic',
      name: 'Opus 5.5',
      label: 'not recommended',
      default: false,
    },
    {
      id: 'gpt-6-luna',
      provider: 'openai',
      name: 'gpt-6-luna',
      label: 'recommended',
      default: true,
    },
    { id: 'gpt-6.1-sol', provider: 'openai', name: 'gpt-6.1-sol', label: 'ok', default: false },
    {
      id: 'gpt-5.6-sol',
      provider: 'openai',
      name: 'gpt-5.6-sol',
      label: 'not recommended',
      default: false,
    },
  ],
};

export const KEYS_IN_ENV: KeysInfo = {
  anthropic: { envVar: 'ANTHROPIC_API_KEY', inEnv: true, inSession: false },
  openai: { envVar: 'OPENAI_API_KEY', inEnv: false, inSession: false },
};

export function metrics(values: Partial<MetricValues> = {}): MetricValues {
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
    ...values,
  };
}

export function laneSummary(
  pass: number,
  fail: number,
  values: Partial<MetricValues> = {},
): LaneSummary {
  return { pass, fail, ...metrics(values) };
}

export function laneAttempt(
  outcome: 'pass' | 'fail',
  values: Partial<LaneAttempt> = {},
): LaneAttempt {
  return { outcome, reason: null, answer: null, webmcpTools: [], ...metrics(values), ...values };
}

const tokens = (input: number, output: number) => ({
  input,
  cacheRead: 0,
  cacheWrite: 0,
  output,
  reasoning: 0,
  screenshotEstimate: 0,
});

/** A finished Run of two Scenarios with one Attempt each: WebMCP passes both, Baseline one. */
export const RESULTS: Results = {
  run: {
    id: '2026-10-16_10-00-00',
    startedAt: '2026-10-16T08:00:00.000Z',
    endedAt: '2026-10-16T08:01:00.000Z',
    durationMs: 60_000,
    siteUrl: 'http://localhost:4000',
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    attempts: 1,
    limits: { maxSteps: 50, maxDurationMs: 300_000, maxCostUsd: 2 },
    scenarioIds: ['first', 'second'],
    stoppedByUser: false,
    error: null,
  },
  summary: {
    baseline: laneSummary(1, 1, {
      durationMs: 21_400,
      steps: 9,
      tokens: tokens(40_000, 900),
      costUsd: 0.0157,
      toolCalls: { screenshot: 3, click: 4 },
      toolCallsTotal: 7,
      screenshots: 3,
    }),
    webmcp: laneSummary(2, 0, {
      durationMs: 5_300,
      steps: 4,
      tokens: tokens(9_000, 400),
      costUsd: 0.0023,
      toolCalls: { search_products: 1, add_to_cart: 1 },
      toolCallsTotal: 2,
      screenshots: 0,
    }),
  },
  scenarios: [
    {
      id: 'first',
      prompt: 'Find the red shirt.',
      startUrl: 'http://localhost:4000/',
      status: 'done',
      comparison: null,
      attempts: [
        {
          attempt: 1,
          baseline: laneAttempt('fail', {
            reason: 'check failed: answerContains "19.99"',
            durationMs: 11_000,
            steps: 5,
            toolCalls: { screenshot: 2, click: 2 },
            toolCallsTotal: 4,
            screenshots: 2,
          }),
          webmcp: laneAttempt('pass', {
            durationMs: 2_400,
            steps: 2,
            toolCalls: { search_products: 1 },
            toolCallsTotal: 1,
            webmcpTools: ['search_products'],
          }),
        },
      ],
    },
    {
      id: 'second',
      prompt: 'Add it to the cart.',
      startUrl: 'http://localhost:4000/',
      status: 'done',
      comparison: null,
      attempts: [
        {
          attempt: 1,
          baseline: laneAttempt('pass', {
            durationMs: 10_400,
            steps: 4,
            toolCalls: { screenshot: 1, click: 2 },
            toolCallsTotal: 3,
            screenshots: 1,
          }),
          webmcp: laneAttempt('pass', {
            durationMs: 2_900,
            steps: 2,
            toolCalls: { add_to_cart: 1 },
            toolCallsTotal: 1,
            webmcpTools: ['add_to_cart'],
          }),
        },
      ],
    },
  ],
  suite: { source: SUITE },
};

// The comparison of a one-Attempt Scenario holds that Attempt's values.
for (const scenario of RESULTS.scenarios) {
  const record = scenario.attempts[0];
  if (!record) continue;
  scenario.comparison = {
    baseline: {
      attempts: 1,
      pass: record.baseline.outcome === 'pass' ? 1 : 0,
      fail: record.baseline.outcome === 'fail' ? 1 : 0,
      ...record.baseline,
    },
    webmcp: {
      attempts: 1,
      pass: record.webmcp.outcome === 'pass' ? 1 : 0,
      fail: record.webmcp.outcome === 'fail' ? 1 : 0,
      ...record.webmcp,
    },
  };
}
