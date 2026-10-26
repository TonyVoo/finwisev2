import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { SqliteDatabase } from '../db/sqlite';
import { listExpensesForExport } from '../db/queries';
import { currencyDecimals } from '../lib/money';
import { buildExpensesCsv, exportFileName } from './csv';

/**
 * Export every expense as a CSV and hand it to the system share sheet.
 *
 * Entirely local: the rows come from SQLite, the file goes to the app's cache directory,
 * and the share sheet is the OS's. No request is made, so it works offline like every
 * other screen in the app (`docs/PLAN.md` §1).
 *
 * The file goes to the **cache** directory, which the OS may clear, because it is a
 * hand-off and not a record - the user's copy is wherever they send it. The write
 * overwrites a file of the same name, so exporting twice in a day does not accumulate.
 *
 * The three outcomes are distinct and the caller words each differently: nothing to
 * export (an empty file would only confuse), a platform with no share sheet, and a
 * failure writing or sharing. Cancelling the share sheet is not a failure and is not
 * reported; `shareAsync` resolves either way, so there is nothing to tell them apart.
 */

export type ExportResult =
  /** The share sheet was opened with the file. */
  | { readonly status: 'shared'; readonly count: number }
  /** No live expenses, so no file was written. */
  | { readonly status: 'empty' }
  /** The platform cannot share files. */
  | { readonly status: 'unavailable' };

/** The two native calls, injectable so the orchestration is testable without a device. */
export interface ExportDependencies {
  readonly database: SqliteDatabase;
  readonly now: () => Date;
  readonly writeFile: (name: string, contents: string) => string;
  readonly isSharingAvailable: () => Promise<boolean>;
  readonly shareFile: (uri: string) => Promise<void>;
}

export const nativeExportDependencies = {
  writeFile(name: string, contents: string): string {
    const file = new File(Paths.cache, name);
    file.create({ overwrite: true });
    file.write(contents);
    return file.uri;
  },
  isSharingAvailable: () => Sharing.isAvailableAsync(),
  shareFile: (uri: string) =>
    Sharing.shareAsync(uri, {
      mimeType: 'text/csv',
      UTI: 'public.comma-separated-values-text',
      dialogTitle: 'Export expenses',
    }),
} satisfies Pick<ExportDependencies, 'writeFile' | 'isSharingAvailable' | 'shareFile'>;

/** Throws if the file cannot be written or shared; the caller shows the error snackbar. */
export async function exportExpenses(deps: ExportDependencies): Promise<ExportResult> {
  const rows = await listExpensesForExport(deps.database);
  if (rows.length === 0) return { status: 'empty' };

  // Asked before the file is written, so an unsupported platform leaves nothing behind.
  if (!(await deps.isSharingAvailable())) return { status: 'unavailable' };

  const csv = buildExpensesCsv(rows, (currency) => currencyDecimals(currency));
  const uri = deps.writeFile(exportFileName(deps.now()), csv);
  await deps.shareFile(uri);
  return { status: 'shared', count: rows.length };
}
