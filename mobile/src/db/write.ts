import {
  type CategorySyncFields,
  type RecurringSyncFields,
  type ExpenseSyncFields,
  type GoalSyncFields,
  type SettlementSyncFields,
  type SyncEntity,
  Uuid,
} from '@expense-tracker/shared';
import { type Clock, systemClock, toTimestamp } from '../lib/clock';
import { uuidv7 } from '../lib/uuidv7';
import { type EntitySpec, entitySpec } from './entities';
import type { SqliteBindValue, SqliteDatabase, SqliteExecutor } from './sqlite';

/**
 * The one way the app writes local data.
 *
 * Every mutation does two things that must either both happen or neither happen:
 *
 * 1. write the row, so the screen updates from SQLite on the next frame, and
 * 2. append an `outbox` entry, so the change eventually reaches the server.
 *
 * A row that lands without its outbox entry is the worst bug this app can have. It is
 * not a crash and not an error state - the user sees their expense saved, the screen is
 * correct, and the change is simply never sent. Nothing notices, and it surfaces weeks
 * later as "my other phone is missing things". So the two writes share one transaction,
 * and there is no API that can do one without the other: `fields` is what gets persisted
 * *and* what gets queued, derived once.
 *
 * The reverse failure matters too. An outbox entry without a row would push a mutation
 * the user can neither see nor correct, and the same transaction rules that out.
 */

/** A mutation of one local row. Mirrors one item of a `POST /v1/sync` batch. */
export type LocalMutation =
  | { readonly entity: 'category'; readonly id: string; readonly fields: CategorySyncFields }
  | {
      readonly entity: 'recurring';
      readonly id: string;
      readonly fields: RecurringSyncFields;
    }
  | { readonly entity: 'goal'; readonly id: string; readonly fields: GoalSyncFields }
  | { readonly entity: 'expense'; readonly id: string; readonly fields: ExpenseSyncFields }
  | {
      readonly entity: 'settlement';
      readonly id: string;
      readonly fields: SettlementSyncFields;
    };

export interface LocalMutationOptions {
  /** Injectable so tests can pin `updatedAt`. Defaults to the system clock. */
  readonly clock?: Clock;
  /** Injectable so tests can pin the idempotency key. Defaults to {@link uuidv7}. */
  readonly newMutationId?: () => string;
}

/** What was queued. Returned so a caller can correlate a push result back to it. */
export interface QueuedMutation {
  /** The outbox entry's FIFO position. */
  readonly seq: number;
  readonly entity: SyncEntity;
  readonly recordId: string;
  /** Idempotency key for `POST /v1/sync`. Reused verbatim on every retry. */
  readonly clientMutationId: string;
  readonly updatedAt: string;
  /** True when this mutation created the local row rather than updating one. */
  readonly created: boolean;
}

/**
 * A mutation that would create a row without enough fields to populate its `NOT NULL`
 * columns. The server answers the same case with a per-record `invalid`; raising it
 * locally keeps a mutation that can never succeed out of the outbox entirely.
 */
export class IncompleteLocalCreateError extends Error {
  readonly entity: SyncEntity;
  readonly recordId: string;
  readonly missing: readonly string[];

  constructor(entity: SyncEntity, recordId: string, missing: readonly string[]) {
    super(`Cannot create ${entity} ${recordId}: missing required field(s) ${missing.join(', ')}`);
    this.name = 'IncompleteLocalCreateError';
    this.entity = entity;
    this.recordId = recordId;
    this.missing = missing;
  }
}

/** A mutation that names no field to change. Nothing to persist and nothing to push. */
export class EmptyLocalMutationError extends Error {
  constructor(entity: SyncEntity, recordId: string) {
    super(`Mutation of ${entity} ${recordId} changes no fields`);
    this.name = 'EmptyLocalMutationError';
  }
}

function toBindValue(value: unknown): SqliteBindValue {
  if (value === null) return null;
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

/**
 * Keys present with an `undefined` value are not changes. Zod keeps them (an optional
 * key explicitly set to `undefined` is valid) and so does `Object.keys`, so a mutation
 * of `{ name: undefined }` would otherwise satisfy the contract's "must not be empty"
 * refinement and then write SQL `NULL` into a `NOT NULL` column.
 */
function definedFields(parsed: Record<string, unknown>): Record<string, unknown> {
  const defined: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== undefined) defined[key] = value;
  }
  return defined;
}

/**
 * Persist `mutation` and queue it for sync, atomically.
 *
 * Creates and updates are the same call: the row is inserted if it is absent and merged
 * if it is present, matching the upsert semantics of `POST /v1/sync` so local state and
 * the pushed mutation describe the same change. `fields` carries only what changed -
 * sending the whole row would overwrite fields another device edited meanwhile.
 *
 * Throws before opening the transaction when `fields` fails the shared schema or is
 * empty, and inside it when the row would be created incomplete. In every failing case
 * nothing is written and nothing is queued.
 */
