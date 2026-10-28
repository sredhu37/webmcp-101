import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../agent/run-lane.ts';
import { fixtureSuiteFile } from '../testing/fixture-site.ts';
import { parseRunRequest } from './settings.ts';

const suite = readFileSync(fixtureSuiteFile, 'utf8');

const valid = {
  siteUrl: 'http://localhost:4000',
  suite,
  scenarioIds: ['finish-watering', 'first-open-todo'],
  model: 'claude-haiku-5-5',
};

describe('parseRunRequest', () => {
  it('fills the defaults and keeps the selected Scenarios in Suite order', () => {
    const parsed = parseRunRequest(valid);
    if (!parsed.ok) throw new Error(parsed.errors.join(' '));
    const { settings, apiKey } = parsed.request;

    expect(apiKey).toBeUndefined();
    expect(settings).toMatchObject({
      siteUrl: 'http://localhost:4000',
      suiteSource: suite,
      provider: 'anthropic',
      modelId: 'claude-haiku-5-5',
      attempts: 1,
      limits: DEFAULT_LIMITS,
    });
    expect(settings.scenarios.map((s) => s.id)).toEqual(['first-open-todo', 'finish-watering']);
    expect(settings.suite.scenarios).toHaveLength(4);
  });

  it('takes attempts, partial limits and a pasted key', () => {
    const parsed = parseRunRequest({
      ...valid,
      provider: 'openai',
      model: 'gpt-6-luna',
      apiKey: '  sk-test-key  ',
      attempts: 3,
      limits: { maxSteps: 10, maxCostUsd: 0.5 },
    });
    if (!parsed.ok) throw new Error(parsed.errors.join(' '));
    expect(parsed.request.apiKey).toBe('sk-test-key');
    expect(parsed.request.settings).toMatchObject({
      provider: 'openai',
      attempts: 3,
      limits: { maxSteps: 10, maxDurationMs: DEFAULT_LIMITS.maxDurationMs, maxCostUsd: 0.5 },
    });
  });

  it('treats an empty pasted key as none', () => {
    const parsed = parseRunRequest({ ...valid, apiKey: '   ' });
    expect(parsed.ok && parsed.request.apiKey).toBeUndefined();
  });

  it('reports every problem at once', () => {
    const parsed = parseRunRequest({
      siteUrl: 'ftp://example.com',
      suite,
      scenarioIds: ['nope'],
      model: 'gpt-4o',
      attempts: 0,
      limits: { maxSteps: 2.5, maxDurationMs: -1, speed: 3 },
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toEqual([
      'Site URL must start with http:// or https://: ftp://example.com',
      'Unknown model: gpt-4o',
      'attempts must be a whole number from 1 to 100.',
      'limits.maxSteps must be a positive whole number.',
      'limits.maxDurationMs must be a positive whole number.',
      'Unknown limit: speed',
      'Unknown Scenario: nope',
    ]);
  });

  it('rejects a provider that does not match the model', () => {
    const parsed = parseRunRequest({ ...valid, provider: 'openai' });
    expect(!parsed.ok && parsed.errors).toEqual([
      'Model claude-haiku-5-5 belongs to Anthropic, not "openai".',
    ]);
  });

  it('returns the Suite errors with their lines', () => {
    const parsed = parseRunRequest({ ...valid, suite: 'scenarios:\n  - id: a\n' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toContain('The Suite is not valid.');
    expect(parsed.suiteErrors?.[0]).toMatchObject({ line: 2 });
  });

  it('requires the fields and an object body', () => {
    expect(parseRunRequest(null)).toEqual({
      ok: false,
      errors: ['The request body must be a JSON object.'],
    });
    const parsed = parseRunRequest({});
    expect(!parsed.ok && parsed.errors).toEqual([
      'siteUrl is required.',
      'model is required.',
      'suite is required.',
      'scenarioIds must be a non-empty list of Scenario ids.',
    ]);
  });
});
