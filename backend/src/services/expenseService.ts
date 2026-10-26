import {
  LIMITS,
  type Expense as WireExpense,
  type ExpenseCreateRequest,
  type ExpenseListQuery,
  type ExpenseListResponse,
  type ExpenseUpdateRequest,
} from '@expense-tracker/shared';
import { v7 as uuidv7 } from 'uuid';
import type { Db } from '../db/client.ts';
import { fromCalendarDate, toCalendarDate, toWireExpense } from '../db/mappers.ts';
import { nextRevision } from '../db/revision.ts';
import { problems } from '../errors.ts';
import { decodeExpenseCursor, encodeExpenseCursor } from '../http/cursor.ts';
import { requireLiveCategoryForWrite } from './categoryService.ts';
import type { Expense as ExpenseRow, Prisma } from '../db/generated/client.ts';

/**
 * Expense CRUD and the keyset-paginated list.
 *
 * What this file is actually responsible for, beyond shuttling fields:
 *
 *  * **`categoryId` must name a live category of the caller.** The check takes a row
 *    lock so it cannot be raced by a category delete — see
 *    {@link requireLiveCategoryForWrite}.
 *  * **`currency` must equal the account's.** One currency per user in the MVP and no
 *    conversion, so storing an expense in another currency would silently corrupt every
 *    total that sums `amountMinor`.
 *  * **Pagination is keyset, not offset**, so a write landing between two pages cannot
 *    skip or repeat a row. With an actively syncing client that is the normal case.
 *  * Every write advances `updatedAt` *and* takes the next per-user `revision`. A write
 *    that does not advance `revision` is a write no syncing client will ever see.
 */

/**
 * Read the account's currency.
 *
 * Denormalised onto each expense so a row is self-describing, but validated against the
 * account on every write: the alternative is a `GET /v1/me` the client is trusted to
 * have read correctly.
 */
export async function accountCurrency(db: Db, userId: string): Promise<string> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { currency: true } });
  if (!user) {
    // The token verified, so the account existed when it was minted. `/v1/me` reports the
    // same situation as `token_invalid`: the client's correct move is to re-login.
    throw problems.tokenInvalid('Access token does not belong to an existing account.');
  }
  return user.currency;
}

/**
 * Validate a client-supplied `currency` against the account's.
 *
 * A mismatch is `400 validation_error`, not `422`: there is no conversion in the MVP, so
 * `EUR` on a `USD` account is a malformed request rather than a referential failure.
 */
export function requireAccountCurrency(supplied: string | undefined, accounts: string): string {
  if (supplied === undefined) return accounts;
  if (supplied !== accounts) {
    throw problems.validation(
      `This account is in ${accounts}; there is no currency conversion in the MVP.`,
      { issues: [{ path: 'currency', message: `must be ${accounts}` }] },
    );
  }
  return supplied;
}

/**
 * Resolve a `POST` with a client-supplied id that is already in use.
 *
 * Mirrors the category path: the caller's own row comes back for an idempotent replay,
 * and another user's id is refused without revealing whose it is. See
 * `createCategory`'s doc comment for why a replay is not an upsert.
 */
async function findForIdempotentCreate(
  db: Db,
  userId: string,
  id: string,
): Promise<ExpenseRow | null> {
  const existing = await db.expense.findUnique({ where: { id } });
  if (!existing) return null;
  if (existing.userId !== userId) {
    throw problems.validation('The supplied id is already in use.', {
      issues: [{ path: 'id', message: 'already in use' }],
    });
  }
  return existing;
}

/** Load a live expense of this user, or raise the contract's `404`. */
async function requireOwnLiveExpense(db: Db, userId: string, id: string): Promise<ExpenseRow> {
  const row = await db.expense.findFirst({ where: { id, userId, deletedAt: null } });
  if (!row) {
    // "No such id", "another user's id" and "tombstoned" are one message, because they
    // have to be indistinguishable — anything else probes for existence.
    throw problems.notFound('No such expense.');
  }
  return row;
}

/**
 * `POST /v1/expenses`.
 *
 * Accepts a client-minted UUIDv7 and is idempotent on a re-post of the same id: the
 * stored row comes back unchanged, with no new `revision`. Not an upsert — a re-post's
 * field values are ignored rather than applied; `PATCH` is how a field changes.
 */
export async function createExpense(
  db: Db,
  userId: string,
  input: ExpenseCreateRequest,
): Promise<WireExpense> {
  const id = input.id ?? uuidv7();
  const now = new Date();

  return db.$transaction(async (tx) => {
    const replay = await findForIdempotentCreate(tx, userId, id);
    if (replay) return toWireExpense(replay);

    const currency = requireAccountCurrency(input.currency, await accountCurrency(tx, userId));
    await requireLiveCategoryForWrite(tx, userId, input.categoryId);

    const revision = await nextRevision(tx, userId);
    const created = await tx.expense.create({
      data: {
        id,
        userId,
        categoryId: input.categoryId,
        amountMinor: BigInt(input.amountMinor),
        currency,
        date: fromCalendarDate(input.date),
        // Only absence to handle: `ExpenseNoteInput` has already turned a note that
        // trims to nothing into `null`, which `?? null` could not have (`""` is not
        // nullish). See `shared/src/expense.ts`.
        note: input.note ?? null,
        // Set explicitly rather than left to the column default, so a freshly created row
        // reports `createdAt === updatedAt` to the millisecond.
        createdAt: now,
        updatedAt: now,
        revision,
      },
    });
    return toWireExpense(created);
  });
}

