import type {
  Defaults,
  KeysInfo,
  Limits,
  ModelsInfo,
  Provider,
  Results,
  RunRequestBody,
} from '../api.ts';
import {
  initialSelection,
  reconcileSelection,
  runButtonLabel,
  selectionFrom,
  toggle,
} from './selection.ts';
import { checkSuite, siteUrlError, type ScenarioSummary, type SuiteCheck } from './suite.ts';

/** The number inputs, kept as typed so a half-typed value is not rewritten under the cursor. */
export type NumberField = 'attempts' | 'maxSteps' | 'maxMinutes' | 'maxCost';

export interface SetupForm {
  siteUrl: string;
  suiteSource: string;
  /** Counts Suite replacements (upload, Open); typing in the editor leaves it unchanged. */
  suiteRevision: number;
  suite: SuiteCheck;
  /** The Scenarios of the last valid Suite; kept while the Suite is being edited. */
  scenarios: ScenarioSummary[];
  scenarioIds: string[];
  selected: string[];
  provider: Provider;
  model: string;
  /** A key pasted for this Run; empty means `.env` or the key kept for the session. */
  apiKey: string;
  numbers: Record<NumberField, string>;
}

export type SetupAction =
  | { type: 'siteUrl'; value: string }
  | { type: 'suiteEdited'; source: string }
  | { type: 'suiteReplaced'; source: string }
  | { type: 'toggleScenario'; id: string }
  | { type: 'selectAll' }
  | { type: 'selectNone' }
  | { type: 'provider'; provider: Provider; model: string }
  | { type: 'model'; model: string }
  | { type: 'apiKey'; value: string }
  | { type: 'number'; field: NumberField; value: string }
  | { type: 'load'; form: SetupForm };

export function setupReducer(form: SetupForm, action: SetupAction): SetupForm {
  switch (action.type) {
    case 'siteUrl':
      return { ...form, siteUrl: action.value };
    case 'suiteEdited': {
      const suite = checkSuite(action.source);
      if (!suite.ok) return { ...form, suiteSource: action.source, suite };
      const ids = suite.scenarios.map((scenario) => scenario.id);
      return {
        ...form,
        suiteSource: action.source,
        suite,
        scenarios: suite.scenarios,
        scenarioIds: ids,
        selected: reconcileSelection(form.scenarioIds, form.selected, ids),
      };
    }
    case 'suiteReplaced':
      return { ...form, ...suiteForm(action.source), suiteRevision: form.suiteRevision + 1 };
    case 'toggleScenario':
      return { ...form, selected: toggle(form.scenarioIds, form.selected, action.id) };
    case 'selectAll':
      return { ...form, selected: [...form.scenarioIds] };
    case 'selectNone':
      return { ...form, selected: [] };
    case 'provider':
      // A pasted key belongs to one provider, so switching drops it.
      return { ...form, provider: action.provider, model: action.model, apiKey: '' };
    case 'model':
      return { ...form, model: action.model };
    case 'apiKey':
      return { ...form, apiKey: action.value };
    case 'number':
      return { ...form, numbers: { ...form.numbers, [action.field]: action.value } };
    case 'load':
      return { ...action.form, suiteRevision: form.suiteRevision + 1 };
  }
}

type SuiteFields = Pick<
  SetupForm,
  'suiteSource' | 'suite' | 'scenarios' | 'scenarioIds' | 'selected'
>;

function suiteForm(source: string, wanted?: readonly string[]): SuiteFields {
  const suite = checkSuite(source);
  const scenarios = suite.ok ? suite.scenarios : [];
  const ids = scenarios.map((scenario) => scenario.id);
  return {
    suiteSource: source,
    suite,
    scenarios,
    scenarioIds: ids,
    selected: wanted ? selectionFrom(ids, wanted) : initialSelection(ids),
  };
}

/** The Setup a fresh page starts with. */
export function initialForm(defaults: Defaults): SetupForm {
  return {
    siteUrl: defaults.siteUrl,
    ...suiteForm(defaults.suite),
    suiteRevision: 0,
    provider: defaults.provider,
    model: defaults.model,
    apiKey: '',
    numbers: numberFields(defaults.attempts, defaults.limits),
  };
}

