// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useReducer } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, type KeysInfo, type Preflight, type Results } from '../api.ts';
import { DEFAULTS, KEYS_IN_ENV, MODELS, SUITE } from '../testing/fixtures.ts';
import { initialForm, setupReducer } from './form.ts';
import { Setup } from './Setup.tsx';
import type { SuiteEditorProps } from './SuiteEditor.tsx';

// Monaco needs a real browser; a textarea stands in for it here.
vi.mock('./SuiteEditor.tsx', () => ({
  default: (props: SuiteEditorProps) => (
    <textarea
      aria-label={props.label}
      value={props.value}
      readOnly={props.readOnly}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness(props: { keys?: KeysInfo; locked?: boolean; onStarted?: (id: string) => void }) {
  const [form, dispatch] = useReducer(setupReducer, DEFAULTS, initialForm);
  return (
    <Setup
      form={form}
      dispatch={dispatch}
      models={MODELS}
      keys={props.keys ?? KEYS_IN_ENV}
      maxAttempts={100}
      locked={props.locked ?? false}
      onStarted={props.onStarted ?? (() => undefined)}
    />
  );
}

const runButton = () => screen.getByRole('button', { name: /^(Run|Checking|Starting)/ });

const PREFLIGHT_OK: Preflight = {
  ok: true,
  key: { ok: true, source: 'env', message: null },
  webmcp: [],
  warnings: [],
};

describe('Setup', () => {
  it('prefills the Site URL, the Suite, the first Scenario and the limits', async () => {
    render(<Harness />);
    expect(screen.getByLabelText('Site URL')).toHaveProperty('value', 'http://localhost:4000');
    expect(await screen.findByLabelText('Suite YAML')).toHaveProperty('value', SUITE);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.map((box) => (box as HTMLInputElement).checked)).toEqual([true, false, false]);
    expect(screen.getByLabelText('Repeat')).toHaveProperty('value', '1');
    expect(screen.getByLabelText('Max Steps')).toHaveProperty('value', '50');
    expect(screen.getByLabelText('Max minutes')).toHaveProperty('value', '5');
    expect(screen.getByLabelText('Max cost')).toHaveProperty('value', '2.00');
    expect(screen.getByText('Valid Suite, 3 Scenarios')).toBeTruthy();
    expect(runButton().textContent).toBe('Run 1 Scenario');
  });

  it('names the Run after the selection and the Attempts', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    expect(runButton().textContent).toBe('Run 3 Scenarios');

    const repeat = screen.getByLabelText('Repeat');
    await user.clear(repeat);
    await user.type(repeat, '2');
    expect(runButton().textContent).toBe('Run 3 Scenarios, 2 Attempts each');

    await user.click(screen.getByRole('button', { name: 'Select none' }));
    expect(runButton()).toHaveProperty('disabled', true);
    expect(screen.getByText('Select at least one Scenario.')).toBeTruthy();
  });

  it('shows Suite errors with their lines and disables Run until the Suite is valid', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const editor = await screen.findByLabelText('Suite YAML');
    await user.clear(editor);
    await user.type(editor, 'scenarios:{Enter}  - id: Bad Id{Enter}    color: red');

    expect(screen.getByText(/errors? in the Suite/)).toBeTruthy();
    const lines = screen.getAllByRole('button', { name: /^Line \d+/ });
    expect(lines.map((line) => line.textContent)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Line 2/), expect.stringMatching(/^Line 3/)]),
    );
    expect(runButton()).toHaveProperty('disabled', true);
    expect(screen.getByText('Fix the Suite errors to run.')).toBeTruthy();

    await user.clear(editor);
    await user.type(editor, 'scenarios:{Enter}  - id: fixed{Enter}    prompt: Go');
    expect(screen.getByText('Valid Suite, 1 Scenario')).toBeTruthy();
    expect(runButton()).toHaveProperty('disabled', false);
  });

  it('opens an uploaded Suite in the editor and resets the selection', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const { container } = render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    const upload = 'scenarios:\n  - id: uploaded\n    prompt: From a file.\n';
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
    await user.upload(input, new File([upload], 'mine.yaml', { type: 'application/yaml' }));

    await waitFor(() =>
      expect(screen.getByLabelText('Suite YAML')).toHaveProperty('value', upload),
    );
    expect(screen.getByText('Loaded mine.yaml')).toBeTruthy();
    expect(runButton().textContent).toBe('Run 1 Scenario');
  });

  it('shows "Loaded from .env" and asks for a key when the provider has none', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const key = screen.getByLabelText('API key');
    expect(key.getAttribute('type')).toBe('password');
    expect(key.getAttribute('placeholder')).toBe('Loaded from .env');

    await user.selectOptions(screen.getByLabelText('Provider'), 'openai');
    expect(screen.getByLabelText('Model')).toHaveProperty('value', 'gpt-6-luna');
    expect(screen.getByRole('option', { name: 'gpt-6-luna (recommended)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'gpt-5.6-sol (not recommended)' })).toBeTruthy();
    expect(screen.getByText('No OPENAI_API_KEY in .env')).toBeTruthy();
    expect(runButton()).toHaveProperty('disabled', true);

    await user.type(screen.getByLabelText('API key'), 'sk-pasted');
    expect(runButton()).toHaveProperty('disabled', false);
  });

  it('runs the pre-Run checks, shows their warnings without blocking, then starts the Run', async () => {
    const user = userEvent.setup();
    const onStarted = vi.fn();
    const warning =
      'Scenario first: the start page http://localhost:4000/ has no WebMCP tools, so the WebMCP lane only has Browser tools.';
    const preflight = vi
      .spyOn(api, 'preflight')
      .mockResolvedValue({ ...PREFLIGHT_OK, warnings: [warning] });
    const startRun = vi
      .spyOn(api, 'startRun')
      .mockResolvedValue({ id: '2026-10-16_09-00-00', results: {} as Results });
    render(<Harness onStarted={onStarted} />);

    await user.click(runButton());

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('2026-10-16_09-00-00'));
    expect(preflight).toHaveBeenCalledTimes(1);
    expect(startRun).toHaveBeenCalledWith(preflight.mock.calls[0]![0]);
    expect(preflight.mock.calls[0]![0]).toMatchObject({
      siteUrl: 'http://localhost:4000',
      scenarioIds: ['first'],
      model: 'claude-haiku-5-5',
      attempts: 1,
      limits: { maxSteps: 50, maxDurationMs: 300_000, maxCostUsd: 2 },
    });
    expect(preflight.mock.calls[0]![0]).not.toHaveProperty('apiKey');
    expect(screen.getByText(warning)).toBeTruthy();
  });

  it('does not start the Run when the key check fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'preflight').mockResolvedValue({
      ...PREFLIGHT_OK,
      ok: false,
      key: { ok: false, source: 'env', message: 'Anthropic rejected the API key (HTTP 401).' },
    });
    const startRun = vi.spyOn(api, 'startRun');
    render(<Harness />);

    await user.click(runButton());

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Anthropic rejected the API key (HTTP 401).',
    );
    expect(startRun).not.toHaveBeenCalled();
    expect(runButton()).toHaveProperty('disabled', false);
  });

  it('locks every input while a Run is going', async () => {
    render(<Harness locked />);
    expect(screen.getByText('Locked while the Run is going')).toBeTruthy();
    // A disabled fieldset disables every control inside it (happy-dom does not apply that to
    // `:disabled`, so check for the fieldset).
    const isDisabled = (element: Element) => element.closest('fieldset[disabled]') !== null;
    expect(isDisabled(screen.getByLabelText('Site URL'))).toBe(true);
    expect(isDisabled(screen.getByLabelText('Max cost'))).toBe(true);
    expect(screen.getAllByRole('checkbox').every(isDisabled)).toBe(true);
    expect(isDisabled(screen.getByRole('button', { name: 'Select all' }))).toBe(true);
    expect(isDisabled(screen.getByRole('button', { name: /Upload/ }))).toBe(true);
    expect(await screen.findByLabelText('Suite YAML')).toHaveProperty('readOnly', true);
    expect(runButton()).toHaveProperty('disabled', true);
  });
});
