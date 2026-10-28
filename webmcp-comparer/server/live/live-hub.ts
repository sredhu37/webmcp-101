import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import type { Page } from 'playwright';
import { WebSocket, WebSocketServer } from 'ws';
import { VIEWPORT } from '../lane/browser.ts';
import type { LanePage, RunEvent, RunManager } from '../run/orchestrator.ts';
import { laneMessage, liveRun } from './events.ts';
import { FrameThrottle } from './frame-throttle.ts';
import {
  LIVE_LANES,
  LIVE_MAX_FPS,
  LIVE_PATH,
  applyLiveMessage,
  emptyLiveState,
  encodeFrame,
  type LiveLaneId,
  type LiveMessage,
  type LiveRun,
  type LiveState,
} from './protocol.ts';

/** Screencast frame size: the Lane viewport scaled to 800 px wide. */
export const FRAME_SIZE = {
  width: 800,
  height: Math.round((800 * VIEWPORT.height) / VIEWPORT.width),
} as const;

export const FRAME_QUALITY = 60;

/** A client that has this much unsent data skips frames (the newest frame wins). */
export const MAX_BUFFERED_BYTES = 1_000_000;

export interface LiveHubOptions {
  manager: RunManager;
  maxFps?: number;
  frameSize?: { width: number; height: number };
  quality?: number;
  maxBufferedBytes?: number;
}

interface LaneStream {
  runId: string;
  page: Page;
  throttle: FrameThrottle<Buffer>;
}

/** Frames per Lane: received from the screencast and sent to viewers, after the fps cap. */
export interface LiveFrameStats {
  received: Record<LiveLaneId, number>;
  sent: Record<LiveLaneId, number>;
}

/**
 * Streams both Lanes to the live view: a Playwright screencast per Lane page, frames capped per
 * Lane, the last frame of each Lane cached, and the Run's events turned into live messages. New
 * viewers get the current state and the cached frames first.
 */
export class LiveHub {
  readonly #manager: RunManager;
  readonly #intervalMs: number;
  readonly #frameSize: { width: number; height: number };
  readonly #quality: number;
  readonly #maxBuffered: number;
  readonly #unsubscribe: () => void;
  readonly #clients = new Set<WebSocket>();
  readonly #streams = new Map<LiveLaneId, LaneStream>();
  readonly #frames = new Map<LiveLaneId, Uint8Array>();
  readonly stats: LiveFrameStats = {
    received: { baseline: 0, webmcp: 0 },
    sent: { baseline: 0, webmcp: 0 },
  };
  #state: LiveState = emptyLiveState();
  #current: LiveRun['current'] = null;
  #closed = false;

