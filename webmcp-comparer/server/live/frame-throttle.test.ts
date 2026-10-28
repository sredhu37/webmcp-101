import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameThrottle } from './frame-throttle.ts';

describe('FrameThrottle', () => {
  let sent: { item: number; at: number }[];
  let throttle: FrameThrottle<number>;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    throttle = new FrameThrottle(
      100,
      (item) => sent.push({ item, at: Date.now() }),
      () => Date.now(),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the first item at once and at most one item per interval after it', () => {
    const start = Date.now();
    // 60 items per second for one second.
    for (let i = 0; i < 60; i += 1) {
      throttle.push(i);
      vi.advanceTimersByTime(1000 / 60);
    }
    vi.advanceTimersByTime(200);

    expect(sent[0]).toEqual({ item: 0, at: start });
    expect(sent.length).toBeLessThanOrEqual(11);
    expect(sent.length).toBeGreaterThanOrEqual(10);
    for (let i = 1; i < sent.length; i += 1) {
      expect(sent[i]!.at - sent[i - 1]!.at).toBeGreaterThanOrEqual(100);
    }
    // The newest item of the burst is never lost.
    expect(sent.at(-1)!.item).toBe(59);
  });

  it('keeps only the newest item while waiting for the slot', () => {
    throttle.push(1);
    throttle.push(2);
    throttle.push(3);
    expect(throttle.waiting).toBe(true);
    vi.advanceTimersByTime(100);

    expect(sent.map((s) => s.item)).toEqual([1, 3]);
    expect(throttle.waiting).toBe(false);
  });

  it('sends an item right away after a quiet interval', () => {
    throttle.push(1);
    vi.advanceTimersByTime(250);
    throttle.push(2);

    expect(sent).toHaveLength(2);
    expect(sent[1]!.at - sent[0]!.at).toBe(250);
  });

  it('stop() sends the waiting item at once and ignores later items', () => {
    throttle.push(1);
    throttle.push(2);
    throttle.stop();
    throttle.push(3);
    vi.advanceTimersByTime(1_000);

    expect(sent.map((s) => s.item)).toEqual([1, 2]);
    expect(throttle.waiting).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancel() drops the waiting item', () => {
    throttle.push(1);
    throttle.push(2);
    throttle.cancel();
    throttle.push(3);
    vi.advanceTimersByTime(1_000);

    expect(sent.map((s) => s.item)).toEqual([1]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
