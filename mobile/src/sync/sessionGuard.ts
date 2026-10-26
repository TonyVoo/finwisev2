/**
 * Keeps a sync pass inside the session it started in (`TVO-20`).
 *
 * A pass reads rows, makes a request, and writes the answer back, and each of those awaits.
 * On a shared device the user can log out and a second user can log in between any two of
 * them. Three things go wrong if the pass carries on regardless:
 *
 * - the **request** goes out with user A's body under user B's token - the cross-tenant
 *   write. `api/authorize.ts` stops the *retry* of that; this stops the first send, whose
 *   body was read from SQLite before the switch and held in memory across it;
 * - the **response** for A's request is written into B's freshly wiped database;
 * - the **outbox deletes** that follow a push remove entries by `seq` from a table that now
 *   belongs to someone else.
 *
 * So each pass captures the session epoch once, when it begins, and asserts it is still
 * current immediately before every request and every write. The epoch moves in
 * `SessionController.discard` *before* the local wipe, which is what makes an assertion made
 * inside a transaction sufficient: a transaction that began after the wipe began has already
 * seen the epoch move.
 *
 * Throwing, rather than returning a flag, is deliberate: there is no half-way state worth
 * continuing in, and every caller above already has to unwind from a transport failure.
 */

/** The one member of the session controller a sync pass needs. */
export interface EpochSource {
  getEpoch(): number;
}

export interface SessionGuard {
  /** Throws {@link SessionChangedError} if the session has changed since capture. */
  assertCurrent(): void;
}

/** The session changed under a sync pass. Not a failure: the next pass is already due. */
export class SessionChangedError extends Error {
  constructor() {
    super('The session changed during a sync; the pass was abandoned without writing.');
    this.name = 'SessionChangedError';
  }
}

/** Capture the current session; the returned guard is valid for one pass. */
export function captureSession(source: EpochSource): SessionGuard {
  const epoch = source.getEpoch();
  return {
    assertCurrent() {
      if (source.getEpoch() !== epoch) throw new SessionChangedError();
    },
  };
}
