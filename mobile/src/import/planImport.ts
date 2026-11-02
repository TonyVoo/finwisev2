import { LIMITS } from '@expense-tracker/shared';

/**
 * Turns the rows of a CSV into entries to add, and says what was left out and why
 * (`docs/design/21-import.md`). Pure: no database, no clock. Our own export reads back exactly; other files are
 * read by their column names (Date, Amount, Category, Note / Memo / Description, Currency, Type), in any order.
 */

export interface ImportCategory {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
}

export interface ImportContext {
  readonly homeCurrency: string;
  readonly decimalsFor: (currency: string) => number;
  readonly categories: readonly ImportCategory[];
  /** `importKey` of every entry already on the phone, so a file imported twice adds nothing the second time. */
  readonly existingKeys: ReadonlySet<string>;
}

export interface ImportEntry {
  readonly categoryId: string;
  readonly kind: 'expense' | 'income';
  readonly amountMinor: number;
  readonly currency: string;
  readonly date: string;
  readonly note: string | null;
  readonly originalAmountMinor?: number;
  readonly originalCurrency?: string;
}

export type SkipReason = 'date' | 'amount' | 'currency' | 'duplicate';

export interface ImportPlan {
  readonly entries: readonly ImportEntry[];
  /** `importKey` of each entry, in the same order. */
  readonly keys: readonly string[];
  readonly skipped: Partial<Record<SkipReason, number>>;
  /** Rows whose category is not one of the person's, filed under the default one. */
  readonly unmatchedCategories: number;
  /** Why nothing can be imported at all. */
  readonly problem?: 'empty' | 'columns' | 'tooMany';
}

export const MAX_IMPORT_ROWS = 2000;

const COLUMNS = {
  date: ['date', 'day', 'ngay', 'ngày'],
  amount: ['amount', 'value', 'so tien', 'số tiền', 'sotien'],
  currency: ['currency', 'tien te', 'tiền tệ'],
  category: ['category', 'danh muc', 'danh mục'],
  note: ['note', 'notes', 'memo', 'description', 'details', 'ghi chu', 'ghi chú', 'mo ta', 'mô tả'],
  type: ['type', 'kind', 'loai', 'loại'],
  originalAmount: ['original amount'],
  originalCurrency: ['original currency'],
} as const;

export function importKey(entry: {
  date: string;
  amountMinor: number;
  currency: string;
  kind: string;
  note: string | null;
}): string {
  return `${entry.date}|${entry.amountMinor}|${entry.currency}|${entry.kind}|${(entry.note ?? '').trim().toLowerCase()}`;
}

function findColumn(header: readonly string[], names: readonly string[]): number {
  return header.findIndex((cell) => names.includes(cell.trim().toLowerCase()));
}

function validDate(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** `2026-10-05`, `2026/10/05`, or day-first `05/10/2026` (month-first only when the day cannot be the first number). */
export function parseDate(text: string): string | null {
  const value = text.trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|[T\s])/.exec(value);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:$|[T\s])/.exec(value);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return b > 12 && a <= 12 ? validDate(Number(m[3]), a, b) : validDate(Number(m[3]), b, a);
  }
  return null;
}

/** An amount as written by people and banks, in whole minor units of a currency with `decimals` places. */
export function parseAmount(text: string, decimals: number): number | null {
  const cleaned = text.replace(/[^\d.,]/g, '');
  if (cleaned === '' || !/\d/.test(cleaned)) return null;
  let whole = cleaned;
  let fraction = '';
  const last = Math.max(cleaned.lastIndexOf('.'), cleaned.lastIndexOf(','));
  if (last >= 0 && decimals > 0) {
    const after = cleaned.length - last - 1;
    if (after >= 1 && after <= decimals) {
      whole = cleaned.slice(0, last);
      fraction = cleaned.slice(last + 1);
    }
  }
  const digits = whole.replace(/[.,]/g, '');
  const minor = Number(`${digits === '' ? '0' : digits}${fraction.padEnd(decimals, '0')}`);
  return Number.isSafeInteger(minor) ? minor : null;
}

