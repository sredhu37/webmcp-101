// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunListItem } from '../api.ts';
import { MODELS } from '../testing/fixtures.ts';
import { PastRuns } from './PastRuns.tsx';

afterEach(cleanup);

const RUNS: RunListItem[] = [
  {
    id: '2026-10-16_09-00-00',
    startedAt: '2026-10-16T07:00:00.000Z',
    endedAt: null,
    siteUrl: 'http://localhost:4000',
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    attempts: 1,
    scenarioIds: ['a'],
    pass: { baseline: { pass: 0, fail: 0 }, webmcp: { pass: 0, fail: 0 } },
    stoppedByUser: false,
    running: true,
  },
  {
    id: '2026-10-15_14-30-05',
    startedAt: '2026-10-15T12:30:05.000Z',
    endedAt: '2026-10-15T12:31:05.000Z',
    siteUrl: 'https://shop.example.com/de/',
    provider: 'openai',
    model: 'gpt-6-luna',
    attempts: 2,
    scenarioIds: ['a', 'b'],
    pass: { baseline: { pass: 3, fail: 1 }, webmcp: { pass: 4, fail: 0 } },
    stoppedByUser: false,
    running: false,
  },
];

function Harness({ onOpen = () => undefined }: { onOpen?: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <PastRuns
      runs={RUNS}
      error={null}
      models={MODELS}
      open={open}
      onToggle={() => setOpen((value) => !value)}
      onOpen={onOpen}
      onRetry={() => undefined}
      openedId={null}
      busy={false}
    />
  );
}

describe('PastRuns', () => {
  it('lists each Run with its Site URL, model and pass counts per Lane', () => {
    render(<Harness />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);

    const done = within(items[1]!);
    expect(done.getByText('shop.example.com/de')).toBeTruthy();
    expect(done.getByText('gpt-6-luna')).toBeTruthy();
    expect(done.getByLabelText('Baseline passed 3 of 4')).toBeTruthy();
    expect(done.getByLabelText('WebMCP passed 4 of 4')).toBeTruthy();
    expect(done.getByRole('link', { name: /zip/i }).getAttribute('href')).toBe(
      '/api/runs/2026-10-15_14-30-05/zip',
    );

    const running = within(items[0]!);
    expect(running.getByText('Running')).toBeTruthy();
    expect(running.getByText('Haiku 5.5')).toBeTruthy();
    expect(running.queryByRole('link')).toBeNull();
  });

  it('opens a Run', async () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open Run 2026-10-15_14-30-05' }));
    expect(onOpen).toHaveBeenCalledWith('2026-10-15_14-30-05');
  });

  it('collapses and expands', async () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Hide Past Runs' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    await userEvent.click(toggle);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    const show = screen.getByRole('button', { name: 'Show Past Runs' });
    expect(show.getAttribute('aria-expanded')).toBe('false');

    await userEvent.click(show);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('says so when there are no Runs yet', () => {
    render(
      <PastRuns
        runs={[]}
        error={null}
        models={MODELS}
        open
        onToggle={() => undefined}
        onOpen={() => undefined}
        onRetry={() => undefined}
        openedId={null}
        busy={false}
      />,
    );
    expect(screen.getByText(/No Runs yet/)).toBeTruthy();
  });
});
