import { describe, expect, it } from 'vitest';
import { FixedWindowCounter } from '../src/rateLimit/fixedWindow.ts';

/**
 * The counter behind the login limiter, tested without HTTP or a clock.
 *
 * `hit`/`peek` take `now` so the window boundary is reachable without sleeping for 15
 * minutes; every case below walks the clock by hand. The HTTP-level behaviour this
 * primitive produces is in `auth.rateLimit.test.ts`.
 */
describe('FixedWindowCounter', () => {
  const WINDOW = 60;
  const T0 = 1_700_000_000_000;

  it('counts hits per key, independently', () => {
    const counter = new FixedWindowCounter(WINDOW);
    expect(counter.hit('a', T0).count).toBe(1);
    expect(counter.hit('a', T0).count).toBe(2);
    expect(counter.hit('b', T0).count).toBe(1);
    expect(counter.peek('a', T0).count).toBe(2);
  });

  it('does not count a peek', () => {
    const counter = new FixedWindowCounter(WINDOW);
    counter.hit('a', T0);
    counter.peek('a', T0);
    counter.peek('a', T0);
    expect(counter.peek('a', T0).count).toBe(1);
  });

  it('reports an unknown key as zero rather than as absent', () => {
    const counter = new FixedWindowCounter(WINDOW);
    const state = counter.peek('never-seen', T0);
    expect(state.count).toBe(0);
    // A caller at zero is not limited, but the field still has to be a usable number:
    // the request path reads it unconditionally.
    expect(state.retryAfterSeconds).toBe(WINDOW);
  });

  it('forgets a window once it expires, and starts the next one from the hit', () => {
    const counter = new FixedWindowCounter(WINDOW);
    counter.hit('a', T0);
    counter.hit('a', T0 + 1_000);
    expect(counter.peek('a', T0 + 1_000).count).toBe(2);

    // One millisecond before the boundary the count stands.
    expect(counter.peek('a', T0 + WINDOW * 1000 - 1).count).toBe(2);
    // On the boundary it is gone. The window the first hit opened ends at T0 + 60s, not
    // 60s after the most recent hit — that is what makes it a fixed window and what
    // makes `Retry-After` exact.
    expect(counter.peek('a', T0 + WINDOW * 1000).count).toBe(0);
    expect(counter.hit('a', T0 + WINDOW * 1000).count).toBe(1);
  });

  it('counts down Retry-After within the window, never below 1', () => {
    const counter = new FixedWindowCounter(WINDOW);
    expect(counter.hit('a', T0).retryAfterSeconds).toBe(WINDOW);
    expect(counter.peek('a', T0 + 30_000).retryAfterSeconds).toBe(30);

    // Rounded up: at 29.5s remaining a client obeying `29` would arrive still blocked.
    expect(counter.peek('a', T0 + 30_500).retryAfterSeconds).toBe(30);

    // Floored at 1. `Retry-After: 0` reads as "go ahead", which is the one answer a
    // still-limited caller must not be given.
    expect(counter.peek('a', T0 + WINDOW * 1000 - 1).retryAfterSeconds).toBe(1);
  });

  it('does not let a blocked caller push their own window out', () => {
    const counter = new FixedWindowCounter(WINDOW);
    counter.hit('a', T0);
    // The request path peeks and rejects without hitting, so hammering the endpoint
    // leaves the deadline where it was. If it did not, `Retry-After` would be a number
    // the client's own obedience kept moving.
    for (let i = 0; i < 100; i += 1) counter.peek('a', T0 + 10_000);
    expect(counter.peek('a', T0 + 10_000).retryAfterSeconds).toBe(50);
    expect(counter.peek('a', T0 + 10_000).count).toBe(1);
  });

  it('clears one key without touching the others', () => {
    const counter = new FixedWindowCounter(WINDOW);
    counter.hit('a', T0);
    counter.hit('b', T0);
    counter.clear('a');
    expect(counter.peek('a', T0).count).toBe(0);
    expect(counter.peek('b', T0).count).toBe(1);
  });

  it('sweeps expired keys so a key-cycling caller cannot grow the map forever', () => {
    const counter = new FixedWindowCounter(WINDOW);
    // Each key is touched once and never revisited, which is what an attacker rotating
    // addresses or emails produces. Lazy expiry alone keeps the *counts* right but
    // leaves one dead entry per key; the amortised sweep is what bounds the memory.
    for (let i = 0; i < 1_000; i += 1) counter.hit(`key-${i}`, T0);
    expect(counter.size).toBe(1_000);

    // A write past the boundary triggers the sweep, which drops all 1,000 dead windows.
    counter.hit('late', T0 + WINDOW * 1000 + 1);
    for (let i = 0; i < 999; i += 1) counter.hit(`later-${i}`, T0 + WINDOW * 1000 + 1);
    expect(counter.size).toBeLessThanOrEqual(1_000);
  });

  it('refuses a window that is not a positive number of seconds', () => {
    expect(() => new FixedWindowCounter(0)).toThrow(/positive/);
    expect(() => new FixedWindowCounter(-1)).toThrow(/positive/);
    expect(() => new FixedWindowCounter(Number.NaN)).toThrow(/positive/);
  });
});
