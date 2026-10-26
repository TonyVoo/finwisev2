/**
 * The CSV the Settings screen exports: every live expense, one per row.
 *
 * This is a **machine format**, not a screen. `lib/money.ts` formats for a person in the
 * device locale (`1.234,50 €`); a spreadsheet wants `1234.50`, and a file that changes
 * shape depending on the phone's language setting is a file nobody can script against.
 * So amounts are plain decimals with a `.` separator and no symbol, the currency is its
 * own column, and dates are the calendar `YYYY-MM-DD` the database already holds.
 *
 * The rules below are each a way a naive exporter produces a file that opens wrong:
 *
 * - **Amounts are built from the integer.** Dividing `amountMinor` by 100 in floating
 *   point is exactly the arithmetic the app stores integers to avoid. The whole and
 *   fractional parts come from integer division and a padded remainder.
 * - **RFC 4180 quoting.** A field holding a comma, a double quote or a line break is
 *   wrapped in quotes with the quotes doubled. Notes are free text, so all three occur.
 * - **CRLF between records**, as the RFC says, which every spreadsheet reads and which
 *   survives being opened in Notepad.
 * - **A UTF-8 byte-order mark first.** Excel guesses an encoding for a BOM-less file and
 *   guesses the system code page, turning `Café` into `CafÃ©`. The BOM costs three
 *   bytes and every other reader ignores it.
 * - **Formula injection is neutralised.** A note of `=HYPERLINK(...)` or `+cmd|...` is
 *   executed as a formula by Excel and Sheets on open. Text fields that start with
 *   `=`, `+`, `-`, `@`, a tab or a carriage return get a leading apostrophe, which
 *   spreadsheets render as nothing and treat as "this is text". Amounts are generated
 *   here and never user text, so they are not touched - and a `-` on a refund would
 *   otherwise be broken by the same rule.
 */

export interface ExportExpense {
  /** Calendar date, `YYYY-MM-DD`. */
  readonly date: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly categoryName: string;
  readonly note: string | null;
}

export const CSV_HEADER = ['Date', 'Amount', 'Currency', 'Category', 'Note'] as const;

const BOM = '﻿';
const EOL = '\r\n';

/** `1250`, 2 -> `12.50`; `5`, 2 -> `0.05`; `1250`, 0 -> `1250`. Integer arithmetic only. */
export function plainAmount(amountMinor: number, decimals: number): string {
  const negative = amountMinor < 0;
  const magnitude = Math.abs(amountMinor);
  const scale = 10 ** decimals;
  const whole = Math.trunc(magnitude / scale);
  const text =
    decimals === 0
      ? String(whole)
      : `${whole}.${String(magnitude % scale).padStart(decimals, '0')}`;
  return negative ? `-${text}` : text;
}

/** Text a spreadsheet would otherwise run as a formula. */
const FORMULA_LEADERS = /^[=+\-@\t\r]/;

/** Quote a field if it needs it, after defusing a leading formula character. */
export function csvText(value: string): string {
  const safe = FORMULA_LEADERS.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** The whole file as a string: BOM, header, then one record per expense in the order given. */
export function buildExpensesCsv(
  expenses: readonly ExportExpense[],
  decimalsFor: (currency: string) => number,
): string {
  const records = expenses.map((expense) =>
    [
      expense.date,
      plainAmount(expense.amountMinor, decimalsFor(expense.currency)),
      csvText(expense.currency),
      csvText(expense.categoryName),
      csvText(expense.note ?? ''),
    ].join(','),
  );
  return BOM + [CSV_HEADER.join(','), ...records].join(EOL) + EOL;
}

/** `expenses-2026-10-26.csv`, from the local calendar date. */
export function exportFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `expenses-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
}
