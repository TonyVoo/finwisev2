import { File } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import type { SqliteDatabase } from '../db/sqlite';
import { createExpense } from '../db/mutations';
import { listLiveCategories } from '../db/queries';
import { currencyDecimals } from '../lib/money';
import { parseCsv } from './parseCsv';
import { importKey, planImport, type ImportEntry, type ImportPlan } from './planImport';

/**
 * Import entries from a CSV file (`docs/design/21-import.md`): pick a file, read it, show what would be added,
 * and only then add it through the same local write as typing each entry, so it syncs like any other.
 * Entirely local; the file never leaves the phone.
 */

export interface ImportDependencies {
  readonly database: SqliteDatabase;
  /** The text of the file the person chose, or null when they cancelled. */
  readonly pickText: () => Promise<string | null>;
  readonly homeCurrency: string;
}

export const nativePickText = async (): Promise<string | null> => {
  const picked = await DocumentPicker.getDocumentAsync({
    type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel'],
    copyToCacheDirectory: true,
  });
  const asset = picked.canceled ? undefined : picked.assets[0];
  return asset === undefined ? null : await new File(asset.uri).text();
};

/** Reads the file and works out what it would add. Null when the person cancelled. */
export async function prepareImport(deps: ImportDependencies): Promise<ImportPlan | null> {
  const text = await deps.pickText();
  if (text === null) return null;

  const categories = await listLiveCategories(deps.database);
  const existing = await deps.database.getAllAsync<{
    date: string;
    amountMinor: number;
    currency: string;
    kind: string;
    note: string | null;
  }>(`SELECT date, amountMinor, currency, kind, note FROM expenses WHERE deletedAt IS NULL`, []);
  return planImport(parseCsv(text), {
    homeCurrency: deps.homeCurrency,
    decimalsFor: (currency) => currencyDecimals(currency),
    categories: categories.map((c) => ({ id: c.id, name: c.name, isDefault: c.isDefault })),
    existingKeys: new Set(existing.map(importKey)),
  });
}

/** Adds the entries as ordinary new entries; the caller wraps this in the app's local write. */
export async function applyImport(
  database: SqliteDatabase,
  entries: readonly ImportEntry[],
): Promise<number> {
  for (const entry of entries) {
    await createExpense(database, {
      categoryId: entry.categoryId,
      kind: entry.kind,
      amountMinor: entry.amountMinor,
      currency: entry.currency,
      originalAmountMinor: entry.originalAmountMinor ?? null,
      originalCurrency: entry.originalCurrency ?? null,
      date: entry.date,
      note: entry.note,
    });
  }
  return entries.length;
}