/** `PATCH /v1/expenses/:id`. Partial; `note` may be set to `null` to clear it. */
export async function updateExpense(
  db: Db,
  userId: string,
  id: string,
  patch: ExpenseUpdateRequest,
): Promise<WireExpense> {
  const now = new Date();

  return db.$transaction(async (tx) => {
    const existing = await requireOwnLiveExpense(tx, userId, id);

    if (patch.currency !== undefined) {
      requireAccountCurrency(patch.currency, await accountCurrency(tx, userId));
    }
    if (patch.categoryId !== undefined) {
      await requireLiveCategoryForWrite(tx, userId, patch.categoryId);
    }

    const revision = await nextRevision(tx, userId);
    const updated = await tx.expense.update({
      where: { id: existing.id },
      data: {
        ...(patch.categoryId === undefined ? {} : { categoryId: patch.categoryId }),
        ...(patch.amountMinor === undefined ? {} : { amountMinor: BigInt(patch.amountMinor) }),
        ...(patch.currency === undefined ? {} : { currency: patch.currency }),
        ...(patch.date === undefined ? {} : { date: fromCalendarDate(patch.date) }),
        // `note` is nullable *and* optional, so `undefined` means "leave it" and `null`
        // means "clear it". Collapsing the two would make clearing a note impossible.
        ...(patch.note === undefined ? {} : { note: patch.note }),
        updatedAt: now,
        revision,
      },
    });
    return toWireExpense(updated);
  });
}

/**
 * `DELETE /v1/expenses/:id` — soft delete, returning the tombstone.
 *
 * Idempotent: a second delete returns the existing tombstone with the same `updatedAt`
 * and `revision`, so a retry does not push the row onto another sync page.
 */
export async function deleteExpense(db: Db, userId: string, id: string): Promise<WireExpense> {
  const now = new Date();

  return db.$transaction(async (tx) => {
    const existing = await tx.expense.findFirst({ where: { id, userId } });
    if (!existing) throw problems.notFound('No such expense.');
    if (existing.deletedAt !== null) return toWireExpense(existing);

    const revision = await nextRevision(tx, userId);
    const tombstoned = await tx.expense.update({
      where: { id: existing.id },
      data: { deletedAt: now, updatedAt: now, revision },
    });
    return toWireExpense(tombstoned);
  });
}

/**
 * `GET /v1/expenses` — a filtered page, newest `date` first, ties broken by `id`
 * descending.
 *
 * The keyset predicate is `(date, id) < (cursor.date, cursor.id)` under that ordering,
 * expressed as the two-branch `OR` below because that is the form an index can serve.
 * One extra row is fetched to decide `hasMore` without a second `COUNT` query, and
 * dropped before the page is returned.
 */
export async function listExpenses(
  db: Db,
  userId: string,
  query: ExpenseListQuery,
): Promise<ExpenseListResponse> {
  const limit = query.limit ?? LIMITS.EXPENSE_LIST_DEFAULT_LIMIT;

  const where: Prisma.ExpenseWhereInput = {
    userId,
    ...(query.includeDeleted ? {} : { deletedAt: null }),
    // An unknown `categoryId` is deliberately not an error: it matches nothing and
    // returns an empty page, which is also what makes another user's category id
    // indistinguishable from a non-existent one here.
    ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
    ...(query.from === undefined && query.to === undefined
      ? {}
      : {
          date: {
            ...(query.from === undefined ? {} : { gte: fromCalendarDate(query.from) }),
            // Both bounds are inclusive, so a calendar month is
            // `from=2026-10-01&to=2026-10-31` with no off-by-one at either end.
            ...(query.to === undefined ? {} : { lte: fromCalendarDate(query.to) }),
          },
        }),
  };

  if (query.cursor !== undefined) {
    const cursor = decodeExpenseCursor(query.cursor);
    const cursorDate = fromCalendarDate(cursor.date);
    // Kept in `AND` so it composes with the `date` range above instead of overwriting it.
    where.AND = [
      {
        OR: [{ date: { lt: cursorDate } }, { date: cursorDate, id: { lt: cursor.id } }],
      },
    ];
  }

  const rows = await db.expense.findMany({
    where,
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);

  return {
    data: page.map(toWireExpense),
    // Null on the last page, so `nextCursor !== null` and `hasMore` cannot disagree.
    nextCursor:
      hasMore && last
        ? encodeExpenseCursor({ date: toCalendarDate(last.date), id: last.id })
        : null,
    hasMore,
  };
}
