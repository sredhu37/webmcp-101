/**
 * Hands each Lane's screencast frames to whoever draws them, outside React state: frames come at
 * up to 10 per second per Lane and only the newest matters. Keeps the newest frame so a canvas
 * that mounts later draws it at once.
 */
import type { LiveLaneId } from './client.ts';

export type FrameListener = (jpeg: Uint8Array) => void;

export class FrameBus {
  readonly #last = new Map<LiveLaneId, Uint8Array>();
  readonly #listeners = new Map<LiveLaneId, Set<FrameListener>>();

  push(lane: LiveLaneId, jpeg: Uint8Array): void {
    this.#last.set(lane, jpeg);
    for (const listener of this.#listeners.get(lane) ?? []) listener(jpeg);
  }

  last(lane: LiveLaneId): Uint8Array | null {
    return this.#last.get(lane) ?? null;
  }

  /** Forgets the frames of the previous Run. */
  clear(): void {
    this.#last.clear();
  }

  /** Calls `listener` with the newest frame now (if any) and with every frame after; returns unsubscribe. */
  subscribe(lane: LiveLaneId, listener: FrameListener): () => void {
    let set = this.#listeners.get(lane);
    if (!set) {
      set = new Set();
      this.#listeners.set(lane, set);
    }
    set.add(listener);
    const last = this.#last.get(lane);
    if (last) listener(last);
    return () => {
      set.delete(listener);
    };
  }
}
