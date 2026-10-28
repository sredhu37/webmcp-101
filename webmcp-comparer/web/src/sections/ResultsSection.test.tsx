// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { Results } from '../api.ts';
import { MODELS, RESULTS, laneAttempt, metrics } from '../testing/fixtures.ts';
import { ResultsSection } from './ResultsSection.tsx';

afterEach(cleanup);

const scenarioRows = () => [...document.querySelectorAll<HTMLElement>('.scenario-row')];

/** RESULTS with 3 Attempts of `first`: averages, min/max and pass rates. */
function repeated(): Results {
  const results = structuredClone(RESULTS);
  results.run.attempts = 3;
  results.scenarios = results.scenarios.slice(0, 1);
  const [first] = results.scenarios;
  if (!first) throw new Error('fixture');
  first.attempts = [1, 2, 3].map((attempt) => ({
    attempt,
    baseline: laneAttempt(attempt === 2 ? 'fail' : 'pass', {
      reason: attempt === 2 ? 'step limit reached' : null,
      durationMs: attempt * 1000,
      steps: attempt + 3,
      toolCalls: { click: attempt },
      toolCallsTotal: attempt,
    }),
    webmcp: laneAttempt('pass', {
      durationMs: 1_000,
      steps: 2,
      toolCalls: { search_products: 1 },
      toolCallsTotal: 1,
      webmcpTools: ['search_products'],
    }),
  }));
  first.comparison = {
    baseline: {
      ...metrics({ durationMs: 2_000, steps: 5, toolCallsTotal: 2 }),
      attempts: 3,
      pass: 2,
      fail: 1,
      passRate: 2 / 3,
      min: metrics({ durationMs: 1_000, steps: 4, toolCallsTotal: 1 }),
      max: metrics({ durationMs: 3_000, steps: 6, toolCallsTotal: 3 }),
      webmcpTools: [],
    },
    webmcp: {
      ...metrics({ durationMs: 1_000, steps: 2, toolCallsTotal: 1 }),
      attempts: 3,
      pass: 3,
      fail: 0,
      passRate: 1,
      min: metrics({ durationMs: 1_000, steps: 2, toolCallsTotal: 1 }),
      max: metrics({ durationMs: 1_000, steps: 2, toolCallsTotal: 1 }),
      webmcpTools: ['search_products'],
    },
  };
  return results;
}

