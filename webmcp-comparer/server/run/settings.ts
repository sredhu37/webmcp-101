import { findModel } from '../agent/models.ts';
import { DEFAULT_LIMITS, type LaneLimits } from '../agent/run-lane.ts';
import type { Provider } from '../pricing/price-table.ts';
import { parseSuite, type Scenario, type Suite, type SuiteError } from '../suite/parse.ts';
import { parseSiteUrl } from '../suite/start-url.ts';
import { PROVIDER_NAMES } from './keys.ts';

/** The prefilled Site URL: the shop in ../app (webmcp-101 monorepo). */
export const DEFAULT_SITE_URL = 'http://localhost:4000';

export const DEFAULT_ATTEMPTS = 1;
export const MAX_ATTEMPTS = 100;

/** Everything a Run needs except the key, which never leaves server memory. */
export interface RunSettings {
  siteUrl: string;
  /** The Suite YAML exactly as it was entered. */
  suiteSource: string;
  suite: Suite;
  /** The selected Scenarios, in Suite order. */
  scenarios: Scenario[];
  provider: Provider;
  modelId: string;
  attempts: number;
  limits: LaneLimits;
}

export interface RunRequest {
  settings: RunSettings;
  /** A key pasted in the UI for this request; overrides `.env`. */
  apiKey: string | undefined;
}

export type RunRequestResult =
  { ok: true; request: RunRequest } | { ok: false; errors: string[]; suiteErrors?: SuiteError[] };

/**
 * Validates the body of a start Run or pre-Run check request:
 * `{ siteUrl, suite, scenarioIds, model, provider?, apiKey?, attempts?, limits? }`.
 * `suite` is the YAML text; `limits` fields left out take the defaults.
 */
export function parseRunRequest(body: unknown): RunRequestResult {
  const errors: string[] = [];
  if (!isRecord(body)) return { ok: false, errors: ['The request body must be a JSON object.'] };

  const siteUrl = requiredString(body, 'siteUrl', errors);
  if (siteUrl !== undefined) {
    try {
      parseSiteUrl(siteUrl);
    } catch (error) {
      errors.push((error as Error).message);
    }
  }

  const modelId = requiredString(body, 'model', errors);
  const model = modelId === undefined ? undefined : findModel(modelId);
  if (modelId !== undefined && !model) errors.push(`Unknown model: ${modelId}`);
  if (body.provider !== undefined && model && body.provider !== model.provider) {
    errors.push(
      `Model ${model.id} belongs to ${PROVIDER_NAMES[model.provider]}, not ${JSON.stringify(body.provider)}.`,
    );
  }

  let apiKey: string | undefined;
  if (body.apiKey !== undefined && body.apiKey !== null) {
    if (typeof body.apiKey !== 'string') errors.push('apiKey must be a string.');
    else apiKey = body.apiKey.trim() || undefined;
  }

  const attempts = body.attempts ?? DEFAULT_ATTEMPTS;
  if (
    !Number.isInteger(attempts) ||
    (attempts as number) < 1 ||
    (attempts as number) > MAX_ATTEMPTS
  ) {
    errors.push(`attempts must be a whole number from 1 to ${MAX_ATTEMPTS}.`);
  }

  const limits = parseLimits(body.limits, errors);

  let suite: Suite | undefined;
  let suiteErrors: SuiteError[] | undefined;
  const suiteSource = requiredString(body, 'suite', errors);
  if (suiteSource !== undefined) {
    const parsed = parseSuite(suiteSource);
    if (parsed.ok) suite = parsed.suite;
    else {
      suiteErrors = parsed.errors;
      errors.push('The Suite is not valid.');
    }
  }

  let scenarios: Scenario[] = [];
  const ids = body.scenarioIds;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) {
    errors.push('scenarioIds must be a non-empty list of Scenario ids.');
  } else if (suite) {
    const known = new Set(suite.scenarios.map((scenario) => scenario.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) errors.push(`Unknown Scenario: ${unknown.join(', ')}`);
    scenarios = suite.scenarios.filter((scenario) => ids.includes(scenario.id));
  }

  if (errors.length > 0 || !suite || !model || siteUrl === undefined || suiteSource === undefined) {
    return { ok: false, errors, ...(suiteErrors ? { suiteErrors } : {}) };
  }
  return {
    ok: true,
    request: {
      settings: {
        siteUrl,
        suiteSource,
        suite,
        scenarios,
        provider: model.provider,
        modelId: model.id,
        attempts: attempts as number,
        limits,
      },
      apiKey,
    },
  };
}

const LIMIT_FIELDS = {
  maxSteps: { integer: true },
  maxDurationMs: { integer: true },
  maxCostUsd: { integer: false },
} as const satisfies Record<keyof LaneLimits, { integer: boolean }>;

function parseLimits(value: unknown, errors: string[]): LaneLimits {
  const limits = { ...DEFAULT_LIMITS };
  if (value === undefined || value === null) return limits;
  if (!isRecord(value)) {
    errors.push('limits must be an object.');
    return limits;
  }
  for (const [field, rule] of Object.entries(LIMIT_FIELDS) as [
    keyof LaneLimits,
    { integer: boolean },
  ][]) {
    const raw = value[field];
    if (raw === undefined) continue;
    const valid =
      typeof raw === 'number' &&
      Number.isFinite(raw) &&
      raw > 0 &&
      (!rule.integer || Number.isInteger(raw));
    if (valid) limits[field] = raw;
    else errors.push(`limits.${field} must be a positive ${rule.integer ? 'whole ' : ''}number.`);
  }
  const unknown = Object.keys(value).filter((key) => !(key in LIMIT_FIELDS));
  if (unknown.length > 0) errors.push(`Unknown limit: ${unknown.join(', ')}`);
  return limits;
}

function requiredString(
  body: Record<string, unknown>,
  field: string,
  errors: string[],
): string | undefined {
  const value = body[field];
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${field} is required.`);
    return undefined;
  }
  return field === 'suite' ? value : value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
