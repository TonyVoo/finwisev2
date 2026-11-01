import type { QuickAddReading } from './parseQuickAdd';

/**
 * Whether to ask the server for help with a sentence (`docs/design/15-quick-add.md`). Only when the
 * phone's own rules were unsure: a sentence they understood never leaves the phone. And not while the
 * device is offline, or after the server has said it cannot, where asking would only wait and fail.
 */
export function shouldAskModel({
  reading,
  unavailable,
  offline,
}: {
  readonly reading: QuickAddReading;
  readonly unavailable: boolean;
  readonly offline: boolean;
}): boolean {
  return !reading.confident && !unavailable && !offline;
}