describe('ResultsSection', () => {
  it('has one Lane legend and no colour legend', () => {
    render(<ResultsSection results={RESULTS} models={MODELS} />);
    const legends = screen.getAllByLabelText('Lane colours');
    expect(legends).toHaveLength(1);
    expect(legends[0]?.textContent).toBe('BaselineWebMCP');
    const text = document.querySelector('#results')?.textContent ?? '';
    expect(text).not.toMatch(/green|red|lower is better/i);
  });

  it('summarises the Run: pass counts and paired bars per metric, coloured', () => {
    render(<ResultsSection results={RESULTS} models={MODELS} />);
    const head = screen.getByRole('heading', { name: 'Run summary' }).parentElement;
    expect(head?.textContent).toContain('Baseline passed 1/2');
    expect(head?.textContent).toContain('WebMCP passed 2/2');
    expect(head?.querySelector('.pill.fail')?.textContent).toBe('Baseline passed 1/2');
    expect(head?.querySelector('.pill.pass')?.textContent).toBe('WebMCP passed 2/2');

    const summary = screen.getByLabelText('Run summary, totals over every Attempt');
    const metric = (key: string) =>
      [...summary.querySelectorAll(`[data-metric="${key}"] .bar-value`)].map((value) => [
        value.textContent,
        value.getAttribute('data-compare'),
      ]);
    expect(metric('durationMs')).toEqual([
      ['Baseline: 21.4 s', 'higher'],
      ['WebMCP: 5.3 s', 'lower'],
    ]);
    expect(metric('tokens')).toEqual([
      ['Baseline: 40,900', 'higher'],
      ['WebMCP: 9,400', 'lower'],
    ]);
    expect(metric('screenshots')).toEqual([
      ['Baseline: 3', 'higher'],
      ['WebMCP: 0', 'lower'],
    ]);
    const bars = [...summary.querySelectorAll<HTMLElement>('[data-metric="steps"] .bar')];
    expect(bars.map((bar) => bar.style.width)).toEqual(['100%', `${(4 / 9) * 100}%`]);
  });

  it('collapses every Scenario, with Pass/Fail per Lane and the Fail reason in the header', () => {
    render(<ResultsSection results={RESULTS} models={MODELS} />);
    const rows = scenarioRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(within(row).getByRole('button').getAttribute('aria-expanded')).toBe('false');
      expect(row.querySelector('.scenario-body')).toBeNull();
    }
    const [first] = rows;
    if (!first) throw new Error('row');
    const verdicts = [...first.querySelectorAll('.scenario-verdict')].map((v) => v.textContent);
    expect(verdicts).toEqual(['BaselineFailcheck failed: answerContains "19.99"', 'WebMCPPass']);
  });

  it('expands a Scenario to its bars and tool calls per Attempt, and collapses it again', async () => {
    render(<ResultsSection results={RESULTS} models={MODELS} />);
    const [first] = scenarioRows();
    if (!first) throw new Error('row');
    const toggle = within(first).getByRole('button');
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(within(first).getByText('Find the red shirt.')).toBeTruthy();
    expect(within(first).getByLabelText('first metrics')).toBeTruthy();

    const table = within(first).getByRole('table', { name: 'Tool calls per Attempt' });
    const cells = [...table.querySelectorAll('tbody td')];
    expect(cells.map((cell) => cell.textContent)).toEqual([
      'Failcheck failed: answerContains "19.99"click 2screenshot 2',
      'Passsearch_products 1',
    ]);
    expect(cells[1]?.querySelector('li')?.getAttribute('data-source')).toBe('webmcp');
    // One Attempt: no averages.
    expect(first.textContent).not.toContain('Averages over');

    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(first.querySelector('.scenario-body')).toBeNull();
    // The other Scenario stayed collapsed throughout.
    expect(scenarioRows()[1]?.querySelector('.scenario-body')).toBeNull();
  });

  it('with Attempts > 1 shows pass counts, averages with min and max, and the pass rate', async () => {
    render(<ResultsSection results={repeated()} models={MODELS} />);
    const [row] = scenarioRows();
    if (!row) throw new Error('row');
    const verdicts = [...row.querySelectorAll('.scenario-verdict')].map((v) => v.textContent);
    expect(verdicts).toEqual(['BaselineFail 2/3Attempt 2: step limit reached', 'WebMCPPass 3/3']);

    await userEvent.click(within(row).getByRole('button'));
    const note = row.querySelector('.scenario-note')?.textContent;
    expect(note).toContain('Averages over 3 Attempts');
    expect(note).toContain('Baseline 67%');
    expect(note).toContain('WebMCP 100%');

    const steps = [...row.querySelectorAll('[data-metric="steps"] .bar-row')].map((r) => [
      r.querySelector('.bar-value')?.textContent,
      r.querySelector('.bar-range')?.textContent,
    ]);
    expect(steps).toEqual([
      ['Baseline: 5', '4 to 6'],
      ['WebMCP: 2', '2 to 2'],
    ]);
    const time = row.querySelector('[data-metric="durationMs"] .bar-range')?.textContent;
    expect(time).toBe('1.0 s to 3.0 s');
    expect(row.querySelectorAll('.attempt-table tbody tr')).toHaveLength(3);
  });

  it('shows a skipped Scenario as neutral', () => {
    const results = structuredClone(RESULTS);
    const [, second] = results.scenarios;
    if (!second) throw new Error('fixture');
    second.status = 'skipped';
    second.attempts = [];
    second.comparison = null;
    results.run.stoppedByUser = true;
    render(<ResultsSection results={results} models={MODELS} />);
    const row = scenarioRows()[1];
    expect(row?.querySelectorAll('.pill.neutral')).toHaveLength(2);
    expect(row?.textContent).toContain('Skipped');
    expect(screen.getByText('Stopped by user')).toBeTruthy();
  });
});
