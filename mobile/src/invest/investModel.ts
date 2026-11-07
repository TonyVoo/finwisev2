import { getActiveIntlLocale } from '../i18n/language';
import { formatMoney } from '../lib/money';

/**
 * The Investing tab's pure parts: reading what the person typed, and checking it before it
 * is sent. Prices are whole dong, so a typed amount is digits only; `1.250.000`, `1,250,000`
 * and `1 250 000` all read as 1250000 and nothing here ever parses a decimal.
 */

export const SYMBOL_PATTERN = /^[A-Z0-9]{1,10}$/;

/** What the person typed as a ticker, ready to send: trimmed and upper-cased. Null if it is not one. */
export function cleanSymbol(text: string): string | null {
  const symbol = text.trim().toUpperCase();
  return SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

/** Whole dong from typed text: digits only, any separator ignored. Null when there is nothing positive. */
export function parseWhole(text: string): number | null {
  const digits = text.replace(/\D/g, '');
  if (digits === '' || digits.length > 13) return null;
  const value = Number(digits);
  return value > 0 ? value : null;
}

export type CalcProblem = 'enterAll' | 'stopBelowEntry' | 'tooLarge';

/** The contract's ceilings: a price per share, and the capital behind it. */
export const MAX_PRICE = 1_000_000_000;
export const MAX_CAPITAL = 10_000_000_000_000;

export interface CalcInput {
  readonly capital: number;
  readonly entry: number;
  readonly stop: number;
}

/** The three numbers, or the one thing wrong with them. */
export function readCalc(
  capital: string,
  entry: string,
  stop: string,
):
  | { readonly ok: true; readonly input: CalcInput }
  | { readonly ok: false; readonly problem: CalcProblem } {
  const c = parseWhole(capital);
  const e = parseWhole(entry);
  const s = parseWhole(stop);
  if (c === null || e === null || s === null) return { ok: false, problem: 'enterAll' };
  if (e > MAX_PRICE || s > MAX_PRICE || c > MAX_CAPITAL) return { ok: false, problem: 'tooLarge' };
  if (s >= e) return { ok: false, problem: 'stopBelowEntry' };
  return { ok: true, input: { capital: c, entry: e, stop: s } };
}

/** A fraction as a percentage with at most one decimal and a sign for movement: `0.0053` is `+0.5%`. */
export function formatChange(fraction: number | null): string {
  if (fraction === null) return '';
  const pct = Math.round(fraction * 1000) / 10;
  const text = `${oneDecimal(Math.abs(pct))}%`;
  return pct > 0 ? `+${text}` : pct < 0 ? `-${text}` : text;
}

/** A fraction of capital as a plain percentage: `0.01277` is `1.3%`. */
export function formatShare(fraction: number): string {
  return `${oneDecimal(Math.round(fraction * 1000) / 10)}%`;
}

/** At most one decimal, in the phone's own number style, so a percentage and a price share one decimal mark. */
function oneDecimal(value: number): string {
  return new Intl.NumberFormat(getActiveIntlLocale() ?? undefined, {
    maximumFractionDigits: 1,
  }).format(value);
}

/** Whole dong, in the phone's money style. A price is a whole number of VND. */
export function formatDong(value: number): string {
  return formatMoney(Math.round(value), 'VND');
}

/** `formatDong` with a plus for a gain. */
export function formatSignedDong(value: number): string {
  return value > 0 ? `+${formatDong(value)}` : formatDong(value);
}

/** Fill `{name}` placeholders in a copy template. A placeholder with no value is left as written, so a gap shows in review. */
export function fillTemplate(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

/**
 * Digits only, grouped in thousands the way the phone writes numbers, as someone types a price: `1250000` reads as
 * `1,250,000` (or `1.250.000`) while it is still being entered. Anything that is not a digit is dropped, so a pasted
 * `₫1.250.000` is fine, and a value too long to be a real amount stops growing.
 */
export function groupDigits(text: string, locale?: string | null): string {
  const digits = text.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (digits === '') return '';
  const kept = digits.slice(0, 13);
  return new Intl.NumberFormat(locale ?? getActiveIntlLocale() ?? undefined, {
    maximumFractionDigits: 0,
  }).format(Number(kept));
}
