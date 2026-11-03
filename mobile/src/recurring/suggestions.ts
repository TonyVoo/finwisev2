import { META_KEYS, readMeta, writeMeta } from '../db/meta';
import type { SqliteDatabase } from '../db/sqlite';
import { listLiveRecurring } from '../db/queries';
import { detectRecurring, type RecurringSuggestion } from './detectRecurring';

/** Months of history looked at: enough for three in a row, not so many that an old habit counts. */
const LOOKBACK_MONTHS = 8;

async function readDismissed(database: SqliteDatabase): Promise<Set<string>> {
  const raw = await readMeta(database, META_KEYS.recurringDismissed);
  if (raw === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

export async function dismissSuggestion(database: SqliteDatabase, key: string): Promise<void> {
  const keys = await readDismissed(database);
  keys.add(key);
  await writeMeta(database, META_KEYS.recurringDismissed, JSON.stringify([...keys]));
}

/** What the history says repeats monthly and has no rule yet, from this phone's own entries. */
export async function loadSuggestions(
  database: SqliteDatabase,
  today: string,
): Promise<readonly RecurringSuggestion[]> {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const from = new Date(Date.UTC(year, month - 1 - LOOKBACK_MONTHS, 1)).toISOString().slice(0, 10);
  const history = await database.getAllAsync<{
    date: string;
    amountMinor: number;
    currency: string;
    note: string | null;
    categoryId: string;
  }>(
    `SELECT date, amountMinor, currency, note, categoryId FROM expenses
      WHERE deletedAt IS NULL AND kind = 'expense' AND date >= ?`,
    [from],
  );
  const rules = await listLiveRecurring(database);
  return detectRecurring({
    history,
    rules: rules.map((r) => ({
      categoryId: r.categoryId,
      amountMinor: r.amountMinor,
      note: r.note,
    })),
    dismissed: await readDismissed(database),
    today,
  });
}
