import { LIMITS } from '@expense-tracker/shared';

/**
 * Converting an amount between currencies, in integers.
 *
 * A rate is a decimal **string**. It is scaled to an integer (`"1.0823"` -> 10823 with 4
 * places) and the whole calculation runs in `BigInt`, so no step touches a float: the product
 * of a stored amount and a rate is exactly where a double first goes wrong (`1.005 * 100` is
 * `100.49999999999999`, which rounds the wrong way). Rounding is half up, on the exact result.
 *
 * Amounts are minor units, so two currencies with different minor units (JPY has none, USD
 * has two) need their decimals to line up; that is what `fromDecimals` and `toDecimals` are.
 */

/** Plain positive decimal, at most 8 places - what the server sends and what a person types. */
const RATE_TEXT = /^(\d+)(?:\.(\d{1,8}))?$/;

interface ScaledRate {
  /** The rate times 10^places, as an integer. */
  readonly scaled: bigint;
  readonly places: number;
}

function scaleRate(text: string): ScaledRate | null {
  const match = RATE_TEXT.exec(text.trim());
  if (match === null) return null;
  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  const scaled = BigInt(`${whole}${fraction}`);
  return scaled === 0n ? null : { scaled, places: fraction.length };
}

/** Whether `text` is a usable rate: positive, plain decimal, at most 8 places. */
export function isValidRate(text: string): boolean {
  return scaleRate(text) !== null;
}

export interface ConvertArgs {
  readonly amountMinor: number;
  readonly fromDecimals: number;
  readonly toDecimals: number;
  readonly rate: string;
}

/**
 * `amountMinor` in the source currency, as minor units of the target. Null when the rate is
 * not valid, or when the result would exceed the largest amount the contract can store.
 */
export function convertMinor({
  amountMinor,
  fromDecimals,
  toDecimals,
  rate,
}: ConvertArgs): number | null {
  const scaled = scaleRate(rate);
  if (scaled === null) return null;

  // home = amount / 10^from * rate * 10^to, with the rate held as scaled / 10^places.
  const numerator = BigInt(amountMinor) * scaled.scaled * 10n ** BigInt(toDecimals);
  const denominator = 10n ** BigInt(scaled.places + fromDecimals);
  const rounded = (2n * numerator + denominator) / (2n * denominator);

  return rounded > BigInt(LIMITS.AMOUNT_MINOR_MAX) ? null : Number(rounded);
}

export interface ImpliedRateArgs {
  readonly originalMinor: number;
  readonly originalDecimals: number;
  readonly homeMinor: number;
  readonly homeDecimals: number;
}

const IMPLIED_PLACES = 8;

/**
 * The rate two stored amounts imply, as a decimal string with trailing zeros trimmed. Used
 * when an expense is reopened: only the two amounts are stored, not the rate that made them,
 * so the rate shown for editing is worked back out. Null when there is no original amount.
 */
export function impliedRate({
  originalMinor,
  originalDecimals,
  homeMinor,
  homeDecimals,
}: ImpliedRateArgs): string | null {
  if (originalMinor <= 0) return null;

  // rate = (home / 10^homeDec) / (original / 10^origDec), rounded at 8 places.
  const numerator = BigInt(homeMinor) * 10n ** BigInt(originalDecimals + IMPLIED_PLACES);
  const denominator = BigInt(originalMinor) * 10n ** BigInt(homeDecimals);
  const scaled = (2n * numerator + denominator) / (2n * denominator);

  const digits = scaled.toString().padStart(IMPLIED_PLACES + 1, '0');
  const whole = digits.slice(0, -IMPLIED_PLACES);
  const fraction = digits.slice(-IMPLIED_PLACES).replace(/0+$/, '');
  return fraction === '' ? whole : `${whole}.${fraction}`;
}
