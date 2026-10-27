import { z } from 'zod';
import { ApiErrorBody, type ErrorCode } from './errors.js';
import {
  AmountMinor,
  CalendarDate,
  CurrencyCode,
  LIMITS,
  Revision,
  Timestamp,
  Uuid,
} from './primitives.js';
import { Category, CategoryColor, CategoryName, MonthlyBudget } from './category.js';
import {
  EntryKind,
  Expense,
  ExpenseNoteInput,
  OriginalAmountFields,
  originalPairTogether,
  ORIGINAL_PAIR_ISSUE,
} from './expense.js';
import { Goal, GoalSyncFields } from './goal.js';
import { RecurringRule, RecurringSyncFields } from './recurring.js';

/**
 * The sync contract. Both sides implement against this independently, so it is spelled
 * out exactly. Rules in force:
 *
 * - **Pull** walks a per-user monotonic `revision`, not a timestamp. A timestamp cursor
 *   loses writes: two rows written in the same millisecond, or a cursor advanced past a
 *   row whose transaction had not yet committed, mean a record silently never delivered.
 * - **Push** resolves last-write-wins on the client's `updatedAt`, clamped server-side
 *   to `now + 5 minutes` so a skewed device clock cannot win every future conflict.
 * - Every push result carries the **authoritative server row**, including on conflict,
 *   so clients converge on server state instead of drifting.
 * - `clientMutationId` makes a retried push a no-op that replays the original result.
 *   Remembered for 90 days — the tombstone horizon, so the two cannot drift.
 * - A batch is applied in one transaction in dependency order: **categories, then
 *   recurring rules, then goals, then expenses**, so an expense created offline against an offline-created category syncs
 *   in a single round trip.
 * - Tombstones are pruned after 90 days; a `since` older than that horizon gets
 *   `resyncRequired: true`.
 */

export const SYNC_ENTITIES = ['category', 'recurring', 'goal', 'expense'] as const;

export const SyncEntity = z
  .enum(SYNC_ENTITIES)
  .describe(
    'Which table the change belongs to. The server applies a batch in this order: all `category` items, then all `recurring` items, then all `goal` items, then all `expense` items.',
  );

// ---------------------------------------------------------------------------
// Pull - GET /v1/sync?since&limit
// ---------------------------------------------------------------------------

export const SyncPullQuery = z.strictObject({
  since: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'Revision watermark: return rows with `revision > since`. This is a server-assigned per-user revision number, NOT a timestamp. Omit or pass 0 for a full download.',
    ),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITS.SYNC_PULL_MAX_LIMIT)
    .optional()
    .describe('Max changes to return, 1-500. Defaults to 200.'),
});

/**
 * One changed row. Discriminated on `entity` so the client gets a precise type for
 * `record` without a cast. Deleted rows arrive with `deletedAt` set - that is the
 * tombstone, and the only way a delete can cross the wire.
 */
export const SyncChange = z.discriminatedUnion('entity', [
  z.strictObject({ entity: z.literal('category'), record: Category }),
  z.strictObject({ entity: z.literal('recurring'), record: RecurringRule }),
  z.strictObject({ entity: z.literal('goal'), record: Goal }),
  z.strictObject({ entity: z.literal('expense'), record: Expense }),
]);

export const SyncPullResponse = z.strictObject({
  changes: z
    .array(SyncChange)
    .describe(
      'Rows with `revision > since`, ordered by `revision` ascending. Includes tombstones (`deletedAt != null`). Empty when the client is up to date or when `resyncRequired` is true.',
    ),
  nextCursor: Revision.describe(
    'Watermark to send as `since` next time: the highest `revision` in `changes`, or the `since` you sent when `changes` is empty. Persist it only after the whole page is written locally.',
  ),
  hasMore: z
    .boolean()
    .describe(
      'True when more changes exist past `nextCursor`. Keep calling with the new `since` until it is false.',
    ),
  resyncRequired: z
    .boolean()
    .describe(
      'True when `since` predates the 90-day tombstone horizon, so an incremental answer could resurrect deleted rows. The client must wipe local state and pull again from `since=0`. When true, `changes` is empty, `nextCursor` is 0 and `hasMore` is false.',
    ),
  serverTime: Timestamp.describe(
    'Server clock at response time. Clients may use it to estimate their own skew; it is never a sync cursor.',
  ),
});

