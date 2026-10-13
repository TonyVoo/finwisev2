/**
 * The currencies signup offers.
 *
 * `docs/design/03-auth.md` §1.2 rule 8 fixes both the list and the fact that it is a
 * list: "The MVP offers a fixed list, not an ISO 4217 search." Ten codes, in the order
 * the sheet lays them out, rendered as `{code} - {name}`.
 *
 * It is a closed set for a reason beyond the picker. The currency is captured once at
 * signup and cannot be changed, and it decides how every amount in the app is formatted -
 * including whether the keypad has a decimal key, because `JPY` has no minor unit
 * (`06-expense-form.md` §Behaviour rule 3). A free-text or searchable field would let a
 * user pick a currency the app has never rendered, permanently.
 *
 * **The names are not in the copy deck.** `09-copy-deck.md` has no rows for them and
 * `03-auth.md` specifies only `USD - US Dollar`, so the other nine are written here and
 * are the one set of user-visible strings in the app that the Designer has not signed
 * off. Worth a deck row each; flagged on `TVO-10` rather than quietly invented and
 * forgotten. The *codes* are contract data, so those are not a judgement call.
 *
 * Not derived from `Intl.DisplayNames`. It would be locale-aware, which sounds better
 * until you remember the app runs on Hermes, where `Intl` coverage is a property of the
 * OS version - so the picker's labels would vary by device, and on a thin ICU build some
 * rows would read `USD - USD`.
 */

export interface CurrencyOption {
  /** ISO 4217 alphabetic code, as the contract's `CurrencyCode` requires. */
  readonly code: string;
  readonly name: string;
}

export const CURRENCY_OPTIONS: readonly CurrencyOption[] = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'MXN', name: 'Mexican Peso' },
];

/**
 * What signup starts on.
 *
 * Deliberately not imported from the contract's `DEFAULT_CURRENCY`, even though both are
 * `USD`: that constant is what the *server* applies when the field is omitted, and this
 * is what the *form* is prefilled with. They agree today, and a test asserts they still
 * do - if the server's default ever changes, the prefilled row would otherwise go on
 * quietly disagreeing with what an omitted field would have produced.
 */
export const DEFAULT_CURRENCY_CODE = 'USD';

/** The `{code} - {name}` label the select row and the sheet rows both render. */
export function currencyLabel(code: string): string {
  const option = CURRENCY_OPTIONS.find((candidate) => candidate.code === code);
  // An unknown code still renders as itself rather than as a blank row. It cannot come
  // from the picker, but it can come from a `user` row written by a future version that
  // offers more currencies than this one.
  return option === undefined ? code : `${option.code} - ${option.name}`;
}

/**
 * The accessible name for the select row: `Currency, USD US Dollar. Double tap to change.`
 *
 * The hyphen is dropped on purpose (`03-auth.md` §1.2 element 11). A screen reader reads
 * `USD - US Dollar` as "USD minus US Dollar" or "USD dash US Dollar", neither of which is
 * what the row says.
 */
export function currencyAccessibilityLabel(code: string, fieldLabel: string): string {
  const option = CURRENCY_OPTIONS.find((candidate) => candidate.code === code);
  const spoken = option === undefined ? code : `${option.code} ${option.name}`;
  return `${fieldLabel}, ${spoken}. Double tap to change.`;
}
