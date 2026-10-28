/**
 * Turning the text an OCR provider read off a receipt into suggestions: amount, date,
 * merchant, category. `docs/design/11-receipt-scan.md` lists the rules; this file is them.
 *
 * Pure: text in, fields out, no network and no clock beyond the `today` it is handed. Anything
 * the text does not clearly say is `null`, because a wrong suggestion costs the person more
 * than a missing one - they will type a missing value and may not notice a wrong one.
 */

import { LIMITS } from '@expense-tracker/shared';

export const RECEIPT_CATEGORY_KEYS = [
  'groceries',
  'eating_out',
  'transport',
  'health',
  'bills',
] as const;
export type ReceiptCategoryKey = (typeof RECEIPT_CATEGORY_KEYS)[number];

export interface ParsedReceipt {
  readonly amountMinor: number | null;
  /** `YYYY-MM-DD`. */
  readonly date: string | null;
  readonly merchant: string | null;
  readonly category: ReceiptCategoryKey | null;
}

export interface ParseOptions {
  /** The account's currency: how many decimals an amount has, and which date order to prefer. */
  readonly currency: string;
  readonly today: Date;
}

const MAX_MERCHANT_LENGTH = 80;
/** A merchant name is near the top; further down it is an address, an item or a footer. */
const MERCHANT_SCAN_LINES = 8;

/** How many decimals this currency has: 0 for yen and dong, 3 for dinar, else 2. */
export function currencyExponent(currency: string): number {
  try {
    const { maximumFractionDigits } = new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
    }).resolvedOptions();
    return maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Lower-case, without accents, so `Tổng` and `tong` are the same word. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

// --- Amount -----------------------------------------------------------------------------

const TOTAL_LABEL = /\b(total|amount due|balance due|grand total|tong cong|tong|thanh toan)\b/;
const NOT_A_TOTAL = /sub\s*-?\s*total|\btax\b|\bvat\b|\bchange\b|\bcash\b|tender|\btip\b|discount/;
const NUMBER_TOKEN = /\d[\d.,]*\d|\d/g;

/**
 * One printed number as minor units, or null when it does not read as an amount.
 *
 * The decimal separator is the last `.` or `,` when exactly the currency's number of decimals
 * (or fewer, with only one separator) follow it; otherwise every separator is a thousands
 * mark. That is what makes `1.234,50`, `1,234.50` and `150.000` all come out right.
 */
function toMinor(token: string, exponent: number): number | null {
  const lastSeparator = Math.max(token.lastIndexOf('.'), token.lastIndexOf(','));
  let whole: string;
  let fraction = '';
  if (lastSeparator === -1) {
    whole = token;
  } else {
    const after = token.slice(lastSeparator + 1);
    const before = token.slice(0, lastSeparator);
    const hasOtherSeparator = /[.,]/.test(before);
    const isDecimal =
      exponent > 0 &&
      after.length > 0 &&
      (after.length === exponent || (after.length < exponent && !hasOtherSeparator));
    if (isDecimal) {
      whole = before;
      fraction = after;
    } else {
      whole = token;
    }
  }
  // What is left of the point may only have thousands marks, in groups of exactly three.
  if (/[.,]/.test(whole) && !/^\d{1,3}([.,]\d{3})+$/.test(whole)) return null;
  const digits = whole.replace(/[.,]/g, '');
  if (digits.length === 0 || digits.length > 12) return null;
  const minor = Number(digits) * 10 ** exponent + Number(fraction.padEnd(exponent, '0') || 0);
  return Number.isSafeInteger(minor) && minor <= LIMITS.AMOUNT_MINOR_MAX ? minor : null;
}

function moneyTokens(line: string, exponent: number): number[] {
  const found: number[] = [];
  for (const match of line.matchAll(NUMBER_TOKEN)) {
    const minor = toMinor(match[0], exponent);
    if (minor !== null) found.push(minor);
  }
  return found;
}

/** Does a token read as money without a label: printed with decimals (or grouped, in yen). */
function looksLikeMoney(token: string, exponent: number): boolean {
  if (exponent > 0) return new RegExp(`[.,]\\d{${exponent}}$`).test(token);
  return /^\d{1,3}([.,]\d{3})+$/.test(token);
}

function parseAmount(lines: readonly string[], exponent: number): number | null {
  const folded = lines.map(fold);

  let chosen: number | null = null;
  folded.forEach((line, index) => {
    if (!TOTAL_LABEL.test(line) || NOT_A_TOTAL.test(line)) return;
    const onLine = moneyTokens(line, exponent);
    // The amount sits at the right end of its line; a label alone means it is on the next one.
    const value =
      onLine.length > 0
        ? onLine[onLine.length - 1]
        : moneyTokens(folded[index + 1] ?? '', exponent)[0];
    if (value !== undefined) chosen = value;
  });
  if (chosen !== null) return chosen > 0 ? chosen : null;

  // No total line: the largest printed amount on the page.
  let largest = 0;
  for (const line of folded) {
    for (const match of line.matchAll(NUMBER_TOKEN)) {
      if (!looksLikeMoney(match[0], exponent)) continue;
      const minor = toMinor(match[0], exponent);
      if (minor !== null && minor > largest) largest = minor;
    }
  }
  return largest > 0 ? largest : null;
}

