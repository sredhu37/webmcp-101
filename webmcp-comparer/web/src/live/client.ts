/**
 * Browser client of the live view WebSocket (`GET /api/live`): keeps the live state up to date,
 * hands out each Lane's frames, and reconnects (the server replays the state and the last frames).
 */
import {
  LIVE_PATH,
  applyLiveMessage,
  decodeFrame,
  emptyLiveState,
  parseLiveMessage,
  type LiveLaneId,
  type LiveMessage,
  type LiveState,
} from '../../../server/live/protocol.ts';

export * from '../../../server/live/protocol.ts';

export type LiveConnectionStatus = 'connecting' | 'open' | 'closed';

/** The part of `WebSocket` the client uses. */
export type LiveSocket = Pick<
  WebSocket,
  'binaryType' | 'onopen' | 'onmessage' | 'onclose' | 'onerror' | 'close'
>;

export interface LiveConnectionOptions {
  /** Defaults to `/api/live` on the page's own host. */
  url?: string;
  /** After every text message, with the new state. */
  onState?: (state: LiveState, message: LiveMessage) => void;
  /** Every screencast frame, already split from its Lane byte. */
  onFrame?: (lane: LiveLaneId, jpeg: Uint8Array) => void;
  onStatus?: (status: LiveConnectionStatus) => void;
  /** First reconnect delay; it doubles up to `maxReconnectDelayMs`. */
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  /** For tests. */
  createSocket?: (url: string) => LiveSocket;
}

/** `ws(s)://<host>/api/live` for a page location. */
export function liveUrl(location: { protocol: string; host: string }): string {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${LIVE_PATH}`;
}

export class LiveConnection {
  readonly #o: LiveConnectionOptions;
  readonly #url: string;
  #state: LiveState = emptyLiveState();
  #status: LiveConnectionStatus = 'connecting';
  #socket: LiveSocket | null = null;
  #retries = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #closed = false;

  constructor(options: LiveConnectionOptions = {}) {
    this.#o = options;
    this.#url = options.url ?? liveUrl(window.location);
    this.#connect();
  }

  get state(): LiveState {
    return this.#state;
  }

  get status(): LiveConnectionStatus {
    return this.#status;
  }

  /** Closes the socket for good. */
  close(): void {
    this.#closed = true;
    clearTimeout(this.#timer);
    const socket = this.#socket;
    this.#socket = null;
    socket?.close();
    this.#setStatus('closed');
  }

  #connect(): void {
    this.#setStatus('connecting');
    const socket = (this.#o.createSocket ?? ((url) => new WebSocket(url)))(this.#url);
    this.#socket = socket;
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      if (this.#socket !== socket) return;
      this.#retries = 0;
      this.#setStatus('open');
    };
    socket.onmessage = (event: MessageEvent<unknown>) => {
      if (this.#socket !== socket) return;
      this.#receive(event.data);
    };
    socket.onerror = () => undefined;
    socket.onclose = () => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#setStatus('closed');
      this.#scheduleReconnect();
    };
  }

  #receive(data: unknown): void {
    if (typeof data === 'string') {
      const message = parseLiveMessage(data);
      if (!message) return;
      this.#state = applyLiveMessage(this.#state, message);
      this.#o.onState?.(this.#state, message);
    } else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
      const frame = decodeFrame(data);
      if (frame) this.#o.onFrame?.(frame.lane, frame.jpeg);
    }
  }

  #scheduleReconnect(): void {
    if (this.#closed) return;
    const first = this.#o.reconnectDelayMs ?? 1_000;
    const delay = Math.min(first * 2 ** this.#retries, this.#o.maxReconnectDelayMs ?? 10_000);
    this.#retries += 1;
    this.#timer = setTimeout(() => this.#connect(), delay);
  }

  #setStatus(status: LiveConnectionStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#o.onStatus?.(status);
  }
}

/** A frame as an image for `CanvasRenderingContext2D.drawImage`. */
export function decodeJpeg(jpeg: Uint8Array): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([jpeg.slice()], { type: 'image/jpeg' }));
}