export async function applyLocalMutation(
  database: SqliteDatabase,
  mutation: LocalMutation,
  options: LocalMutationOptions = {},
): Promise<QueuedMutation> {
  const [queued] = await applyLocalMutations(database, [mutation], options);
  // `applyLocalMutations` returns one result per mutation and throws rather than returning
  // fewer, so this is a narrowing for the type checker, not a case that happens.
  if (queued === undefined) {
    throw new EmptyLocalMutationError(mutation.entity, mutation.id);
  }
  return queued;
}

/**
 * Persist several mutations and queue them, **all in one transaction**.
 *
 * One call for the operations that are a single change to the user and several rows to the
 * database. Deleting a category is the one the design calls out: it reassigns every
 * expense that pointed at it and then tombstones the category, and
 * `docs/design/07-categories.md` §4 rule 6 requires both in one transaction because "a
 * crash between them would leave expenses pointing at a deleted category".
 *
 * Every rule {@link applyLocalMutation} follows holds per mutation, and two more hold
 * across the batch:
 *
 * - **Each mutation gets its own outbox entry and its own `clientMutationId`**, because
 *   each is a separate record on the wire; the push applies them in dependency order
 *   (`SYNC_APPLY_ORDER`), which the drain already guarantees.
 * - **They share one `updatedAt`**, taken once before the transaction opens. Last-write-wins
 *   orders on it, and a batch that is one change from the user should not resolve as
 *   several instants - the reassignments and the tombstone that caused them are the same
 *   edit.
 *
 * Validation of every mutation happens before the transaction opens, so a batch with one
 * bad member writes nothing at all rather than half of itself.
 */
export async function applyLocalMutations(
  database: SqliteDatabase,
  mutations: readonly LocalMutation[],
  options: LocalMutationOptions = {},
): Promise<readonly QueuedMutation[]> {
  return await applyLocalMutationPlan(database, async () => mutations, options);
}

/**
 * The same, for a batch whose membership is a **query**.
 *
 * `plan` runs inside the transaction and returns the mutations to apply, so the read that
 * decides the batch and the writes that carry it out cannot be separated. Deleting a
 * category is the case that needs it: the set of expenses to reassign is "every live
 * expense pointing at this category", and reading that set before the transaction opens
 * leaves a window in which a sync pull could add one more - which would then be left
 * pointing at a category this operation has deleted, the exact state
 * `docs/design/07-categories.md` §4 rule 6 puts the reassignment and the tombstone in one
 * transaction to rule out.
 *
 * `plan` may return an empty list, which writes nothing and queues nothing.
 */
export async function applyLocalMutationPlan(
  database: SqliteDatabase,
  plan: (txn: SqliteExecutor) => Promise<readonly LocalMutation[]>,
  options: LocalMutationOptions = {},
): Promise<readonly QueuedMutation[]> {
  const newMutationId = options.newMutationId ?? uuidv7;
  const updatedAt = toTimestamp((options.clock ?? systemClock)());
  let queued: QueuedMutation[] = [];

  await database.withExclusiveTransactionAsync(async (txn) => {
    // Reassigned on each attempt rather than appended to, so a caller that retries after a
    // rollback cannot read the entries the failed attempt had queued.
    queued = [];

    for (const mutation of await plan(txn)) {
      const spec = entitySpec(mutation.entity);
      const recordId = Uuid.parse(mutation.id);

      // Validated against the wire contract before anything is written. A mutation the
      // server would reject has no business being in the outbox: it would fail every
      // push, forever. Throwing here rolls the whole batch back.
      const fields = definedFields(spec.parseFields(mutation.fields));
      const changed = Object.keys(fields);
      if (changed.length === 0) {
        throw new EmptyLocalMutationError(mutation.entity, recordId);
      }

      let outboxFields: Record<string, unknown> = fields;
      const created = !(await rowExists(txn, spec.table, recordId));
      if (created) {
        const missing = spec.requiredOnCreate.filter((column) => !(column in fields));
        if (missing.length > 0) {
          throw new IncompleteLocalCreateError(mutation.entity, recordId, missing);
        }
        await insertRow(txn, spec.table, recordId, updatedAt, spec.insertDefaults, fields);
      } else {
        await updateRow(txn, spec.table, recordId, updatedAt, changed, fields);
        // A row the server has never seen (revision 0) has to be sent whole. Its create may
        // have been refused and dropped from the outbox, so an edit carrying only the
        // changed fields would reach the server as an incomplete create and be refused
        // again - a repair that can never succeed.
        const whole = await wholeRowFields(txn, spec, recordId);
        if (whole !== null) outboxFields = { ...whole, ...fields };
      }

      // One idempotency key per mutation, minted once and both stored and returned, so a
      // caller correlating a push result back to a record reads the same id the push
      // carries.
      const clientMutationId = newMutationId();
      const seq = await enqueue(txn, {
        entity: mutation.entity,
        recordId,
        fields: outboxFields,
        updatedAt,
        clientMutationId,
        queuedAt: updatedAt,
      });

      queued.push({
        seq,
        entity: mutation.entity,
        recordId,
        clientMutationId,
        updatedAt,
        created,
      });
    }
  });

  return queued;
}

