/**
 * Turning `amountMinor` into something a person reads.
 *
 * This module is the **only** place an integer number of minor units becomes a string,
 * and nothing here ever goes the other way. There is no `parseMoney`, deliberately: the
 * amount a user types is built by integer arithmetic on the keypad (`src/lib/amount.ts`),
 * never by parsing a formatted string back. A `parseFloat` anywhere on the path from the
 * keypad to SQLite is the bug this whole design exists to make unrepresentable
 * (`docs/design/06-expense-form.md` §Behaviour rule 2).
 *
 * Formatting is `Intl.NumberFormat` with the user's `currency` and the **device locale**
 * (`04-expense-list.md` §Behaviour rule 5). So the symbol, its position, and the group and
 * decimal separators are the locale's business, while the number of fraction digits is the
 * *currency's* — which is why `currencyDecimals` resolves rather than hardcoding 2
 * (`06-expense-form.md` §Behaviour rule 3; `JPY` has none).
 */

/**
 * How many minor digits the currency has, as the runtime reports it.
 *
 * Not a table in this file. A hardcoded `currency === 'JPY' ? 0 : 2` is wrong for every
 * zero-decimal currency that is not yen and for the three-decimal ones, and it would make
 * the keypad offer a decimal key the currency has no use for.
 */
export function currencyDecimals(currency: string, locale?: string): number {
  const resolved = formatterFor(currency, locale).resolvedOptions();
  // `maximumFractionDigits` is optional in the TypeScript lib because a runtime may omit
  // it. Falling back to 2 would quietly turn an Intl-less runtime into a two-decimal
  // currency, so the minor unit is derived from the formatter's own output instead.
  return resolved.maximumFractionDigits ?? countFractionDigits(formatterFor(currency, locale));
}

/**
 * Format minor units as money, e.g. `1250` + `USD` -> `$12.50`.
 *
 * `minimumFractionDigits` is pinned to the currency's decimals so a whole amount renders
 * as `$12.00` rather than `$12`, and so the zero total renders as `$0.00` rather than a
 * blank or a dash (`04-expense-list.md` §Behaviour rule 5).
 */
export function formatMoney(amountMinor: number, currency: string, locale?: string): string {
  const decimals = currencyDecimals(currency, locale);
  // Integer division, then a decimal string assembled from the two halves. Dividing by
  // 10 ** decimals in floating point first would reintroduce exactly the rounding this
  // app stores integers to avoid: 1_00_000_000_000_1 / 100 is not representable.
  return formatterFor(currency, locale).format(toFormattable(amountMinor, decimals));
}

/**
 * The same amount with no currency symbol — used where the symbol would be noise and the
 * currency is already established by context.
 */
export function formatAmountOnly(amountMinor: number, currency: string, locale?: string): string {
  const decimals = currencyDecimals(currency, locale);
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(toFormattable(amountMinor, decimals));
}

/**
 * Minor units as a value `Intl.NumberFormat` renders exactly.
 *
 * `Number` is a float, so a large `amountMinor` divided by `10 ** decimals` can land on a
 * neighbouring value. The maximum the contract allows (`999,999,999,999` minor units) is
 * well inside `Number.MAX_SAFE_INTEGER`, so the *integer* is always exact; the division is
 * the only lossy step, and it is done once on a value whose magnitude keeps it exact.
 * Anything larger — which can only arrive from a buggy or hostile peer by sync — is still
 * rendered rather than crashing (`06-expense-form.md` §Behaviour rule 8, last row).
 */
function toFormattable(amountMinor: number, decimals: number): number {
  if (decimals === 0) return amountMinor;
  return amountMinor / 10 ** decimals;
}

/**
 * `Intl.NumberFormat` construction is not cheap and the expense list formats one amount
 * per row plus the total on every render. One formatter per (locale, currency) pair.
 */
const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(currency: string, locale?: string): Intl.NumberFormat {
  const key = `${locale ?? ''}|${currency}`;
  const cached = formatters.get(key);
  if (cached !== undefined) return cached;

  const created = new Intl.NumberFormat(locale, { style: 'currency', currency });
  formatters.set(key, created);
  return created;
}

/**
 * Last-resort minor-unit count: format 1 and count the digits after the separator.
 *
 * Only reached on a runtime whose `resolvedOptions()` omits `maximumFractionDigits`. The
 * app runs on Hermes, where `Intl` is backed by the platform rather than by this repo, so
 * the possibility is real even though no supported OS version does it.
 */
function countFractionDigits(formatter: Intl.NumberFormat): number {
  const parts = formatter.formatToParts(1);
  const fraction = parts.find((part) => part.type === 'fraction');
  return fraction === undefined ? 0 : fraction.value.length;
}
