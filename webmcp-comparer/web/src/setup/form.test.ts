import { describe, expect, it } from 'vitest';
import type { Results } from '../api.ts';
import { DEFAULTS, KEYS_IN_ENV, MODELS, SUITE, laneSummary } from '../testing/fixtures.ts';
import {
  formFromResults,
  initialForm,
  planRun,
  setupReducer,
  validateFields,
  type SetupForm,
} from './form.ts';

const start = (): SetupForm => initialForm(DEFAULTS);

describe('initialForm', () => {
  it('prefills from the defaults with only the first Scenario ticked', () => {
    const form = start();
    expect(form.siteUrl).toBe('http://localhost:4000');
    expect(form.suite.ok).toBe(true);
    expect(form.scenarioIds).toEqual(['first', 'second', 'third']);
    expect(form.selected).toEqual(['first']);
    expect(form.numbers).toEqual({
      attempts: '1',
      maxSteps: '50',
      maxMinutes: '5',
      maxCost: '2.00',
    });
  });
});

describe('setupReducer', () => {
  it('reports Suite errors with lines and keeps the selection while the Suite is invalid', () => {
    let form = setupReducer(start(), { type: 'selectAll' });
    form = setupReducer(form, {
      type: 'suiteEdited',
      source: `${SUITE}  - id: first\n    prompt: Again\n`,
    });

    expect(form.suite.ok).toBe(false);
    if (form.suite.ok) return;
    expect(form.suite.errors[0]?.line).toBe(9);
    expect(form.suite.errors[0]?.message).toMatch(/Duplicate/i);
    expect(form.selected).toEqual(['first', 'second', 'third']);
    expect(form.scenarioIds).toEqual(['first', 'second', 'third']);
  });

  it('reconciles the selection when an edit makes the Suite valid again', () => {
    let form = setupReducer(start(), { type: 'toggleScenario', id: 'third' });
    form = setupReducer(form, {
      type: 'suiteEdited',
      source: SUITE.replace('id: first', 'id: fir'),
    });
    expect(form.selected).toEqual(['fir', 'third']);
    expect(form.scenarios[0]).toEqual({ id: 'fir', prompt: 'Find the red shirt.' });
  });

  it('resets the selection to the first Scenario when a new Suite is uploaded', () => {
    let form = setupReducer(start(), { type: 'selectAll' });
    form = setupReducer(form, {
      type: 'suiteReplaced',
      source: 'scenarios:\n  - id: only\n    prompt: Do it.\n  - id: other\n    prompt: Or this.\n',
    });
    expect(form.scenarioIds).toEqual(['only', 'other']);
    expect(form.selected).toEqual(['only']);
  });

  it('switches to the recommended model and drops a pasted key with the provider', () => {
    let form = setupReducer(start(), { type: 'apiKey', value: 'pasted' });
    form = setupReducer(form, { type: 'provider', provider: 'openai', model: 'gpt-6-luna' });
    expect(form).toMatchObject({ provider: 'openai', model: 'gpt-6-luna', apiKey: '' });
  });

  it('selects all and none', () => {
    expect(setupReducer(start(), { type: 'selectAll' }).selected).toEqual([
      'first',
      'second',
      'third',
    ]);
    expect(setupReducer(start(), { type: 'selectNone' }).selected).toEqual([]);
  });
});

describe('validateFields', () => {
  it('accepts the defaults and converts minutes to milliseconds', () => {
    const { errors, attempts, limits } = validateFields(start(), 100);
    expect(errors).toEqual({});
    expect(attempts).toBe(1);
    expect(limits).toEqual({ maxSteps: 50, maxDurationMs: 300_000, maxCostUsd: 2 });
  });

  it('reports each bad field', () => {
    const form: SetupForm = {
      ...start(),
      siteUrl: 'ftp://example.com',
      numbers: { attempts: '0', maxSteps: '2.5', maxMinutes: '', maxCost: '-1' },
    };
    expect(Object.keys(validateFields(form, 100).errors).sort()).toEqual([
      'attempts',
      'maxCost',
      'maxMinutes',
      'maxSteps',
      'siteUrl',
    ]);
  });
});

describe('planRun', () => {
  it('builds the request for the selected Scenarios without a key when .env has one', () => {
    const form = setupReducer(start(), { type: 'toggleScenario', id: 'third' });
    const plan = planRun(
      { ...form, numbers: { ...form.numbers, attempts: '2', maxMinutes: '1.5' } },
      KEYS_IN_ENV,
      100,
    );
    expect(plan.blocker).toBeNull();
    expect(plan.label).toBe('Run 2 Scenarios, 2 Attempts each');
    expect(plan.body).toEqual({
      siteUrl: 'http://localhost:4000',
      suite: SUITE,
      scenarioIds: ['first', 'third'],
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      attempts: 2,
      limits: { maxSteps: 50, maxDurationMs: 90_000, maxCostUsd: 2 },
    });
  });

  it('sends a pasted key', () => {
    const form = setupReducer(start(), { type: 'apiKey', value: '  pasted-key  ' });
    expect(planRun(form, KEYS_IN_ENV, 100).body?.apiKey).toBe('pasted-key');
  });

  it('is blocked by an invalid Suite, an empty selection, a bad field or a missing key', () => {
    const invalid = setupReducer(start(), { type: 'suiteEdited', source: 'scenarios: 3' });
    expect(planRun(invalid, KEYS_IN_ENV, 100)).toMatchObject({
      blocker: 'Fix the Suite errors to run.',
      label: 'Run 1 Scenario',
      body: null,
    });

    const none = setupReducer(start(), { type: 'selectNone' });
    expect(planRun(none, KEYS_IN_ENV, 100).blocker).toBe('Select at least one Scenario.');

    const badSteps = setupReducer(start(), { type: 'number', field: 'maxSteps', value: 'x' });
    expect(planRun(badSteps, KEYS_IN_ENV, 100).blocker).toMatch(/Max Steps/);

    const openai = setupReducer(start(), {
      type: 'provider',
      provider: 'openai',
      model: 'gpt-6-luna',
    });
    expect(planRun(openai, KEYS_IN_ENV, 100).blocker).toBe(
      'Paste an API key, or set OPENAI_API_KEY in .env.',
    );
  });
});

describe('formFromResults', () => {
  it('loads the settings of a past Run without a key', () => {
    const results: Results = {
      run: {
        id: '2026-10-15_14-30-05',
        startedAt: '2026-10-15T12:30:05.000Z',
        endedAt: '2026-10-15T12:31:05.000Z',
        durationMs: 60_000,
        siteUrl: 'https://shop.example.com',
        provider: 'openai',
        model: 'gpt-6.1-sol',
        attempts: 3,
        limits: { maxSteps: 20, maxDurationMs: 90_000, maxCostUsd: 0.5 },
        scenarioIds: ['second', 'third'],
        stoppedByUser: false,
        error: null,
      },
      summary: { baseline: laneSummary(1, 1), webmcp: laneSummary(2, 0) },
      scenarios: [],
      suite: { source: SUITE },
    };
    expect(formFromResults(results, MODELS)).toMatchObject({
      siteUrl: 'https://shop.example.com',
      suiteSource: SUITE,
      selected: ['second', 'third'],
      provider: 'openai',
      model: 'gpt-6.1-sol',
      apiKey: '',
      numbers: { attempts: '3', maxSteps: '20', maxMinutes: '1.5', maxCost: '0.50' },
    });
  });
});
