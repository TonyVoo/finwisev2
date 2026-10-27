import type { SyncChange, SyncEntity } from '@expense-tracker/shared';
import { entitySpec } from '../db/entities';
import type { SqliteBindValue, SqliteExecutor } from '../db/sqlite';
import { readOutboxFor } from './outbox';

/**
 * Writing an authoritative server row into the local store.
 *
 * Both halves of sync end here. A pulled change and a push result carry the same thing -
 * the row as the server holds it - and the client's job in each case is to overwrite its
 * copy with it. That overwrite is what makes two devices converge instead of drift, and
 * it is why there is one function rather than a pull path and a push path that could
 * disagree about, say, whether `revision` gets written.
 *
 * ### Tombstones
 *
 * A delete arrives as an ordinary row with `deletedAt` set, and is applied as an
 * ordinary row with `deletedAt` set. There is no `DELETE FROM` here at all: the local
 * row has to stay, both because every list query already filters on `deletedAt IS NULL`
 * and because a row that vanished locally would be indistinguishable from one this
 * device has never seen the next time anything compared the two.
 *
 * ### Why the local row is not simply the server row
 *
 * It is, *plus any unsent local edit that would win last-write-wins*. Overwriting with
 * the server row alone is correct for the data the server knows about and wrong for the
 * screen: a user who edits an expense three times offline, where the push carries only
 * the first two, would watch their third edit disappear from the list and come back a
 * round trip later. So after the overwrite, undrained outbox entries for that row are
 * replayed over it, oldest first, and only the ones whose `updatedAt` is newer than the
 * server's - which is precisely the comparison the server will make when they are pushed.
 * The row therefore renders the outcome LWW is going to reach, rather than a state that
 * was briefly true in the middle of a round trip.
 */

/**
 * Columns written from a server row, per entity.
 *
 * `tests/sync/apply.test.ts` asserts each list is exactly the key set of the
 * corresponding shared schema, so a field added to the contract fails there rather than
 * being silently dropped on the way into SQLite.
 */
export const SERVER_COLUMNS: Readonly<Record<SyncEntity, readonly string[]>> = {
  category: [
    'id',
    'name',
    'color',
    'isDefault',
    'monthlyBudgetMinor',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'revision',
  ],
  recurring: [
    'id',
    'categoryId',
    'amountMinor',
    'currency',
    'note',
    'frequency',
    'startDate',
    'endDate',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'revision',
  ],
  goal: [
    'id',
    'name',
    'targetMinor',
    'savedMinor',
    'currency',
    'deadline',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'revision',
  ],
  expense: [
    'id',
    'categoryId',
    'kind',
    'amountMinor',
    'currency',
    'originalAmountMinor',
    'originalCurrency',
    'date',
    'note',
    'createdBy',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'revision',
  ],
};

function toBindValue(value: unknown): SqliteBindValue {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case 'string':
    case 'number':
      return value;
    case 'boolean':
      return value ? 1 : 0;
    default:
      throw new TypeError(`Value of type ${typeof value} cannot be stored in SQLite`);
  }
}

/** The server row as a plain record, so both entities go through one code path. */
function asRecord(change: SyncChange): Record<string, unknown> {
  return change.record as unknown as Record<string, unknown>;
}

/**
 * Overwrite the local row with `change.record`, then replay unsent local edits over it.
 *
 * Call inside the caller's transaction: a page of pulled changes and the cursor that
 * says they were applied have to land together.
 */
export async function applyServerRecord(txn: SqliteExecutor, change: SyncChange): Promise<void> {
  const spec = entitySpec(change.entity);
  const record = asRecord(change);
  const columns = SERVER_COLUMNS[change.entity];
  const values = columns.map((column) => toBindValue(record[column]));

  // `table` and every column name come from the entity spec and the list above, both
  // closed sets declared in this repo. Values are always bound.
  await txn.runAsync(
    `INSERT INTO ${spec.table} (${columns.join(', ')})
          VALUES (${columns.map(() => '?').join(', ')})
     ON CONFLICT (id) DO UPDATE SET
          ${columns
            .filter((column) => column !== 'id')
            .map((column) => `${column} = excluded.${column}`)
            .join(', ')}`,
    values,
  );

  await replayPendingEdits(txn, change.entity, String(record.id), String(record.updatedAt));
}

/**
 * Re-apply the undrained outbox entries for one row on top of the server's version.
 *
 * Only entries strictly newer than the server row: an older one is going to lose
 * last-write-wins when it is pushed, so rendering it would promise the user an outcome
 * the next round trip takes away.
 */
async function replayPendingEdits(
  txn: SqliteExecutor,
  entity: SyncEntity,
  recordId: string,
  serverUpdatedAt: string,
): Promise<void> {
  const spec = entitySpec(entity);

  for (const entry of await readOutboxFor(txn, entity, recordId)) {
    if (entry.fields === null) continue;
    // Timestamps are ISO-8601 UTC from `toTimestamp`, so lexicographic order is
    // chronological order and no parsing is needed.
    if (entry.updatedAt <= serverUpdatedAt) continue;

    const columns = Object.keys(entry.fields).filter((column) =>
      spec.mutableColumns.includes(column),
    );
    if (columns.length === 0) continue;

    await txn.runAsync(
      `UPDATE ${spec.table} SET ${[...columns.map((column) => `${column} = ?`), 'updatedAt = ?'].join(', ')}
        WHERE id = ?`,
      [...columns.map((column) => toBindValue(entry.fields?.[column])), entry.updatedAt, recordId],
    );
  }
}