// ---------------------------------------------------------------------------
// Push - POST /v1/sync
// ---------------------------------------------------------------------------

/**
 * Mutable category fields in a push. All optional: a push is an **upsert with a merge**.
 * On a row the server has never seen, `fields` must be complete enough to create it
 * (`name` required) or the result is `invalid`. On an existing row, absent keys are left
 * alone. Set `deletedAt` to delete; set it back to null to undelete.
 */
export const CategorySyncFields = z
  .strictObject({
    name: CategoryName.optional(),
    color: CategoryColor.optional(),
    monthlyBudgetMinor: MonthlyBudget.nullable().optional(),
    deletedAt: Timestamp.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'fields must not be empty' });

/**
 * Mutable expense fields in a push. Same upsert/merge semantics as
 * {@link CategorySyncFields}; `categoryId`, `amountMinor` and `date` are all required to
 * create a row that does not exist yet.
 */
export const ExpenseSyncFields = z
  .strictObject({
    categoryId: Uuid.optional(),
    kind: EntryKind.optional(),
    amountMinor: AmountMinor.optional(),
    currency: CurrencyCode.optional(),
    originalAmountMinor: OriginalAmountFields.originalAmountMinor.optional(),
    originalCurrency: OriginalAmountFields.originalCurrency.optional(),
    date: CalendarDate.optional(),
    note: ExpenseNoteInput.optional(),
    deletedAt: Timestamp.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'fields must not be empty' })
  .refine(originalPairTogether, ORIGINAL_PAIR_ISSUE);

const PUSH_ITEM_BASE = {
  id: Uuid.describe(
    'Client-minted UUIDv7 primary key of the row. Creates and updates are the same call: the server upserts on this id.',
  ),
  updatedAt: Timestamp.describe(
    'When the user made the edit, per the client clock. Last-write-wins orders on this. The server clamps it to `now + 5min` before comparing and storing, so a skewed clock cannot win every future conflict.',
  ),
  clientMutationId: Uuid.describe(
    'Idempotency key, unique per user, minted once per local mutation and reused across retries. A replayed id returns the original result without re-applying. Reusing an id with a different payload is `mutation_id_reused`.',
  ),
} as const;

/** One item in a push batch. Discriminated on `entity` so `fields` is precisely typed. */
export const SyncPushItem = z.discriminatedUnion('entity', [
  z.strictObject({
    entity: z.literal('category'),
    ...PUSH_ITEM_BASE,
    fields: CategorySyncFields,
  }),
  z.strictObject({
    entity: z.literal('recurring'),
    ...PUSH_ITEM_BASE,
    fields: RecurringSyncFields,
  }),
  z.strictObject({
    entity: z.literal('goal'),
    ...PUSH_ITEM_BASE,
    fields: GoalSyncFields,
  }),
  z.strictObject({
    entity: z.literal('expense'),
    ...PUSH_ITEM_BASE,
    fields: ExpenseSyncFields,
  }),
]);

export const SyncPushRequest = z.strictObject({
  changes: z
    .array(SyncPushItem)
    .min(1)
    .max(LIMITS.SYNC_MAX_BATCH_SIZE)
    .describe(
      'The batch, 1-500 items. Push categories before the expenses that reference them; the server also sorts by entity internally, so a single round trip is enough. Over 500 items: HTTP 413 `batch_too_large`.',
    ),
});

export const SYNC_PUSH_STATUSES = ['applied', 'conflict_server_wins', 'invalid'] as const;

/**
 * The `error.code` values an `invalid` push result may carry.
 *
 * Declared here so the set is a contract fact rather than whatever the server happened
 * to throw. A client switches on these to decide what to do with the local row, and the
 * five answers are genuinely different recoveries:
 *
 * - `validation_error` — the row is malformed or incomplete for a create. Not fixable by
 *   retrying; drop the mutation or repair the local row.
 * - `unknown_category` — `categoryId` does not name a live category of this account.
 *   Repoint the expense (the `Uncategorized` default is always there) and push again.
 * - `immutable_field` — the push tried to set a server-owned field. A client bug.
 * - `mutation_id_reused` — a `clientMutationId` came back with a different payload, so
 *   the outbox has lost track of itself. Re-mint the id; do not retry as-is.
 * - `category_name_taken` — another live category of this user already has that name,
 *   which is the ordinary outcome when two devices invent the same category offline.
 *   Merge locally onto the server's row, or rename and push again.
 * - `category_not_deletable` — the row is the undeletable `Uncategorized` default.
 *
 * Anything outside this list is a server fault and surfaces as a `500` for the whole
 * batch, not as a per-record result: an unrecognised failure is not something a client
 * can be asked to resolve row by row.
 */