  constructor(options: LiveHubOptions) {
    this.#manager = options.manager;
    this.#intervalMs = 1000 / (options.maxFps ?? LIVE_MAX_FPS);
    this.#frameSize = options.frameSize ?? FRAME_SIZE;
    this.#quality = options.quality ?? FRAME_QUALITY;
    this.#maxBuffered = options.maxBufferedBytes ?? MAX_BUFFERED_BYTES;
    this.#unsubscribe = this.#manager.subscribe({
      event: (event) => this.#onEvent(event),
      page: (lanePage) => this.#attach(lanePage),
    });
  }

  /** What a new viewer gets first. */
  get state(): LiveState {
    return this.#state;
  }

  /** Lanes with a screencast running. */
  get streaming(): LiveLaneId[] {
    return LIVE_LANES.filter((lane) => this.#streams.has(lane));
  }

  /** Lanes with a frame waiting for its slot under the fps cap. */
  get waitingFrames(): LiveLaneId[] {
    return LIVE_LANES.filter((lane) => this.#streams.get(lane)?.throttle.waiting);
  }

  get clientCount(): number {
    return this.#clients.size;
  }

  /** The cached frame message of a Lane (Lane byte + JPEG), replayed to new viewers. */
  lastFrame(lane: LiveLaneId): Uint8Array | undefined {
    return this.#frames.get(lane);
  }

  /** A new viewer: the current state, then the last frame of each Lane, then everything new. */
  addClient(ws: WebSocket): void {
    if (this.#closed) {
      ws.close(1001, 'server closing');
      return;
    }
    this.#clients.add(ws);
    ws.on('close', () => this.#clients.delete(ws));
    ws.on('error', () => {
      this.#clients.delete(ws);
      ws.terminate();
    });
    ws.send(JSON.stringify({ type: 'snapshot', state: this.#state } satisfies LiveMessage));
    for (const lane of LIVE_LANES) {
      const frame = this.#frames.get(lane);
      if (frame) ws.send(frame);
    }
  }

  /** Stops the screencasts and closes every viewer. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#unsubscribe();
    await Promise.all(LIVE_LANES.map((lane) => this.#stopStream(lane, { flush: false })));
    await Promise.all(
      [...this.#clients].map(
        (ws) =>
          new Promise<void>((resolve) => {
            const timer = setTimeout(() => ws.terminate(), 1_000);
            ws.once('close', () => {
              clearTimeout(timer);
              resolve();
            });
            ws.close(1001, 'server closing');
          }),
      ),
    );
    this.#clients.clear();
  }

  #onEvent(event: RunEvent): void {
    if (event.type === 'lane') {
      const message = laneMessage(event.record);
      if (message) this.#publish(message);
      if (event.record.event === 'lane_end') void this.#stopStream(event.record.lane);
      return;
    }

    switch (event.type) {
      case 'run_start':
        this.#current = null;
        this.#frames.clear();
        for (const lane of LIVE_LANES) void this.#stopStream(lane, { flush: false });
        break;
      case 'scenario_start':
        this.#current = { scenario: event.scenario, attempt: null };
        break;
      case 'attempt_start':
        this.#current = { scenario: event.scenario, attempt: event.attempt };
        break;
      case 'scenario_end':
      case 'scenario_skipped':
        this.#current = null;
        break;
      case 'run_end':
        this.#current = null;
        for (const lane of LIVE_LANES) void this.#stopStream(lane);
        break;
      case 'attempt_end':
        // The Lanes' own `outcome` messages already carry this.
        return;
    }
    const run = this.#manager.current;
    if (!run || run.id !== event.runId) return;
    this.#publish({ type: 'run', run: liveRun(run.results, run.running, this.#current) });
  }

  async #attach({ runId, lane, page }: LanePage): Promise<void> {
    await this.#stopStream(lane, { flush: false });
    if (this.#closed) return;
    const stream: LaneStream = {
      runId,
      page,
      throttle: new FrameThrottle(this.#intervalMs, (jpeg) => this.#frame(lane, jpeg)),
    };
    this.#streams.set(lane, stream);
    page.once('close', () => void this.#stopStream(lane, { only: stream }));
    try {
      await page.screencast.start({
        size: this.#frameSize,
        quality: this.#quality,
        onFrame: ({ data }) => {
          if (this.#streams.get(lane) !== stream) return;
          this.stats.received[lane] += 1;
          stream.throttle.push(data);
        },
      });
    } catch (error) {
      await this.#stopStream(lane, { only: stream, flush: false });
      throw error;
    }
  }

  /**
   * Ends a Lane's screencast. By default the frame waiting under the fps cap is sent right away,
   * so viewers keep the Lane's final screen.
   */
  async #stopStream(
    lane: LiveLaneId,
    options: { only?: LaneStream; flush?: boolean } = {},
  ): Promise<void> {
    const stream = this.#streams.get(lane);
    if (!stream || (options.only && options.only !== stream)) return;
    this.#streams.delete(lane);
    if (options.flush === false) stream.throttle.cancel();
    else stream.throttle.stop();
    if (!stream.page.isClosed()) await stream.page.screencast.stop().catch(() => undefined);
  }

  #frame(lane: LiveLaneId, jpeg: Buffer): void {
    const message = encodeFrame(lane, jpeg);
    this.#frames.set(lane, message);
    this.stats.sent[lane] += 1;
    for (const ws of this.#clients) {
      if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount <= this.#maxBuffered) {
        ws.send(message);
      }
    }
  }

  #publish(message: LiveMessage): void {
    this.#state = applyLiveMessage(this.#state, message);
    const text = JSON.stringify(message);
    for (const ws of this.#clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(text);
    }
  }
}

export interface LiveTransportOptions extends Omit<LiveHubOptions, 'manager'> {
  /**
   * Refuse WebSocket upgrades to other paths. Off in dev, where Vite's HMR socket shares the
   * server.
   */
  refuseOtherUpgrades: boolean;
}

/**
 * `GET /api/live` (WebSocket) on the app's own HTTP server. Handles only its own path, so Vite's
 * HMR socket keeps working in dev.
 */
export function registerLiveTransport(
  app: FastifyInstance,
  manager: RunManager,
  options: LiveTransportOptions,
): LiveHub {
  const { refuseOtherUpgrades, ...hubOptions } = options;
  const hub = new LiveHub({ manager, ...hubOptions });
  // Viewers send nothing; the limit only bounds what a client could push.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4_096 });

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const path = (request.url ?? '/').split('?')[0];
    if (path !== LIVE_PATH) {
      if (refuseOtherUpgrades) refuse(socket, 404, 'Not Found');
      return;
    }
    if (!sameOrigin(request)) {
      refuse(socket, 403, 'Forbidden');
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => hub.addClient(ws));
  };
  app.server.on('upgrade', onUpgrade);
  app.addHook('preClose', async () => {
    app.server.off('upgrade', onUpgrade);
    await hub.close();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });
  return hub;
}

/**
 * A browser always sends `Origin`; it must name this server, so other sites open in the same
 * browser cannot watch the Lanes. Clients without `Origin` (not browsers) are let in.
 */
function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function refuse(socket: Duplex, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
