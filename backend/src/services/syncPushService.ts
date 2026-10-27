import {
  SYNC_RECORD_ERROR_CODES,
  type ApiErrorBody,
  type Category as WireCategory,
  type CategorySyncFields,
  type Expense as WireExpense,
  type ExpenseSyncFields,
  type Goal as WireGoal,
  type GoalSyncFields,
  type RecurringRule as WireRecurringRule,
  type RecurringSyncFields,
  type SyncEntity,
  type SyncPushItem,
  type SyncPushResponse,
  type SyncPushResult,
  type SyncPushStatus,
} from '@expense-tracker/shared';
import type { Db } from '../db/client.ts';
import { getPrisma } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import {
  fromCalendarDate,
  toWireCategory,
  toWireExpense,
  toWireGoal,
  toWireRecurringRule,
} from '../db/mappers.ts';
import { nextRevision } from '../db/revision.ts';
import { ApiProblem, isApiProblem, problems } from '../errors.ts';
import { logger } from '../logger.ts';
import type { ParsedPushItem } from '../sync/batch.ts';
import { clampClientUpdatedAt, decideLww, inApplyOrder, wasClamped } from '../sync/resolver.ts';
import { assignCategoryColor, requireOwnCategoryForWrite } from './categoryService.ts';
import { accountCurrency, requireAccountCurrency, requireValidOriginal } from './expenseService.ts';
import type {
  Category as CategoryRow,
  Expense as ExpenseRow,
  Goal as GoalRow,
  Prisma,
  RecurringRule as RecurringRuleRow,
} from '../db/generated/client.ts';

/**
 * `POST /v1/sync` — apply a batch of client changes, one result per record.
 *
 * This is the mobile app's only write path, and the only place in the codebase where
 * three awkward requirements have to hold at once:
 *
 *  * **One transaction**, so categories and the expenses that reference them land
 *    together and a client that created both offline syncs in a single round trip.
 *  * **One bad row must not fail the batch**, which is the opposite of what a
 *    transaction does when a statement raises. Resolved with a savepoint per item — see
 *    {@link inSavepoint}.
 *  * **A retry must not apply twice**, enforced by the database rather than by a check,
 *    because two retries can arrive concurrently on two connections. See
 *    {@link recordInLedger}.
 *
 * The LWW and clamping judgements themselves live in `sync/resolver.ts` as pure
 * functions, so they can be tested at the boundaries without a fixture per case.
 */

/** The authoritative server row for a result, or null when there is none to report. */
type RecordFor<E extends SyncEntity> = E extends 'category'
  ? WireCategory
  : E extends 'recurring'
    ? WireRecurringRule
    : E extends 'goal'
      ? WireGoal
      : WireExpense;

/** Any row the sync can report. */
type WireRecord = WireCategory | WireExpense | WireRecurringRule | WireGoal;

/** What applying (or declining to apply) one item produced. */
interface Outcome {
  readonly status: SyncPushStatus;
  readonly record: WireRecord | null;
  readonly error: ApiErrorBody | null;
}

const RECORD_ERROR_CODES = new Set<string>(SYNC_RECORD_ERROR_CODES);

/**
 * Turn a thrown {@link ApiProblem} into a per-record `invalid`, or decline to.
 *
 * The guard is the important half. Only the codes the contract publishes in
 * `SYNC_RECORD_ERROR_CODES` are something a client can be asked to resolve row by row;
 * anything else — a `token_invalid` from a vanished account, an `internal_error` — is a
 * server fault, and dressing it up as `invalid` would tell the client to drop a local
 * change because of our outage. Those rethrow and fail the batch, loudly.
 */
function asRecordError(error: unknown): ApiErrorBody | undefined {
  if (!isApiProblem(error)) return undefined;
  if (!RECORD_ERROR_CODES.has(error.code)) return undefined;
  return error.toEnvelope().error;
}

/** An id that is already in use by a different account. */
function idAlreadyInUse(): ApiProblem {
  // Same wording and shape as the REST create path: the id is the global primary key, so
  // the server cannot honour the write, and it must not answer with a row the caller does
  // not own. The response names no owner — a UUIDv7 is not guessable, so there is nothing
  // to probe for here, and the alternative is a 500 from a primary-key violation.
  return problems.validation('The supplied id is already in use.', {
    issues: [{ path: 'id', message: 'already in use' }],
  });
}

