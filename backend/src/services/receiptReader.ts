/**
 * The model-side contract for reading a receipt photo: what a reader is handed and the one
 * failure it can name. Kept apart from the strategies so a provider adapter and the strategy
 * list can both import it without importing each other.
 */

export interface ScanContext {
  /** The account's currency. */
  readonly currency: string;
  readonly today: Date;
}

/** A model that looks at a photo and answers with the fields, as untrusted JSON. */
export interface ReceiptReader {
  readReceipt(image: Uint8Array, context: ScanContext): Promise<unknown>;
}

/** A reader throws this when the provider says the daily quota is gone, so the rest of the day is skipped. */
export class ReaderQuotaError extends Error {
  override readonly name = 'ReaderQuotaError';
  constructor() {
    super('provider quota used up');
  }
}
