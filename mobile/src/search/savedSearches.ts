import { META_KEYS, readMeta, writeMeta } from '../db/meta';
import type { ExpenseSearch } from '../db/queries';
import type { SqliteDatabase } from '../db/sqlite';
import { uuidv7 } from '../lib/uuidv7';

/**
 * Searches the person saved to run again ("Eating out this quarter"). A short list kept on the phone, with the
 * account's other local data (it is wiped when another account signs in); nothing is synced. The date range is
 * saved as a preset name, not as dates, so a saved "This month" means the month it is opened in.
 */

export const MAX_SAVED_SEARCHES = 20;

export type DatePreset = 'thisMonth' | 'lastMonth' | 'last3Months' | 'thisYear';

/** What is saved: the filters, with the date range as a preset. */
export interface SavedFilters {
  readonly text: string;
  readonly categoryId: string | null;
  readonly kind?: 'expense' | 'income' | null;
  readonly minMinor?: number | null;
  readonly maxMinor?: number | null;
  readonly range?: DatePreset | null;
}

export interface SavedSearch {
  readonly id: string;
  readonly name: string;
  readonly search: SavedFilters;
}

function isSaved(value: unknown): value is SavedSearch {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['id'] === 'string' &&
    typeof v['name'] === 'string' &&
    typeof v['search'] === 'object' &&
    v['search'] !== null
  );
}

export async function readSavedSearches(database: SqliteDatabase): Promise<readonly SavedSearch[]> {
  const raw = await readMeta(database, META_KEYS.savedSearches);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSaved) : [];
  } catch {
    return [];
  }
}

async function write(database: SqliteDatabase, list: readonly SavedSearch[]): Promise<void> {
  await writeMeta(database, META_KEYS.savedSearches, JSON.stringify(list));
}

/** Newest first; a name already used (ignoring case and spaces) is replaced; the oldest beyond twenty go. */
export async function saveSearch(
  database: SqliteDatabase,
  name: string,
  search: SavedFilters,
): Promise<void> {
  const trimmed = name.trim();
  if (trimmed === '') return;
  const others = (await readSavedSearches(database)).filter(
    (saved) => saved.name.trim().toLowerCase() !== trimmed.toLowerCase(),
  );
  await write(
    database,
    [{ id: uuidv7(), name: trimmed, search }, ...others].slice(0, MAX_SAVED_SEARCHES),
  );
}

export async function removeSavedSearch(database: SqliteDatabase, id: string): Promise<void> {
  await write(
    database,
    (await readSavedSearches(database)).filter((saved) => saved.id !== id),
  );
}

export type { ExpenseSearch };