/** `fields.<name>` is required to create a row that does not exist yet. */
function requiredToCreate(entity: SyncEntity, names: string[]): ApiProblem {
  return problems.validation(
    `Creating a ${entity} requires ${names.map((n) => `\`${n}\``).join(', ')}.`,
    { issues: names.map((name) => ({ path: `fields.${name}`, message: 'required to create' })) },
  );
}

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------

async function applyCategoryItem(
  tx: Db,
  userId: string,
  item: Extract<SyncPushItem, { entity: 'category' }>,
  now: Date,
): Promise<Outcome> {
  const fields: CategorySyncFields = item.fields;
  const existing: CategoryRow | null = await tx.category.findUnique({ where: { id: item.id } });
  if (existing && existing.userId !== userId) throw idAlreadyInUse();

  const incomingUpdatedAt = clampPushedUpdatedAt(item.updatedAt, now, {
    userId,
    entity: 'category',
    id: item.id,
  });

  if (!existing) {
    if (fields.name === undefined) throw requiredToCreate('category', ['name']);
    const revision = await nextRevision(tx, userId);
    const created = await tx.category.create({
      data: {
        id: item.id,
        userId,
        name: fields.name,
        color: fields.color ?? (await assignCategoryColor(tx, userId)),
        // Not settable through any write path. The default is seeded at signup, there is
        // exactly one, and it is the target every category delete reassigns to.
        isDefault: false,
        monthlyBudgetMinor: fields.monthlyBudgetMinor ?? null,
        createdAt: now,
        updatedAt: incomingUpdatedAt,
        deletedAt: fields.deletedAt === undefined ? null : toDate(fields.deletedAt),
        revision,
      },
    });
    return applied(toWireCategory(created));
  }

  if (decideLww({ incomingUpdatedAt, storedUpdatedAt: existing.updatedAt }) !== 'applied') {
    return conflict(toWireCategory(existing));
  }

  // Upsert with a merge: an absent key leaves the stored value alone. `deletedAt` is
  // present-but-null for an undelete, which is why it is tested against `undefined` and
  // not for truthiness.
  const deletedAt = fields.deletedAt === undefined ? existing.deletedAt : toDate(fields.deletedAt);

  if (existing.isDefault && deletedAt !== null) {
    throw problems.categoryNotDeletable();
  }

  const revision = await nextRevision(tx, userId);
  const updated = await tx.category.update({
    where: { id: existing.id },
    data: {
      ...(fields.name === undefined ? {} : { name: fields.name }),
      ...(fields.color === undefined ? {} : { color: fields.color }),
      ...(fields.monthlyBudgetMinor === undefined
        ? {}
        : { monthlyBudgetMinor: fields.monthlyBudgetMinor }),
      deletedAt,
      updatedAt: incomingUpdatedAt,
      revision,
    },
  });
  return applied(toWireCategory(updated));
}

// ---------------------------------------------------------------------------
// Expense
// ---------------------------------------------------------------------------

async function applyExpenseItem(
  tx: Db,
  userId: string,
  item: Extract<SyncPushItem, { entity: 'expense' }>,
  now: Date,
): Promise<Outcome> {
  const fields: ExpenseSyncFields = item.fields;
  const existing: ExpenseRow | null = await tx.expense.findUnique({ where: { id: item.id } });
  if (existing && existing.userId !== userId) throw idAlreadyInUse();

  const incomingUpdatedAt = clampPushedUpdatedAt(item.updatedAt, now, {
    userId,
    entity: 'expense',
    id: item.id,
  });

  if (!existing) {
    const { categoryId, amountMinor, date } = fields;
    if (categoryId === undefined || amountMinor === undefined || date === undefined) {
      // Reported together rather than one at a time, so a client fixing an incomplete
      // create learns everything it is missing in a single round trip.
      throw requiredToCreate(
        'expense',
        [
          categoryId === undefined ? 'categoryId' : undefined,
          amountMinor === undefined ? 'amountMinor' : undefined,
          date === undefined ? 'date' : undefined,
        ].filter((name): name is string => name !== undefined),
      );
    }

    const currency = requireAccountCurrency(fields.currency, await accountCurrency(tx, userId));
    requireValidOriginal(
      {
        amountMinor: fields.originalAmountMinor ?? null,
        currency: fields.originalCurrency ?? null,
      },
      currency,
    );
    const deletedAt = fields.deletedAt === undefined ? null : toDate(fields.deletedAt);
    await requireOwnCategoryForWrite(tx, userId, categoryId, {
      // A live row must point at a live category; a tombstone need not. See the doc
      // comment on `requireOwnCategoryForWrite`.
      requireLive: deletedAt === null,
    });

    const revision = await nextRevision(tx, userId);
    const created = await tx.expense.create({
      data: {
        id: item.id,
        userId,
        categoryId,
        kind: fields.kind ?? 'expense',
        amountMinor: BigInt(amountMinor),
        currency,
        originalAmountMinor:
          fields.originalAmountMinor === undefined || fields.originalAmountMinor === null
            ? null
            : BigInt(fields.originalAmountMinor),
        originalCurrency: fields.originalCurrency ?? null,
        date: fromCalendarDate(date),
        // As on the REST create path: `ExpenseNoteInput` has already normalised a
        // note that trims to nothing, so this only fills in an omitted one.
        note: fields.note ?? null,
        createdAt: now,
        updatedAt: incomingUpdatedAt,
        deletedAt,
        revision,
      },
    });
    return applied(toWireExpense(created));
  }

  if (decideLww({ incomingUpdatedAt, storedUpdatedAt: existing.updatedAt }) !== 'applied') {
    return conflict(toWireExpense(existing));
  }

  if (fields.currency !== undefined) {
    requireAccountCurrency(fields.currency, await accountCurrency(tx, userId));
  }
  if (fields.originalCurrency !== undefined) {
    requireValidOriginal(
      { amountMinor: fields.originalAmountMinor ?? null, currency: fields.originalCurrency },
      existing.currency,
    );
  }

  const categoryId = fields.categoryId ?? existing.categoryId;
  const deletedAt = fields.deletedAt === undefined ? existing.deletedAt : toDate(fields.deletedAt);
  // Re-checked even when `categoryId` is unchanged: the stored category may have been
  // tombstoned since, and this write is about to make the row live again.
  await requireOwnCategoryForWrite(tx, userId, categoryId, { requireLive: deletedAt === null });

  const revision = await nextRevision(tx, userId);
  const updated = await tx.expense.update({
    where: { id: existing.id },
    data: {
      categoryId,
      ...(fields.kind === undefined ? {} : { kind: fields.kind }),
      ...(fields.amountMinor === undefined ? {} : { amountMinor: BigInt(fields.amountMinor) }),
      ...(fields.currency === undefined ? {} : { currency: fields.currency }),
      ...(fields.originalCurrency === undefined
        ? {}
        : {
            originalAmountMinor:
              fields.originalAmountMinor === undefined || fields.originalAmountMinor === null
                ? null
                : BigInt(fields.originalAmountMinor),
            originalCurrency: fields.originalCurrency,
          }),
      ...(fields.date === undefined ? {} : { date: fromCalendarDate(fields.date) }),
      // `note` is nullable *and* optional: `undefined` means "leave it", `null` means
      // "clear it". Collapsing the two would make clearing a note impossible.
      ...(fields.note === undefined ? {} : { note: fields.note }),
      deletedAt,
      updatedAt: incomingUpdatedAt,
      revision,
    },
  });
  // A tombstone keeps no photo (see `deleteExpense`).
  if (deletedAt !== null) await tx.expenseReceipt.deleteMany({ where: { expenseId: existing.id } });
  return applied(toWireExpense(updated));
}

// ---------------------------------------------------------------------------
// Savings goal
// ---------------------------------------------------------------------------

async function applyGoalItem(
  tx: Db,
  userId: string,
  item: Extract<SyncPushItem, { entity: 'goal' }>,
  now: Date,
): Promise<Outcome> {
  const fields: GoalSyncFields = item.fields;
  const existing: GoalRow | null = await tx.goal.findUnique({ where: { id: item.id } });
  if (existing && existing.userId !== userId) throw idAlreadyInUse();

  const incomingUpdatedAt = clampPushedUpdatedAt(item.updatedAt, now, {
    userId,
    entity: 'goal',
    id: item.id,
  });

  if (!existing) {
    const { name, targetMinor } = fields;
    if (name === undefined || targetMinor === undefined) {
      throw requiredToCreate(
        'goal',
        [
          name === undefined ? 'name' : undefined,
          targetMinor === undefined ? 'targetMinor' : undefined,
        ].filter((field): field is string => field !== undefined),
      );
    }
    const currency = requireAccountCurrency(fields.currency, await accountCurrency(tx, userId));
    const deadline = fields.deadline ?? null;
    const deletedAt = fields.deletedAt === undefined ? null : toDate(fields.deletedAt);

    const revision = await nextRevision(tx, userId);
    const created = await tx.goal.create({
      data: {
        id: item.id,
        userId,
        name,
        targetMinor: BigInt(targetMinor),
        savedMinor: BigInt(fields.savedMinor ?? 0),
        currency,
        deadline: deadline === null ? null : fromCalendarDate(deadline),
        createdAt: now,
        updatedAt: incomingUpdatedAt,
        deletedAt,
        revision,
      },
    });
    return applied(toWireGoal(created));
  }

  if (decideLww({ incomingUpdatedAt, storedUpdatedAt: existing.updatedAt }) !== 'applied') {
    return conflict(toWireGoal(existing));
  }

  if (fields.currency !== undefined) {
    requireAccountCurrency(fields.currency, await accountCurrency(tx, userId));
  }

  const deletedAt = fields.deletedAt === undefined ? existing.deletedAt : toDate(fields.deletedAt);
  const revision = await nextRevision(tx, userId);
  const updated = await tx.goal.update({
    where: { id: existing.id },
    data: {
      ...(fields.name === undefined ? {} : { name: fields.name }),
      ...(fields.targetMinor === undefined ? {} : { targetMinor: BigInt(fields.targetMinor) }),
      ...(fields.savedMinor === undefined ? {} : { savedMinor: BigInt(fields.savedMinor) }),
      ...(fields.currency === undefined ? {} : { currency: fields.currency }),
      ...(fields.deadline === undefined
        ? {}
        : { deadline: fields.deadline === null ? null : fromCalendarDate(fields.deadline) }),
      deletedAt,
      updatedAt: incomingUpdatedAt,
      revision,
    },
  });
  return applied(toWireGoal(updated));
}

// ---------------------------------------------------------------------------
// Recurring rule
// ---------------------------------------------------------------------------

async function applyRecurringItem(
  tx: Db,
  userId: string,
  item: Extract<SyncPushItem, { entity: 'recurring' }>,
  now: Date,
): Promise<Outcome> {
  const fields: RecurringSyncFields = item.fields;
  const existing: RecurringRuleRow | null = await tx.recurringRule.findUnique({
    where: { id: item.id },
  });
  if (existing && existing.userId !== userId) throw idAlreadyInUse();

  const incomingUpdatedAt = clampPushedUpdatedAt(item.updatedAt, now, {
    userId,
    entity: 'recurring',
    id: item.id,
  });

  if (!existing) {
    const { categoryId, amountMinor, frequency, startDate } = fields;
    if (
      categoryId === undefined ||
      amountMinor === undefined ||
      frequency === undefined ||
      startDate === undefined
    ) {
      throw requiredToCreate(
        'recurring',
        [
          categoryId === undefined ? 'categoryId' : undefined,
          amountMinor === undefined ? 'amountMinor' : undefined,
          frequency === undefined ? 'frequency' : undefined,
          startDate === undefined ? 'startDate' : undefined,
        ].filter((name): name is string => name !== undefined),
      );
    }
    const endDate = fields.endDate ?? null;
    requireOrderedDates(startDate, endDate);

    const currency = requireAccountCurrency(fields.currency, await accountCurrency(tx, userId));
    const deletedAt = fields.deletedAt === undefined ? null : toDate(fields.deletedAt);
    await requireOwnCategoryForWrite(tx, userId, categoryId, { requireLive: deletedAt === null });

    const revision = await nextRevision(tx, userId);
    const created = await tx.recurringRule.create({
      data: {
        id: item.id,
        userId,
        categoryId,
        amountMinor: BigInt(amountMinor),
        currency,
        note: fields.note ?? null,
        frequency,
        startDate: fromCalendarDate(startDate),
        endDate: endDate === null ? null : fromCalendarDate(endDate),
        createdAt: now,
        updatedAt: incomingUpdatedAt,
        deletedAt,
        revision,
      },
    });
    return applied(toWireRecurringRule(created));
  }

  if (decideLww({ incomingUpdatedAt, storedUpdatedAt: existing.updatedAt }) !== 'applied') {
    return conflict(toWireRecurringRule(existing));
  }

  if (fields.currency !== undefined) {
    requireAccountCurrency(fields.currency, await accountCurrency(tx, userId));
  }

  // The merged result is what has to make sense: `{ endDate }` alone cannot be judged
  // against a `startDate` it does not carry, so both come from the stored row when absent.
  const startDate = fields.startDate ?? toCalendarDateOf(existing.startDate);
  const endDate =
    fields.endDate === undefined
      ? existing.endDate === null
        ? null
        : toCalendarDateOf(existing.endDate)
      : fields.endDate;
  requireOrderedDates(startDate, endDate);

  const deletedAt = fields.deletedAt === undefined ? existing.deletedAt : toDate(fields.deletedAt);
  // Checked only when the push names a category. A rule whose category was deleted since
  // keeps pointing at it (the device files its expenses under the default instead), so
  // insisting on a live category for an unrelated edit - the amount, say - would refuse a
  // change the user can only fix by picking a category they were never asked about.
  if (fields.categoryId !== undefined) {
    await requireOwnCategoryForWrite(tx, userId, fields.categoryId, {
      requireLive: deletedAt === null,
    });
  }

  const revision = await nextRevision(tx, userId);
  const updated = await tx.recurringRule.update({
    where: { id: existing.id },
    data: {
      ...(fields.categoryId === undefined ? {} : { categoryId: fields.categoryId }),
      ...(fields.amountMinor === undefined ? {} : { amountMinor: BigInt(fields.amountMinor) }),
      ...(fields.currency === undefined ? {} : { currency: fields.currency }),
      ...(fields.note === undefined ? {} : { note: fields.note }),
      ...(fields.frequency === undefined ? {} : { frequency: fields.frequency }),
      startDate: fromCalendarDate(startDate),
      endDate: endDate === null ? null : fromCalendarDate(endDate),
      deletedAt,
      updatedAt: incomingUpdatedAt,
      revision,
    },
  });
  return applied(toWireRecurringRule(updated));
}

function toCalendarDateOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` compares as text, so no parsing and no timezone to get wrong. */
function requireOrderedDates(startDate: string, endDate: string | null): void {
  if (endDate !== null && endDate < startDate) {
    throw problems.validation('`endDate` must not be earlier than `startDate`.', {
      issues: [{ path: 'fields.endDate', message: 'must not be earlier than startDate' }],
    });
  }
}

