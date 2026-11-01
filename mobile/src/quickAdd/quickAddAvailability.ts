/**
 * Whether this server can read typed sentences, as last heard (`docs/design/15-quick-add.md`). One
 * `quick_add_unavailable` answer is enough to stop asking for the rest of the session: it means the server
 * was never set up for it, or its day's budget is spent, so asking again would only repeat the refusal. A
 * restart asks afresh, which is how a server that gains the feature is noticed.
 */
let unavailable = false;

export function isQuickAddUnavailable(): boolean {
  return unavailable;
}

export function markQuickAddUnavailable(): void {
  unavailable = true;
}

export function resetQuickAddAvailabilityForTests(): void {
  unavailable = false;
}
