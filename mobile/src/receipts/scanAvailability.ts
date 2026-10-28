/**
 * Whether this server can read receipts, as last heard. One `ocr_unavailable` answer is
 * enough to stop offering the button for the rest of the session: it means the server was never
 * set up for it, so asking again would only repeat the same refusal. A restart asks afresh,
 * which is how a server that gains the feature is noticed.
 */
let unavailable = false;

export function isScanUnavailable(): boolean {
  return unavailable;
}

export function markScanUnavailable(): void {
  unavailable = true;
}

export function resetScanAvailabilityForTests(): void {
  unavailable = false;
}
