/**
 * When the app locks itself. Pure: no clock, no AppState, no native module.
 *
 * It locks on a cold start, and again on returning from the background after a short grace
 * period. The grace period is the point: switching to Messages to copy a number and coming
 * straight back must not cost a Face ID scan every time, while leaving the phone on a table
 * for a minute should. `inactive` (Control Centre, a notification banner, the app switcher
 * peeking) is never counted - only a real trip to the background is.
 */

/** How long the app may be in the background before it asks again. */
export const LOCK_AFTER_MS = 30_000;

export function shouldLockOnReturn(
  enabled: boolean,
  backgroundedAt: number | null,
  now: number,
  graceMs: number = LOCK_AFTER_MS,
): boolean {
  if (!enabled || backgroundedAt === null) return false;
  return now - backgroundedAt >= graceMs;
}