// --- Date -------------------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAME = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function fullYear(text: string): number {
  const year = Number(text);
  return text.length === 2 ? 2000 + year : year;
}

/** Every date the text mentions, in the order it appears. */
function dateCandidates(text: string, monthFirst: boolean): string[] {
  type Found = { index: number; iso: string | null };
  const found: Found[] = [];
  const add = (index: number, iso: string | null) => found.push({ index, iso });

  for (const m of text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    add(m.index, isoDate(Number(m[1]), Number(m[2]), Number(m[3])));
  }
  for (const m of text.matchAll(/(?<![\d./-])(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?![\d])/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = fullYear(m[3] ?? '');
    const asMonthFirst = a > 12 ? false : b > 12 ? true : monthFirst;
    add(m.index, asMonthFirst ? isoDate(year, a, b) : isoDate(year, b, a));
  }
  for (const m of text.matchAll(
    new RegExp(`\\b(\\d{1,2})[ -]${MONTH_NAME}[ ,-]+(\\d{4})\\b`, 'g'),
  )) {
    add(m.index, isoDate(Number(m[3]), MONTHS.indexOf(m[2] ?? '') + 1, Number(m[1])));
  }
  for (const m of text.matchAll(
    new RegExp(`\\b${MONTH_NAME}\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'g'),
  )) {
    add(m.index, isoDate(Number(m[3]), MONTHS.indexOf(m[1] ?? '') + 1, Number(m[2])));
  }
  return found
    .sort((x, y) => x.index - y.index)
    .flatMap((entry) => (entry.iso === null ? [] : [entry.iso]));
}

function parseDate(text: string, currency: string, today: Date): string | null {
  const monthFirst = currency.toUpperCase() === 'USD';
  const latest = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const earliestDate = new Date(today);
  earliestDate.setUTCFullYear(earliestDate.getUTCFullYear() - 2);
  const earliest = earliestDate.toISOString().slice(0, 10);
  return (
    dateCandidates(fold(text), monthFirst).find((iso) => iso >= earliest && iso <= latest) ?? null
  );
}

// --- Merchant ---------------------------------------------------------------------------

const BOILERPLATE =
  /^(receipt|invoice|tel|telephone|phone|fax|www|http|thank|welcome|order|date|time|cashier|table|tax invoice|hoa don)\b|www\.|@|\.com\b/i;

function parseMerchant(lines: readonly string[]): string | null {
  for (const line of lines.slice(0, MERCHANT_SCAN_LINES)) {
    const compact = line.replace(/\s+/g, ' ').trim();
    if (BOILERPLATE.test(fold(compact))) continue;
    const visible = compact.replace(/\s/g, '');
    const letters = (compact.match(/\p{L}/gu) ?? []).length;
    if (letters < 3 || letters / visible.length < 0.6) continue;
    if (TOTAL_LABEL.test(fold(compact))) continue;
    return compact.replace(/[\s:;,.-]+$/, '').slice(0, MAX_MERCHANT_LENGTH);
  }
  return null;
}

// --- Category ---------------------------------------------------------------------------

const KEYWORDS: Readonly<Record<ReceiptCategoryKey, readonly string[]>> = {
  groceries: [
    'supermarket',
    'hypermarket',
    'minimart',
    'grocery',
    'groceries',
    'mart',
    'market',
    'costco',
    'walmart',
    'aldi',
    'lidl',
    'tesco',
  ],
  eating_out: [
    'restaurant',
    'cafe',
    'coffee',
    'pizza',
    'burger',
    'bistro',
    'diner',
    'grill',
    'kitchen',
    'bakery',
    'bar',
    'pub',
    'noodle',
    'pho',
    'sushi',
    'bbq',
  ],
  transport: [
    'taxi',
    'uber',
    'grab',
    'lyft',
    'fuel',
    'petrol',
    'gasoline',
    'gas',
    'parking',
    'toll',
    'subway',
    'airline',
  ],
  health: [
    'pharmacy',
    'drugstore',
    'clinic',
    'hospital',
    'dental',
    'dentist',
    'medical',
    'doctor',
    'optical',
  ],
  bills: [
    'electric',
    'electricity',
    'water',
    'internet',
    'telecom',
    'broadband',
    'utility',
    'utilities',
    'insurance',
  ],
};

function parseCategory(text: string): ReceiptCategoryKey | null {
  const folded = fold(text);
  let best: ReceiptCategoryKey | null = null;
  let bestCount = 0;
  // Priority is the declaration order, so a tie goes to the more specific, earlier key.
  for (const key of RECEIPT_CATEGORY_KEYS) {
    const count = KEYWORDS[key].filter((word) => new RegExp(`\\b${word}\\b`).test(folded)).length;
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

// --- Entry point ------------------------------------------------------------------------

export function parseReceiptText(text: string, options: ParseOptions): ParsedReceipt {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const exponent = currencyExponent(options.currency);
  return {
    amountMinor: parseAmount(lines, exponent),
    date: parseDate(text, options.currency, options.today),
    merchant: parseMerchant(lines),
    category: parseCategory(text),
  };
}