/**
 * Every mutable column of a row the server has never seen, or null once it has (revision
 * above 0). Validated through the entity's own field schema, so what it returns is exactly
 * what a create would have sent.
 */
async function wholeRowFields(
  txn: SqliteExecutor,
  spec: EntitySpec,
  id: string,
): Promise<Record<string, unknown> | null> {
  const row = await txn.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM ${spec.table} WHERE id = ?`,
    [id],
  );
  if (row === null || row.revision !== 0) return null;
  // Something still queued will carry the create ahead of this edit, so a partial edit is
  // fine. Only a row with nothing queued - its create refused and dropped - needs sending whole.
  const queued = await txn.getFirstAsync<{ one: number }>(
    'SELECT 1 AS one FROM outbox WHERE entity = ? AND recordId = ? LIMIT 1',
    [spec.entity, id],
  );
  if (queued !== null) return null;
  const whole: Record<string, unknown> = {};
  for (const column of spec.mutableColumns) {
    // SQLite keeps a boolean as 0/1; the wire wants a boolean.
    whole[column] = BOOLEAN_COLUMNS.has(column) ? row[column] === 1 : row[column];
  }
  return definedFields(spec.parseFields(whole));
}

/** Columns SQLite stores as 0/1 that the contract carries as a boolean. */
const BOOLEAN_COLUMNS: ReadonlySet<string> = new Set(['private']);

async function rowExists(txn: SqliteExecutor, table: string, id: string): Promise<boolean> {
  // `table` is never user input: it comes from the entity spec, a closed set declared in
  // `entities.ts`. The same holds for every interpolated column name below.
  const found = await txn.getFirstAsync<{ one: number }>(
    `SELECT 1 AS one FROM ${table} WHERE id = ?`,
    [id],
  );
  return found !== null;
}

async function insertRow(
  txn: SqliteExecutor,
  table: string,
  id: string,
  updatedAt: string,
  insertDefaults: Readonly<Record<string, SqliteBindValue>>,
  fields: Record<string, unknown>,
): Promise<void> {
  // Defaults first, so a field that is also a default (`deletedAt`) overrides it.
  const values = new Map<string, SqliteBindValue>([['id', id]]);
  for (const [column, value] of Object.entries(insertDefaults)) values.set(column, value);
  for (const [column, value] of Object.entries(fields)) values.set(column, toBindValue(value));
  values.set('updatedAt', updatedAt);

  const columns = [...values.keys()];
  const placeholders = columns.map(() => '?').join(', ');
  await txn.runAsync(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`, [
    ...values.values(),
  ]);
}

async function updateRow(
  txn: SqliteExecutor,
  table: string,
  id: string,
  updatedAt: string,
  changed: readonly string[],
  fields: Record<string, unknown>,
): Promise<void> {
  // Only the changed columns are in the SET clause, so editing one field cannot clobber
  // a field a sync pull wrote in the meantime.
  const assignments = [...changed.map((column) => `${column} = ?`), 'updatedAt = ?'];
  const params: SqliteBindValue[] = [
    ...changed.map((column) => toBindValue(fields[column])),
    updatedAt,
    id,
  ];
  await txn.runAsync(`UPDATE ${table} SET ${assignments.join(', ')} WHERE id = ?`, params);
}

interface OutboxEntry {
  readonly entity: SyncEntity;
  readonly recordId: string;
  readonly fields: Record<string, unknown>;
  readonly updatedAt: string;
  readonly clientMutationId: string;
  readonly queuedAt: string;
}

async function enqueue(txn: SqliteExecutor, entry: OutboxEntry): Promise<number> {
  const result = await txn.runAsync(
    `INSERT INTO outbox (entity, recordId, fields, updatedAt, clientMutationId, queuedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      entry.entity,
      entry.recordId,
      JSON.stringify(entry.fields),
      entry.updatedAt,
      entry.clientMutationId,
      entry.queuedAt,
    ],
  );
  return result.lastInsertRowId;
}
