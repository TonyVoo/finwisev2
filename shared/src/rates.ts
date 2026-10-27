import { z } from 'zod';
import { CalendarDate, CurrencyCode } from './primitives.js';

/**
 * An exchange rate, fetched by the server from a free public provider and handed to the
 * device, which uses it to convert a foreign expense at entry.
 *
 * The rate is a **decimal string**, never a number: it is multiplied with an integer amount
 * on the device, and a float there is exactly where money first goes wrong. Positive, plain
 * decimal notation (no exponent), at most eight places.
 */

export const RATE_PATTERN = /^(?:[1-9]\d{0,8}|0)(?:\.\d{1,8})?$/;

export const RateString = z
  .string()
  .regex(RATE_PATTERN, 'must be a plain positive decimal with at most 8 places')
  .refine((value) => /[1-9]/.test(value), { error: 'must be greater than zero' })
  .describe(
    'Units of `to` per one unit of `from`, as a decimal string such as "1.0823". Never a float, never an exponent.',
  );

export const RatesQuery = z
  .strictObject({
    from: CurrencyCode.describe('The currency the amount was paid in.'),
    to: CurrencyCode.describe("The currency to convert into: the account's own."),
    date: CalendarDate.optional().describe(
      'Day to price. Omit for the latest rate. The provider prices the last business day on or before it, and the answer says which.',
    ),
  })
  .refine((v) => v.from !== v.to, { error: '`from` and `to` must differ', path: ['to'] });

export const ExchangeRate = z.strictObject({
  from: CurrencyCode,
  to: CurrencyCode,
  date: CalendarDate.describe(
    'The day the provider actually priced, which may be earlier than asked.',
  ),
  rate: RateString,
});

export const RatesResponse = z.strictObject({ data: ExchangeRate });

export type RatesQuery = z.infer<typeof RatesQuery>;
export type ExchangeRate = z.infer<typeof ExchangeRate>;
export type RatesResponse = z.infer<typeof RatesResponse>;
