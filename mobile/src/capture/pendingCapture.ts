/**
 * The detected payment waiting for the Add expense form it opens - held in memory, like the stashed receipt photo
 * (`src/receipts/pendingPhoto.ts`): read once while the form starts, cleared by it, replaced by a newer one.
 */
export interface PendingCapture {
  readonly id: string;
  readonly kind: 'expense' | 'income';
  readonly amountMinor: number;
  readonly currency: string;
  readonly note: string | null;
  /** `YYYY-MM-DD`: the day the notification arrived. */
  readonly date: string;
}

let stashed: PendingCapture | null = null;

export function stashCapture(capture: PendingCapture): void {
  stashed = capture;
}

export function peekCapture(): PendingCapture | null {
  return stashed;
}

export function clearCapture(): void {
  stashed = null;
}
