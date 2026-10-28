import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LiveConnection,
  emptyLiveState,
  encodeFrame,
  liveUrl,
  type LiveConnectionStatus,
  type LiveLaneId,
  type LiveMessage,
  type LiveRun,
  type LiveSocket,
  type LiveState,
} from './client.ts';

class FakeSocket implements LiveSocket {
  static all: FakeSocket[] = [];
  binaryType: BinaryType = 'blob';
  onopen: LiveSocket['onopen'] = null;
  onmessage: LiveSocket['onmessage'] = null;
  onclose: LiveSocket['onclose'] = null;
  onerror: LiveSocket['onerror'] = null;
  closed = false;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeSocket.all.push(this);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.call(this as unknown as WebSocket, new Event('open'));
  }

  receive(data: string | ArrayBuffer): void {
    this.onmessage?.call(this as unknown as WebSocket, new MessageEvent('message', { data }));
  }

  drop(): void {
    this.onclose?.call(this as unknown as WebSocket, new Event('close') as CloseEvent);
  }
}

const run: LiveRun = {
  id: 'run-1',
  startedAt: '2026-10-16T10:00:00.000Z',
  endedAt: null,
  siteUrl: 'http://localhost:4000',
  provider: 'anthropic',
  model: 'claude-haiku-5-5',
  attempts: 1,
  limits: { maxSteps: 50, maxDurationMs: 300_000, maxCostUsd: 2 },
  scenarios: [{ id: 's1', status: 'running' }],
  current: { scenario: 's1', attempt: 1 },
  running: true,
  stoppedByUser: false,
  error: null,
};

function connect() {
  const states: { state: LiveState; message: LiveMessage }[] = [];
  const frames: { lane: LiveLaneId; jpeg: number[] }[] = [];
  const statuses: LiveConnectionStatus[] = [];
  const connection = new LiveConnection({
    url: 'ws://app.test/api/live',
    createSocket: (url) => new FakeSocket(url),
    onState: (state, message) => states.push({ state, message }),
    onFrame: (lane, jpeg) => frames.push({ lane, jpeg: [...jpeg] }),
    onStatus: (status) => statuses.push(status),
    reconnectDelayMs: 100,
    maxReconnectDelayMs: 300,
  });
  return { connection, states, frames, statuses, socket: () => FakeSocket.all.at(-1)! };
}

describe('LiveConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.all = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds the socket URL from the page location', () => {
    expect(liveUrl({ protocol: 'http:', host: 'localhost:3000' })).toBe(
      'ws://localhost:3000/api/live',
    );
    expect(liveUrl({ protocol: 'https:', host: 'example.test' })).toBe(
      'wss://example.test/api/live',
    );
  });

  it('applies text messages to its state and hands out frames by Lane', () => {
    const { connection, states, frames, statuses, socket } = connect();
    expect(socket().url).toBe('ws://app.test/api/live');
    expect(socket().binaryType).toBe('arraybuffer');
    socket().open();
    expect(connection.status).toBe('open');
    expect(statuses).toEqual(['open']);

    const snapshot = { ...emptyLiveState(), run };
    socket().receive(JSON.stringify({ type: 'snapshot', state: snapshot }));
    socket().receive(
      JSON.stringify({
        type: 'lane_start',
        lane: 'webmcp',
        t: run.startedAt,
        scenario: 's1',
        attempt: 1,
        maxSteps: 50,
      }),
    );
    socket().receive('not json');
    socket().receive(JSON.stringify({ type: 'unknown' }));
    const jpeg = new Uint8Array([0xff, 0xd8, 9, 0xff, 0xd9]);
    socket().receive(encodeFrame('webmcp', jpeg).buffer as ArrayBuffer);
    socket().receive(encodeFrame('baseline', jpeg).buffer as ArrayBuffer);
    socket().receive(new Uint8Array([5, 1, 2]).buffer);

    expect(states.map((s) => s.message.type)).toEqual(['snapshot', 'lane_start']);
    expect(connection.state.run).toEqual(run);
    expect(connection.state.lanes.webmcp).toMatchObject({ status: 'running', maxSteps: 50 });
    expect(frames).toEqual([
      { lane: 'webmcp', jpeg: [...jpeg] },
      { lane: 'baseline', jpeg: [...jpeg] },
    ]);
  });

  it('reconnects with a growing delay and takes the new snapshot', () => {
    const { connection, statuses, socket } = connect();
    socket().open();
    socket().receive(JSON.stringify({ type: 'run', run }));
    socket().drop();
    expect(connection.status).toBe('closed');

    vi.advanceTimersByTime(99);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(2);
    socket().drop();
    vi.advanceTimersByTime(199);
    expect(FakeSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(3);
    socket().drop();
    vi.advanceTimersByTime(300);
    expect(FakeSocket.all).toHaveLength(4);

    socket().open();
    socket().receive(JSON.stringify({ type: 'snapshot', state: emptyLiveState() }));
    expect(connection.state).toEqual(emptyLiveState());
    expect(statuses).toEqual([
      'open',
      'closed',
      'connecting',
      'closed',
      'connecting',
      'closed',
      'connecting',
      'open',
    ]);
  });

  it('stays closed after close()', () => {
    const { connection, socket } = connect();
    socket().open();
    const first = socket();
    connection.close();
    expect(first.closed).toBe(true);
    first.drop();
    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(connection.status).toBe('closed');
  });
});
