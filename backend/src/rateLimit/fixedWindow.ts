/**
 * A fixed-window failure counter, in memory.
 *
 * Fixed window rather than a sliding log or a token bucket, for one reason that matters
 * more than its slightly worse burst behaviour: the window has an *exact* end, so
 * `Retry-After` is a fact rather than an estimate. A sliding log would have to guess
 * when the caller's oldest entry ages out, and a token bucket would have to invent a
 * refill time. The contract tells the mobile client to obey `Retry-After`, so it had
 * better be the truth.
 *
 * The cost of a fixed window is that a caller can spend a full budget at the end of one
 * window and another at the start of the next — up to 2x the limit over a window's
 * width, straddling the boundary. For login throttling that is irrelevant: 20 guesses in
 * a moment instead of 10 does not change an attacker's position, and the alternative
 * costs the honest `Retry-After`.
 *
 * ## In memory, and therefore per process
 *
 * Counts live in this process's heap. Two consequences, both deliberate for an MVP
 * running one API process:
 *
 *  * A restart forgets every count, so a restart loop is a way through the limiter.
 *  * Scaling to N processes divides the effective limit's precision by N — each process
 *    enforces the threshold against the share of traffic it happened to receive, so the
 *    real ceiling is up to N x the configured number.
 *
 * Neither weakens the guarantee this is here for (a guess rate bounded by something
 * other than argon2), and both are fixed by the same change: move this store behind
 * Redis, keeping the interface below. Nothing outside this file knows where counts live.
 */

/** What a caller needs to know after consuming from a bucket. */
export interface WindowState {
  /** Count after this call, including the hit just recorded. */
  readonly count: number;
  /** Whole seconds until the current window ends. At least 1, never 0 or negative. */
  readonly retryAfterSeconds: number;
}

interface Window {
  count: number;
  /** Epoch ms at which this window ends and the count is forgotten. */
  expiresAt: number;
}

export class FixedWindowCounter {
  readonly #windows = new Map<string, Window>();
  readonly #windowMs: number;

  /**
   * Sweep bookkeeping. Expired entries are dropped lazily on read, which is enough to
   * keep the count correct but not enough to keep the map from growing: an attacker
   * cycling keys they never revisit would leave one entry each, forever. So we also
   * sweep every `SWEEP_EVERY` writes — cheap, amortised, and with no timer to leak or
   * to keep the event loop alive in a test run.
   */
  static readonly #SWEEP_EVERY = 1_000;
  #writesSinceSweep = 0;

  constructor(windowSeconds: number) {
    if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
      throw new Error(`windowSeconds must be a positive number, got ${windowSeconds}`);
    }
    this.#windowMs = windowSeconds * 1000;
  }

  /**
   * Record one hit against `key` and report the bucket's state.
   *
   * `now` is a parameter rather than a call to `Date.now()` so that a test can walk the
   * clock past a window boundary without sleeping for it.
   */
  hit(key: string, now: number = Date.now()): WindowState {
    this.#maybeSweep(now);

    const existing = this.#windows.get(key);
    const window =
      existing !== undefined && existing.expiresAt > now
        ? existing
        : { count: 0, expiresAt: now + this.#windowMs };

    window.count += 1;
    this.#windows.set(key, window);

    return { count: window.count, retryAfterSeconds: secondsUntil(window.expiresAt, now) };
  }

  /**
   * Report `key`'s state without recording a hit.
   *
   * This is the read the request path takes *first*: whether the caller is already over
   * the line is decided before any work is done on their behalf, and a caller who is
   * over does not get their count pushed further out by the rejected attempt. Otherwise
   * a client hammering the endpoint would extend its own block indefinitely — and since
   * the only thing it is told is `Retry-After`, it would be obeying a number that its
   * own obedience keeps moving.
   */
  peek(key: string, now: number = Date.now()): WindowState {
    const window = this.#windows.get(key);
    if (window === undefined || window.expiresAt <= now) {
      return { count: 0, retryAfterSeconds: secondsUntil(now + this.#windowMs, now) };
    }
    return { count: window.count, retryAfterSeconds: secondsUntil(window.expiresAt, now) };
  }

  /** Forget `key` entirely. Used when a success should clear a failure count. */
  clear(key: string): void {
    this.#windows.delete(key);
  }

  /** Forget everything. Test-only, and the suite's `beforeEach` is its only caller. */
  reset(): void {
    this.#windows.clear();
    this.#writesSinceSweep = 0;
  }

  /** Live key count. Test-only: it is how the sweep is observed from outside. */
  get size(): number {
    return this.#windows.size;
  }

  #maybeSweep(now: number): void {
    this.#writesSinceSweep += 1;
    if (this.#writesSinceSweep < FixedWindowCounter.#SWEEP_EVERY) return;
    this.#writesSinceSweep = 0;
    for (const [key, window] of this.#windows) {
      if (window.expiresAt <= now) this.#windows.delete(key);
    }
  }
}

/**
 * Whole seconds from `now` until `expiresAt`, rounded up, floored at 1.
 *
 * Rounded up because a client that retried after the truncated value would arrive while
 * still blocked. Floored at 1 because `Retry-After: 0` reads as "go ahead now", which is
 * the one thing the header is there to prevent.
 */
function secondsUntil(expiresAt: number, now: number): number {
  return Math.max(1, Math.ceil((expiresAt - now) / 1000));
}
