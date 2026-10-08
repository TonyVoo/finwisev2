/**
 * The one place the app reads the wall clock.
 *
 * Every local write stamps `updatedAt`, and last-write-wins resolves on it
 * (`docs/PLAN.md` §4). Routing that through an injectable function means the write
 * helper and the sync engine can be tested against a fixed clock instead of
 * sleeping, and it documents that `updatedAt` is deliberately the *client's* idea
 * of when the user made the edit — the server clamps it to `now + 5min` rather
 * than replacing it.
 */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

/** `updatedAt` / `deletedAt` wire format: RFC 3339 with an explicit UTC offset. */
export function toTimestamp(at: Date): string {
  return at.toISOString();
}

/**
 * The `date` of an expense is a calendar date in the user's **local** timezone:
 * the day they assign to it. `toISOString().slice(0, 10)` would be wrong — it
 * converts to UTC first, so an expense added at 9pm in UTC+3 would land on the
 * following day.
 */
export function toCalendarDate(at: Date): string {
  const year = at.getFullYear().toString().padStart(4, '0');
  const month = (at.getMonth() + 1).toString().padStart(2, '0');
  const day = at.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}
