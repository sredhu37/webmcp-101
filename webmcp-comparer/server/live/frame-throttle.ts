/**
 * Lets through at most one item per interval and keeps only the newest one in between, so the
 * last item of a burst is always delivered (on the next free slot).
 */
export class FrameThrottle<T> {
  readonly #intervalMs: number;
  readonly #send: (item: T) => void;
  readonly #now: () => number;
  #lastSent = Number.NEGATIVE_INFINITY;
  #pending: { item: T } | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;

  constructor(
    intervalMs: number,
    send: (item: T) => void,
    now: () => number = () => performance.now(),
  ) {
    this.#intervalMs = intervalMs;
    this.#send = send;
    this.#now = now;
  }

  /** True while an item waits for its slot. */
  get waiting(): boolean {
    return this.#timer !== undefined;
  }

  push(item: T): void {
    if (this.#stopped) return;
    const wait = this.#lastSent + this.#intervalMs - this.#now();
    if (wait <= 0 && this.#timer === undefined) {
      this.#emit(item);
      return;
    }
    this.#pending = { item };
    this.#timer ??= setTimeout(
      () => {
        this.#timer = undefined;
        this.#flush();
      },
      Math.max(0, wait),
    );
  }

  /** No more items; the waiting one, if any, is sent right away. */
  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#flush();
  }

  /** No more items; the waiting one is dropped. */
  cancel(): void {
    this.#stopped = true;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#pending = null;
  }

  #flush(): void {
    const pending = this.#pending;
    this.#pending = null;
    if (pending) this.#emit(pending.item);
  }

  #emit(item: T): void {
    this.#lastSent = this.#now();
    this.#send(item);
  }
}
