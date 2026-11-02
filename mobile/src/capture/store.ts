import type { SqliteDatabase } from '../db/sqlite';
import { parseNotification, type RawNotification, CAPTURE_PACKAGES } from './parseNotification';

/**
 * What the phone has read from MoMo and ZaloPay, kept on the phone (`captured_payments`, never synced).
 *
 * Every notification from those two apps is kept briefly - payments as suggestions, the rest as `ignored` -
 * so the log can show what the phone is actually being sent and the parser can be corrected from it. Nothing
 * becomes an entry without the person adding it.
 */

export interface CapturedRow {
  readonly id: string;
  readonly source: string;
  readonly postTime: number;
  readonly title: string;
  readonly body: string;
  readonly direction: 'spend' | 'income' | null;
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly counterparty: string | null;
  readonly status: 'new' | 'added' | 'dismissed' | 'ignored';
  readonly expenseId: string | null;
}

/** A suggestion, plus whether an entry of the same amount already exists on the day it was paid. */
export interface Suggestion extends CapturedRow {
  readonly duplicate: boolean;
}

const KEEP_IGNORED_MS = 3 * 24 * 3600 * 1000;
const KEEP_HANDLED_MS = 30 * 24 * 3600 * 1000;

/** Reads each notification once: a payment becomes a suggestion, anything else is logged as ignored. Returns how many suggestions are new. */
export async function ingestNotifications(
  database: SqliteDatabase,
  notifications: readonly (RawNotification & { readonly key?: string })[],
): Promise<number> {
  let added = 0;
  for (const raw of notifications) {
    if (CAPTURE_PACKAGES[raw.packageName] === undefined) continue;
    const found = parseNotification(raw);
    const id = `${raw.packageName}|${raw.key ?? ''}|${raw.postTime}|${raw.title}|${raw.text}`;
    const result = await database.runAsync(
      `INSERT OR IGNORE INTO captured_payments
         (id, source, postTime, title, body, direction, amountMinor, currency, counterparty, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        CAPTURE_PACKAGES[raw.packageName] ?? raw.packageName,
        raw.postTime,
        raw.title,
        raw.text,
        found?.direction ?? null,
        found?.amountMinor ?? null,
        found?.currency ?? null,
        found?.counterparty ?? null,
        found === null ? 'ignored' : 'new',
      ],
    );
    if (found !== null && result.changes > 0) added += 1;
  }
  return added;
}

function toRow(row: Record<string, unknown>): CapturedRow {
  return row as unknown as CapturedRow;
}

/** The local calendar day of an instant, as `YYYY-MM-DD`. */
export function localDay(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Payments waiting to be added or dismissed, newest first. */
export async function listSuggestions(database: SqliteDatabase): Promise<readonly Suggestion[]> {
  const rows = await database.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM captured_payments WHERE status = 'new' ORDER BY postTime DESC`,
    [],
  );
  const result: Suggestion[] = [];
  for (const row of rows) {
    const captured = toRow(row);
    const duplicate =
      captured.amountMinor === null
        ? false
        : (
            await database.getFirstAsync<{ n: number }>(
              `SELECT count(*) AS n FROM expenses
              WHERE deletedAt IS NULL AND amountMinor = ? AND currency = ? AND date = ? AND kind = ?`,
              [
                captured.amountMinor,
                captured.currency,
                localDay(captured.postTime),
                captured.direction === 'income' ? 'income' : 'expense',
              ],
            )
          )?.n !== 0;
    result.push({ ...captured, duplicate });
  }
  return result;
}

/** Everything the phone has read lately, for the log. */
export async function listRecent(
  database: SqliteDatabase,
  limit = 100,
): Promise<readonly CapturedRow[]> {
  const rows = await database.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM captured_payments ORDER BY postTime DESC LIMIT ?`,
    [limit],
  );
  return rows.map(toRow);
}

export async function countSuggestions(database: SqliteDatabase): Promise<number> {
  const row = await database.getFirstAsync<{ n: number }>(
    `SELECT count(*) AS n FROM captured_payments WHERE status = 'new'`,
    [],
  );
  return row?.n ?? 0;
}

export async function markAdded(
  database: SqliteDatabase,
  id: string,
  expenseId: string,
): Promise<void> {
  await database.runAsync(
    `UPDATE captured_payments SET status = 'added', expenseId = ? WHERE id = ?`,
    [expenseId, id],
  );
}

export async function dismiss(database: SqliteDatabase, id: string): Promise<void> {
  await database.runAsync(`UPDATE captured_payments SET status = 'dismissed' WHERE id = ?`, [id]);
}

/** Drops old log lines: ignored ones after three days, handled ones after thirty. Waiting suggestions stay. */
export async function pruneCaptured(database: SqliteDatabase, now: number): Promise<void> {
  await database.runAsync(
    `DELETE FROM captured_payments WHERE status = 'ignored' AND postTime < ?`,
    [now - KEEP_IGNORED_MS],
  );
  await database.runAsync(
    `DELETE FROM captured_payments WHERE status IN ('added', 'dismissed') AND postTime < ?`,
    [now - KEEP_HANDLED_MS],
  );
}
