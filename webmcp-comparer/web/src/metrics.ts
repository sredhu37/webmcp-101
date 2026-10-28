/**
 * The six compared metrics, their display format and the lower/higher colouring. Values are
 * compared at the precision they are shown with, so two values that read the same are neutral.
 */
import type { LaneId, MetricValues, Tokens } from './api.ts';

export type MetricKey = 'durationMs' | 'steps' | 'tokens' | 'costUsd' | 'toolCalls' | 'screenshots';

/** `lower` is shown green, `higher` red; `equal` and `none` (a value is missing) stay neutral. */
export type Comparison = 'lower' | 'higher' | 'equal' | 'none';

export interface MetricDef {
  key: MetricKey;
  label: string;
  /** The number behind the metric; null when it is unknown (an unpriced Step). */
  value: (values: MetricValues) => number | null;
  /** The value rounded to what the display shows. */
  round: (value: number) => number;
  format: (value: number) => string;
}

/** Every token the model read or wrote; reasoning is part of output, screenshots of input. */
export function totalTokens(tokens: Tokens): number {
  return tokens.input + tokens.cacheRead + tokens.cacheWrite + tokens.output;
}

const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

const roundTo = (digits: number) => (value: number) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** `12.3 s` under a minute, then `4 min 05 s`. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)} min ${String(whole % 60).padStart(2, '0')} s`;
}

/** Whole numbers as they are; means of counts with one decimal. */
export function formatCount(value: number): string {
  return oneDecimal.format(value);
}

export function formatTokens(value: number): string {
  return integer.format(value);
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

export const METRICS: readonly MetricDef[] = [
  {
    key: 'durationMs',
    label: 'Time',
    value: (v) => v.durationMs,
    round: (ms) => (ms < 60_000 ? roundTo(1)(ms / 1000) : Math.round(ms / 1000)),
    format: formatDuration,
  },
  { key: 'steps', label: 'Steps', value: (v) => v.steps, round: roundTo(1), format: formatCount },
  {
    key: 'tokens',
    label: 'Tokens',
    value: (v) => totalTokens(v.tokens),
    round: Math.round,
    format: formatTokens,
  },
  { key: 'costUsd', label: 'Cost', value: (v) => v.costUsd, round: roundTo(4), format: formatCost },
  {
    key: 'toolCalls',
    label: 'Tool calls',
    value: (v) => v.toolCallsTotal,
    round: roundTo(1),
    format: formatCount,
  },
  {
    key: 'screenshots',
    label: 'Screenshots',
    value: (v) => v.screenshots,
    round: roundTo(1),
    format: formatCount,
  },
];

/** How `mine` compares with `other`, at display precision. */
export function compareValues(
  metric: Pick<MetricDef, 'round'>,
  mine: number | null,
  other: number | null,
): Comparison {
  if (mine === null || other === null) return 'none';
  const a = metric.round(mine);
  const b = metric.round(other);
  if (a < b) return 'lower';
  if (a > b) return 'higher';
  return 'equal';
}

export function formatMetric(metric: MetricDef, value: number | null): string {
  return value === null ? 'Not priced' : metric.format(value);
}

export interface MetricCell {
  value: number | null;
  text: string;
  comparison: Comparison;
}

/** One metric for both Lanes, each with its text and its colour against the other Lane. */
export function metricPair(
  metric: MetricDef,
  values: Record<LaneId, MetricValues>,
): Record<LaneId, MetricCell> {
  const baseline = metric.value(values.baseline);
  const webmcp = metric.value(values.webmcp);
  return {
    baseline: {
      value: baseline,
      text: formatMetric(metric, baseline),
      comparison: compareValues(metric, baseline, webmcp),
    },
    webmcp: {
      value: webmcp,
      text: formatMetric(metric, webmcp),
      comparison: compareValues(metric, webmcp, baseline),
    },
  };
}

/** Bar length in percent of the longer bar of the pair; 0 for a missing or zero value. */
export function barPercent(value: number | null, other: number | null): number {
  const max = Math.max(value ?? 0, other ?? 0);
  if (!value || max <= 0) return 0;
  return (value / max) * 100;
}