export const SYNC_RECORD_ERROR_CODES = [
  'validation_error',
  'unknown_category',
  'immutable_field',
  'mutation_id_reused',
  'category_name_taken',
  'category_not_deletable',
] as const satisfies ReadonlyArray<ErrorCode>;

export type SyncRecordErrorCode = (typeof SYNC_RECORD_ERROR_CODES)[number];

export const SyncPushStatus = z
  .enum(SYNC_PUSH_STATUSES)
  .describe(
    [
      'Per-record outcome, so one bad row cannot fail the batch.',
      '`applied`: the incoming `updatedAt` was strictly newer than stored, and the write landed.',
      '`conflict_server_wins`: the stored `updatedAt` was newer or equal, so the write was dropped.',
      '`invalid`: validation or referential failure (e.g. unknown `categoryId`, or an incomplete create); `error.code` is one of `SYNC_RECORD_ERROR_CODES`.',
    ].join(' '),
  );

const PUSH_RESULT_BASE = {
  clientMutationId: Uuid.describe(
    'Echoed from the request item, so results can be matched back to local mutations.',
  ),
  id: Uuid,
  status: SyncPushStatus,
  idempotentReplay: z
    .boolean()
    .describe(
      'True when this result was replayed from an already-processed `clientMutationId` rather than applied now. The outcome is identical either way.',
    ),
  error: ApiErrorBody.nullable().describe(
    'Non-null only when `status` is `invalid`; explains why.',
  ),
} as const;

/**
 * One push result. Discriminated on `entity`; `record` is the **authoritative server
 * row** after the batch, present for `applied` and `conflict_server_wins` alike. The
 * client overwrites its local copy with it, which is what makes clients converge.
 *
 * `record` is null only when there is no server row to report: an `invalid` item whose
 * row does not exist server-side.
 */
export const SyncPushResult = z.discriminatedUnion('entity', [
  z.strictObject({
    entity: z.literal('category'),
    ...PUSH_RESULT_BASE,
    record: Category.nullable(),
  }),
  z.strictObject({
    entity: z.literal('recurring'),
    ...PUSH_RESULT_BASE,
    record: RecurringRule.nullable(),
  }),
  z.strictObject({
    entity: z.literal('goal'),
    ...PUSH_RESULT_BASE,
    record: Goal.nullable(),
  }),
  z.strictObject({
    entity: z.literal('expense'),
    ...PUSH_RESULT_BASE,
    record: Expense.nullable(),
  }),
]);

export const SyncPushResponse = z.strictObject({
  results: z
    .array(SyncPushResult)
    .describe('One result per request item, in the order the items were sent.'),
  serverRevision: Revision.describe(
    'The highest `revision` for this user after the batch. Do NOT use it as the next `since`: the batch also bumped revisions for your own writes, and pulling from here would skip changes another device made meanwhile. Keep using the `nextCursor` from `GET /v1/sync`.',
  ),
  serverTime: Timestamp,
});

export type SyncEntity = z.infer<typeof SyncEntity>;
export type SyncPullQuery = z.infer<typeof SyncPullQuery>;
export type SyncChange = z.infer<typeof SyncChange>;
export type SyncPullResponse = z.infer<typeof SyncPullResponse>;
export type CategorySyncFields = z.infer<typeof CategorySyncFields>;
export type ExpenseSyncFields = z.infer<typeof ExpenseSyncFields>;
export type SyncPushItem = z.infer<typeof SyncPushItem>;
export type SyncPushRequest = z.infer<typeof SyncPushRequest>;
export type SyncPushStatus = z.infer<typeof SyncPushStatus>;
export type SyncPushResult = z.infer<typeof SyncPushResult>;
export type SyncPushResponse = z.infer<typeof SyncPushResponse>;

/**
 * Order the server applies a batch in, and the order clients should push in.
 * Categories first so an expense can reference a category created in the same batch.
 */
export const SYNC_APPLY_ORDER = [
  'category',
  'recurring',
  'goal',
  'expense',
] as const satisfies ReadonlyArray<SyncEntity>;