function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

/**
 * Clamp a pushed `updatedAt`, and say so in the log when the clamp bit.
 *
 * Worth a line each time rather than silently: a clamp firing means a real device has a
 * badly-set clock, which the user will experience as edits that mysteriously lose
 * conflicts. The clamp keeps it from being permanent, but it does not make it *right*,
 * and without a log there is nothing to correlate a support report against.
 */
function clampPushedUpdatedAt(
  raw: string,
  now: Date,
  context: { userId: string; entity: SyncEntity; id: string },
): Date {
  const incoming = new Date(raw);
  if (wasClamped(incoming, now)) {
    logger.warn('clamped a skewed client updatedAt', {
      ...context,
      pushed: raw,
      skewMs: incoming.getTime() - now.getTime(),
    });
  }
  return clampClientUpdatedAt(incoming, now);
}

function applied(record: WireRecord): Outcome {
  return { status: 'applied', record, error: null };
}

function conflict(record: WireRecord): Outcome {
  return { status: 'conflict_server_wins', record, error: null };
}

// ---------------------------------------------------------------------------
// Idempotency ledger
// ---------------------------------------------------------------------------

/** A previously-recorded outcome for a `clientMutationId`. */
interface LedgerEntry {
  readonly status: SyncPushStatus;
  readonly payloadHash: string;
  readonly error: ApiErrorBody | null;
}