function cleanNote(text: string): string | null {
  // The export puts an apostrophe before text a spreadsheet would run as a formula.
  const note = text.trim().replace(/^'(?=[=+\-@\t\r])/, '');
  return note === '' ? null : note.slice(0, LIMITS.EXPENSE_NOTE_MAX);
}

export function planImport(
  rows: readonly (readonly string[])[],
  context: ImportContext,
): ImportPlan {
  const none = { entries: [], keys: [], skipped: {}, unmatchedCategories: 0 } as const;
  if (rows.length < 2) return { ...none, problem: 'empty' };

  const header = rows[0] ?? [];
  const col = {
    date: findColumn(header, COLUMNS.date),
    amount: findColumn(header, COLUMNS.amount),
    currency: findColumn(header, COLUMNS.currency),
    category: findColumn(header, COLUMNS.category),
    note: findColumn(header, COLUMNS.note),
    type: findColumn(header, COLUMNS.type),
    originalAmount: findColumn(header, COLUMNS.originalAmount),
    originalCurrency: findColumn(header, COLUMNS.originalCurrency),
  };
  if (col.date < 0 || col.amount < 0) return { ...none, problem: 'columns' };
  if (rows.length - 1 > MAX_IMPORT_ROWS) return { ...none, problem: 'tooMany' };

  const byName = new Map(context.categories.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const fallback =
    context.categories.find((c) => c.isDefault)?.id ?? context.categories[0]?.id ?? '';

  const entries: ImportEntry[] = [];
  const keys: string[] = [];
  const skipped: Partial<Record<SkipReason, number>> = {};
  let unmatchedCategories = 0;
  const skip = (reason: SkipReason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };
  const cell = (row: readonly string[], index: number) => (index < 0 ? '' : (row[index] ?? ''));

  for (const row of rows.slice(1)) {
    if (row.every((value) => value.trim() === '')) continue;

    const date = parseDate(cell(row, col.date));
    if (date === null) {
      skip('date');
      continue;
    }
    const currency = cell(row, col.currency).trim().toUpperCase() || context.homeCurrency;
    if (currency !== context.homeCurrency) {
      skip('currency');
      continue;
    }
    const amountMinor = parseAmount(cell(row, col.amount), context.decimalsFor(currency));
    if (amountMinor === null || amountMinor < 1 || amountMinor > LIMITS.AMOUNT_MINOR_MAX) {
      skip('amount');
      continue;
    }

    const typeText = cell(row, col.type).trim().toLowerCase();
    const kind = ['income', 'thu', 'thu nhập', 'in'].includes(typeText) ? 'income' : 'expense';

    const categoryText = cell(row, col.category).trim().toLowerCase();
    let categoryId = byName.get(categoryText);
    if (categoryId === undefined) {
      categoryId = fallback;
      if (categoryText !== '') unmatchedCategories += 1;
    }

    const originalCurrency = cell(row, col.originalCurrency).trim().toUpperCase();
    const originalMinor =
      originalCurrency !== '' && originalCurrency !== currency
        ? parseAmount(cell(row, col.originalAmount), context.decimalsFor(originalCurrency))
        : null;

    const entry: ImportEntry = {
      categoryId,
      kind,
      amountMinor,
      currency,
      date,
      note: cleanNote(cell(row, col.note)),
      ...(originalMinor !== null && originalMinor >= 1 && originalMinor <= LIMITS.AMOUNT_MINOR_MAX
        ? { originalAmountMinor: originalMinor, originalCurrency }
        : {}),
    };
    const key = importKey(entry);
    if (context.existingKeys.has(key)) {
      skip('duplicate');
      continue;
    }
    entries.push(entry);
    keys.push(key);
  }
  return { entries, keys, skipped, unmatchedCategories };
}