/** The Setup of a past Run: its settings and Suite, never a key. Load it with `load`. */
export function formFromResults(results: Results, models: ModelsInfo): SetupForm {
  const { run } = results;
  const model = models.models.find((option) => option.id === run.model);
  const provider = model?.provider ?? run.provider;
  return {
    siteUrl: run.siteUrl,
    ...suiteForm(results.suite.source, run.scenarioIds),
    suiteRevision: 0,
    provider,
    model: model?.id ?? defaultModelOf(models, provider),
    apiKey: '',
    numbers: numberFields(run.attempts, run.limits),
  };
}

export function defaultModelOf(models: ModelsInfo, provider: Provider): string {
  const info = models.providers.find((option) => option.id === provider);
  return info?.defaultModel ?? models.models.find((m) => m.provider === provider)?.id ?? '';
}

function numberFields(attempts: number, limits: Limits): Record<NumberField, string> {
  return {
    attempts: String(attempts),
    maxSteps: String(limits.maxSteps),
    maxMinutes: trimNumber(limits.maxDurationMs / 60_000),
    maxCost: limits.maxCostUsd.toFixed(2),
  };
}

function trimNumber(value: number): string {
  return String(Number(value.toFixed(2)));
}

export type FieldErrors = Partial<Record<NumberField | 'siteUrl', string>>;

export interface Validated {
  errors: FieldErrors;
  attempts: number;
  limits: Limits;
}

/** Checks the Site URL and the number inputs; the same bounds the server enforces. */
export function validateFields(form: SetupForm, maxAttempts: number): Validated {
  const errors: FieldErrors = {};
  const siteUrl = siteUrlError(form.siteUrl);
  if (siteUrl) errors.siteUrl = siteUrl;

  const attempts = parseNumber(form.numbers.attempts);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > maxAttempts) {
    errors.attempts = `Repeat must be a whole number from 1 to ${maxAttempts}.`;
  }
  const maxSteps = parseNumber(form.numbers.maxSteps);
  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    errors.maxSteps = 'Max Steps must be a whole number above 0.';
  }
  const minutes = parseNumber(form.numbers.maxMinutes);
  if (!(minutes > 0)) errors.maxMinutes = 'Max minutes must be a number above 0.';
  const cost = parseNumber(form.numbers.maxCost);
  if (!(cost > 0)) errors.maxCost = 'Max cost must be an amount above 0.';

  return {
    errors,
    attempts,
    limits: {
      maxSteps,
      maxDurationMs: Math.max(1, Math.round(minutes * 60_000)),
      maxCostUsd: cost,
    },
  };
}

function parseNumber(text: string): number {
  const trimmed = text.trim().replace(/^\$/, '');
  return trimmed === '' ? Number.NaN : Number(trimmed);
}

/** Whether a key is available for the provider without pasting one. */
export function hasStoredKey(keys: KeysInfo, provider: Provider): boolean {
  const status = keys[provider];
  return status.inEnv || status.inSession;
}

export interface RunPlan {
  /** Why the Run button is disabled, or null when it can start. */
  blocker: string | null;
  label: string;
  body: RunRequestBody | null;
}

/** Everything the Run button needs: its label, whether it can run, and the request. */
export function planRun(form: SetupForm, keys: KeysInfo, maxAttempts: number): RunPlan {
  const { errors, attempts, limits } = validateFields(form, maxAttempts);
  const label = runButtonLabel(form.selected.length, Number.isInteger(attempts) ? attempts : 1);
  const blocker = !form.suite.ok
    ? 'Fix the Suite errors to run.'
    : form.selected.length === 0
      ? 'Select at least one Scenario.'
      : (Object.values(errors)[0] ??
        (form.apiKey.trim() === '' && !hasStoredKey(keys, form.provider)
          ? `Paste an API key, or set ${keys[form.provider].envVar} in .env.`
          : null));
  if (blocker) return { blocker, label, body: null };

  const apiKey = form.apiKey.trim();
  return {
    blocker: null,
    label,
    body: {
      siteUrl: form.siteUrl.trim(),
      suite: form.suiteSource,
      scenarioIds: form.selected,
      provider: form.provider,
      model: form.model,
      ...(apiKey ? { apiKey } : {}),
      attempts,
      limits,
    },
  };
}