async function readLedger(
  tx: Db,
  userId: string,
  clientMutationId: string,
): Promise<LedgerEntry | null> {
  const row = await tx.syncMutation.findUnique({
    where: { userId_clientMutationId: { userId, clientMutationId } },
  });
  if (!row) return null;
  return {
    status: row.status as SyncPushStatus,
    payloadHash: row.payloadHash,
    // The column is `jsonb`, so its static type is `JsonValue`. A CHECK constraint in the
    // migration keeps it non-null exactly when `status` is `invalid`, and the only writer
    // is `recordInLedger` below, so the shape is ours rather than an assumption.
    error: (row.error as unknown as ApiErrorBody | null) ?? null,
  };
}

/**
 * Write the outcome of a mutation to the ledger.
 *
 * Deliberately the *last* statement of an item's savepoint. The primary key is
 * `(user_id, client_mutation_id)`, so when two retries race on two connections the
 * second one's insert blocks on the first, then fails — and because it is last, rolling
 * back to the savepoint undoes the duplicate write *and* returns the revision it
 * allocated. The caller catches the violation and replays the winner's result.
 *
 * Doing the insert first and the write after would be the obvious ordering and the wrong
 * one: the loser would have to undo a write it had already committed to the transaction.
 */
async function recordInLedger(
  tx: Db,
  args: {
    userId: string;
    clientMutationId: string;
    entity: SyncEntity;
    recordId: string;
    payloadHash: string;
    outcome: Outcome;
  },
): Promise<void> {
  await tx.syncMutation.create({
    data: {
      userId: args.userId,
      clientMutationId: args.clientMutationId,
      entity: args.entity,
      recordId: args.recordId,
      status: args.outcome.status,
      payloadHash: args.payloadHash,
      // `undefined` leaves the column at its NULL default, which the migration's CHECK
      // requires for anything that is not `invalid`. The cast is Prisma's `InputJsonValue`
      // refusing an interface with an index-signature-typed member (`details`); the value
      // is an `ApiErrorBody` built from literals, so it is JSON by construction.
      error: (args.outcome.error ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

/**
 * Re-read the authoritative row for a replayed or conflicting result.
 *
 * A replay reports the *recorded status* with the *current row*, not a snapshot taken
 * when the mutation first ran. The status has to be the original one — that is what
 * idempotency means — but the row must be today's, because the client is going to
 * overwrite its local copy with it and a stale copy would undo whatever landed since.
 */
async function currentRecord(
  tx: Db,
  userId: string,
  entity: SyncEntity,
  id: string,
): Promise<WireRecord | null> {
  if (entity === 'recurring') {
    const row = await tx.recurringRule.findFirst({ where: { id, userId } });
    return row ? toWireRecurringRule(row) : null;
  }
  if (entity === 'goal') {
    const row = await tx.goal.findFirst({ where: { id, userId } });
    return row ? toWireGoal(row) : null;
  }
  if (entity === 'category') {
    const row = await tx.category.findFirst({ where: { id, userId } });
    return row ? toWireCategory(row) : null;
  }
  const row = await tx.expense.findFirst({ where: { id, userId } });
  return row ? toWireExpense(row) : null;
}

// ---------------------------------------------------------------------------
// Savepoints
// ---------------------------------------------------------------------------

/**
 * Savepoint names, derived from the item's position rather than from client input.
 *
 * `SAVEPOINT` takes an identifier, not a bind parameter, so the name is interpolated
 * into SQL. Both parts are ours: `index` is an integer this module computed, and
 * `attempt` is one of a handful of literals in this file. That is the only reason the
 * interpolation is safe — never let a client-supplied string reach here.
 */
function savepointName(index: number, attempt: string): string {
  return `sync_item_${index}_${attempt}`;
}

/**
 * Run one item inside a savepoint, so a failure rolls back only that item.
 *
 * This is the mechanism behind "one bad row cannot fail the batch", and it has to be a
 * savepoint rather than a `try`/`catch`: once a statement raises, Postgres marks the
 * whole transaction aborted and every later statement fails with
 * `current transaction is aborted`. A caught exception would leave the batch unable to
 * do anything else. `ROLLBACK TO SAVEPOINT` is what returns the transaction to a usable
 * state — and, usefully, also returns the revision the failed item had allocated, so the
 * per-user sequence stays gap-free.
 */
async function inSavepoint<T>(
  tx: Db,
  index: number,
  attempt: string,
  run: () => Promise<T>,
): Promise<T> {
  // A distinct name per attempt. `ROLLBACK TO SAVEPOINT` does not destroy the savepoint,
  // so reusing the name for the retry would shadow rather than replace it, and the
  // `RELEASE` would pop the wrong one.
  const name = savepointName(index, attempt);
  await tx.$executeRawUnsafe(`SAVEPOINT "${name}"`);
  try {
    const value = await run();
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT "${name}"`);
    return value;
  } catch (error) {
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT "${name}"`);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// The batch
// ---------------------------------------------------------------------------

/** A result plus the position it must occupy in the response. */
interface PositionedResult {
  readonly index: number;
  readonly result: SyncPushResult;
}

function buildResult(args: {
  entity: SyncEntity;
  id: string;
  clientMutationId: string;
  outcome: Outcome;
  idempotentReplay: boolean;
}): SyncPushResult {
  const base = {
    clientMutationId: args.clientMutationId,
    id: args.id,
    status: args.outcome.status,
    idempotentReplay: args.idempotentReplay,
    error: args.outcome.error,
  };
  // Split by entity so `record` is narrowed to the branch's own row type rather than
  // cast. The discriminated union is what gives the client a precise `record` without a
  // cast of its own; building it with one here would waste that.
  if (args.entity === 'category') {
    return {
      entity: 'category',
      ...base,
      record: args.outcome.record as RecordFor<'category'> | null,
    };
  }
  if (args.entity === 'recurring') {
    return {
      entity: 'recurring',
      ...base,
      record: args.outcome.record as RecordFor<'recurring'> | null,
    };
  }
  if (args.entity === 'goal') {
    return { entity: 'goal', ...base, record: args.outcome.record as RecordFor<'goal'> | null };
  }
  return { entity: 'expense', ...base, record: args.outcome.record as RecordFor<'expense'> | null };
}

/**
 * Apply one parsed item: replay, validate, resolve, write, record.
 *
 * The order of the first three steps is the contract's, and each is there for a reason:
 *
 *  1. **Ledger first.** A retry must not be re-validated or re-resolved — it must return
 *     what it returned the first time, whatever that was, including `invalid`.
 *  2. **Payload mismatch second.** The same id with different content means the client
 *     lost track of its outbox. Applying it would write one mutation under another's
 *     idempotency key and hide the bug; `mutation_id_reused` surfaces it.
 *  3. **Item validation third**, as a per-record `invalid` that is itself recorded, so a
 *     retry of a malformed row is a cheap replay rather than a re-parse.
 */
async function attemptItem(
  tx: Db,
  userId: string,
  parsed: ParsedPushItem,
  now: Date,
  savepointTag: string,
): Promise<SyncPushResult> {
  const { identity, payloadHash } = parsed;
  const { entity, id, clientMutationId } = identity;

  const replayOf = async (entry: LedgerEntry): Promise<SyncPushResult> =>
    buildResult({
      entity,
      id,
      clientMutationId,
      outcome: {
        status: entry.status,
        record: await currentRecord(tx, userId, entity, id),
        error: entry.error,
      },
      idempotentReplay: true,
    });

  const existingEntry = await readLedger(tx, userId, clientMutationId);
  if (existingEntry) {
    if (existingEntry.payloadHash === payloadHash) return replayOf(existingEntry);
    return buildResult({
      entity,
      id,
      clientMutationId,
      outcome: {
        status: 'invalid',
        record: await currentRecord(tx, userId, entity, id),
        error: new ApiProblem(
          'mutation_id_reused',
          'This clientMutationId was already used for a different change. Mint a new one.',
          { issues: [{ path: 'clientMutationId', message: 'already used with another payload' }] },
        ).toEnvelope().error,
      },
      idempotentReplay: false,
    });
  }

  const attempt = async (outcomeOf: () => Promise<Outcome>): Promise<Outcome> => {
    const outcome = await outcomeOf();
    await recordInLedger(tx, {
      userId,
      clientMutationId,
      entity,
      recordId: id,
      payloadHash,
      outcome,
    });
    return outcome;
  };

  let outcome: Outcome;
  try {
    outcome = await inSavepoint(tx, parsed.index, `${savepointTag}-apply`, () =>
      attempt(async () => {
        if (parsed.item === null) {
          // Failed its own schema in `parsePushBatch`. Recorded like any other outcome so
          // a retry replays it instead of being parsed again.
          return { status: 'invalid', record: null, error: parsed.error };
        }
        switch (parsed.item.entity) {
          case 'category':
            return applyCategoryItem(tx, userId, parsed.item, now);
          case 'recurring':
            return applyRecurringItem(tx, userId, parsed.item, now);
          case 'goal':
            return applyGoalItem(tx, userId, parsed.item, now);
          default:
            return applyExpenseItem(tx, userId, parsed.item, now);
        }
      }),
    );
  } catch (error) {
    // Lost the race to insert the ledger row: another connection processed this exact
    // mutation while this batch was in flight. The savepoint rollback already undid this
    // item's write, and a fresh read now sees the winner's committed row, so replaying it
    // is both correct and the only answer that does not apply the mutation twice.
    if (isUniqueViolation(error, 'sync_mutations_pkey')) {
      const winner = await readLedger(tx, userId, clientMutationId);
      if (winner) {
        logger.info('sync push lost an idempotency race', { userId, clientMutationId });
        return replayOf(winner);
      }
    }

    // Lost the race to *create the row*, which fires before the ledger insert because the
    // create comes first. Rethrown as `LostCreateRace` so the caller re-runs the item from
    // the top: a fresh read then sees the committed row, and the item resolves as either an
    // idempotent replay or an ordinary last-write-wins update. See {@link applyOne}.
    if (isUniqueViolation(error, `${PRIMARY_KEY_TABLE[entity]}_pkey`)) {
      throw new LostCreateRace(id);
    }

    // The unique partial index on `lower(name)` is the real guard against two live
    // categories sharing a name — two devices inventing "Coffee" offline is an ordinary
    // event, not a race worth pre-checking for.
    const recordError =
      isUniqueViolation(error, 'lower_name') && entity === 'category'
        ? problems.categoryNameTaken(categoryNameOf(parsed) ?? 'that name').toEnvelope().error
        : asRecordError(error);

    if (!recordError) throw error;

    // The savepoint that would have recorded this is gone, so take a second one for the
    // ledger write alone. It can itself lose the idempotency race, which replays.
    try {
      outcome = await inSavepoint(tx, parsed.index, `${savepointTag}-record`, () =>
        attempt(async () => ({ status: 'invalid', record: null, error: recordError })),
      );
    } catch (ledgerError) {
      if (isUniqueViolation(ledgerError, 'sync_mutations_pkey')) {
        const winner = await readLedger(tx, userId, clientMutationId);
        if (winner) return replayOf(winner);
      }
      throw ledgerError;
    }

    // An `invalid` item still reports the server's row when one exists, so a client that
    // sent a bad edit to a real row can converge on what is actually stored.
    return buildResult({
      entity,
      id,
      clientMutationId,
      outcome: { ...outcome, record: await currentRecord(tx, userId, entity, id) },
      idempotentReplay: false,
    });
  }

  return buildResult({ entity, id, clientMutationId, outcome, idempotentReplay: false });
}

/** The table each entity lives in, which names its primary-key constraint. */
const PRIMARY_KEY_TABLE: Readonly<Record<SyncEntity, string>> = {
  category: 'categories',
  recurring: 'recurring_rules',
  goal: 'goals',
  expense: 'expenses',
};

/**
 * Another transaction created this row while we were deciding to create it too.
 *
 * Its own error type rather than a sentinel return, so it cannot be mistaken for a
 * per-record `invalid` — "someone else got there first" is not a client mistake, and
 * reporting it as one would make a client drop a change it should have had applied.
 */
class LostCreateRace extends Error {
  constructor(readonly recordId: string) {
    super(`another transaction created ${recordId} first`);
    this.name = 'LostCreateRace';
  }
}

/**
 * Apply one item, retrying once if another transaction created the row underneath us.
 *
 * Two pushes of the same client-minted id race like this: both read the row and see
 * nothing (it is uncommitted in the other transaction), both decide to create, and one
 * blocks on the primary key until the other commits and then fails. That is not a client
 * error — it is a stale read — so the answer is to run the item again rather than report
 * anything. On the second pass the row is committed and visible, which resolves it as
 * exactly one of two things:
 *
 *  * the same `clientMutationId` raced itself (a retried request, the common case), so the
 *    ledger lookup at the top now finds the winner and the item is an idempotent replay;
 *  * a different mutation created the row, so the item becomes an ordinary update and
 *    last-write-wins decides it.
 *
 * Once, not in a loop: the retry's create path cannot lose the same race again, because
 * the row it would have created is now visible to it.
 */
async function applyOne(
  tx: Db,
  userId: string,
  parsed: ParsedPushItem,
  now: Date,
): Promise<SyncPushResult> {
  try {
    return await attemptItem(tx, userId, parsed, now, 'first');
  } catch (error) {
    if (!(error instanceof LostCreateRace)) throw error;
    logger.info('sync push lost a create race; retrying the item', {
      userId,
      recordId: error.recordId,
      clientMutationId: parsed.identity.clientMutationId,
    });
    return attemptItem(tx, userId, parsed, now, 'retry');
  }
}

/** The pushed name, for the `category_name_taken` message. */
function categoryNameOf(parsed: ParsedPushItem): string | undefined {
  return parsed.item?.entity === 'category' ? parsed.item.fields.name : undefined;
}

/**
 * Transaction settings for a push, all three stated rather than inherited.
 *
 * `isolationLevel` is the one with teeth. A savepoint rollback followed by a re-read has
 * to see what another transaction committed in the meantime — that is how both the
 * idempotency race and the create race resolve — and `RepeatableRead` would forbid
 * exactly that.
 *
 * `timeout` is raised from Prisma's 5-second default because the contract allows 500
 * items in one batch and each one costs several round trips. At the default, a legal
 * full-size batch from a client that had been offline for a day would fail with a
 * transaction timeout — a 500 for a request that is entirely within spec, and one that
 * would only show up under a real device's backlog rather than in a two-item test.
 *
 * `maxWait` is the queue for a connection, which matters when several devices on one
 * account sync at once: they serialise on the user's revision counter row anyway.
 */
const PUSH_TRANSACTION_OPTIONS = {
  isolationLevel: 'ReadCommitted',
  timeout: 60_000,
  maxWait: 15_000,
} as const;

/**
 * Apply a whole batch and answer per record.
 */
export async function pushChanges(
  db: Db,
  userId: string,
  parsed: ParsedPushItem[],
): Promise<SyncPushResponse> {
  const now = new Date();

  const run = async (tx: Db): Promise<SyncPushResult[]> => {
    const results: PositionedResult[] = [];
    // Categories before expenses, so an expense created offline against a category
    // created offline in the same session lands in this one round trip.
    for (const { index, item } of inApplyOrder(parsed, (entry) => entry.identity.entity)) {
      results.push({ index, result: await applyOne(tx, userId, item, now) });
    }
    // Back into request order: the client matches results to its outbox positionally as
    // well as by `clientMutationId`.
    return results.sort((a, b) => a.index - b.index).map((entry) => entry.result);
  };

  const prisma = getPrisma();
  const results =
    db === prisma ? await prisma.$transaction(run, PUSH_TRANSACTION_OPTIONS) : await run(db);

  const counter = await db.revisionCounter.findUnique({ where: { userId } });

  return {
    results,
    serverRevision: counter?.lastRevision ?? 0,
    serverTime: new Date().toISOString(),
  };
}
