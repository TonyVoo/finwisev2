import { DEFAULT_CATEGORIES, LIMITS, UNCATEGORIZED_NAME } from '@expense-tracker/shared';
import { type Clock, systemClock, toTimestamp } from '../lib/clock';
import { uuidv7 } from '../lib/uuidv7';
import type { ExpenseDetail } from './queries';
import type { SqliteDatabase, SqliteExecutor } from './sqlite';
import {
  type LocalMutation,
  type LocalMutationOptions,
  type QueuedMutation,
  applyLocalMutation,
  applyLocalMutationPlan,
  applyLocalMutations,
} from './write';

/**
 * The writes the expense and category screens perform.
 *
 * Every one of them goes through `write.ts`, which is what makes the invariant that
 * matters structural rather than remembered: **the row and its outbox entry are written in
 * one transaction, and `updatedAt` is bumped.** A write that skipped the outbox would never
 * sync, and nothing about the screen would look wrong (`write.ts` module comment).
 *
 * What this module adds on top is the product shape of each operation: which fields a
 * create must carry, what "no change" means for an edit, that a delete is a tombstone, and
 * that deleting a category moves its expenses rather than destroying them.
 *
 * Nothing here touches the network. Sync is a separate task, and these screens are
 * complete without it (`TVO-11`).
 */

/** Everything an expense needs to exist. `note` is optional; the rest is not. */
export interface NewExpense {
  readonly categoryId: string;
  /** Defaults to `expense`. */
  readonly kind?: 'expense' | 'income';
  readonly amountMinor: number;
  readonly currency: string;
  /**
   * What was actually paid, when not in `currency` - both or neither. `amountMinor` stays in
   * `currency`, so every total sums it unchanged.
   */
  readonly originalAmountMinor?: number | null;
  readonly originalCurrency?: string | null;
  readonly date: string;
  readonly note?: string | null;
}

/** The editable fields of an expense, as a draft the form holds. */
export type ExpenseDraft = Omit<NewExpense, 'note' | 'kind'> & {
  readonly originalAmountMinor: number | null;
  readonly originalCurrency: string | null;
  readonly kind: 'expense' | 'income';
  readonly note: string | null;
};

/**
 * A note as it is stored: trimmed, and `null` rather than `''` when nothing is left.
 *
 * `''` and `null` would render differently - an empty subtitle line versus no line - so the
 * two must not both be reachable (`06-expense-form.md` rule 10). The trim matches
 * `ExpenseNote`'s own `.trim()`, so the value the server stores is the value shown here.
 */
export function normaliseNote(note: string | null | undefined): string | null {
  const trimmed = (note ?? '').trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * The original-amount fields a write carries, or none. Sent only when there is something to
 * say, so an ordinary expense's outbox entry is exactly what it was before this existed.
 * Half a pair is refused here, before anything is written, rather than left for the database
 * trigger (or the server) to reject.
 */
function originalFields(expense: {
  readonly originalAmountMinor?: number | null | undefined;
  readonly originalCurrency?: string | null | undefined;
}): Record<string, number | string> {
  const amount = expense.originalAmountMinor ?? null;
  const currency = expense.originalCurrency ?? null;
  if ((amount === null) !== (currency === null)) {
    throw new Error('An original amount and its currency go together.');
  }
  return amount === null || currency === null
    ? {}
    : { originalAmountMinor: amount, originalCurrency: currency };
}

/**
 * Add an expense: one `INSERT` plus one outbox row, in one transaction
 * (`06-expense-form.md` rule 13).
 *
 * The id is a client-minted UUIDv7 and the server accepts it as-is, so this row's identity
 * never changes and an expense created offline against a category created offline keeps a
 * valid reference (`docs/PLAN.md` §Client-generated IDs).
 */
export async function createExpense(
  database: SqliteDatabase,
  expense: NewExpense,
  options: LocalMutationOptions & { readonly id?: string } = {},
): Promise<QueuedMutation> {
  return await applyLocalMutation(
    database,
    {
      entity: 'expense',
      id: options.id ?? uuidv7(),
      fields: {
        categoryId: expense.categoryId,
        kind: expense.kind ?? 'expense',
        amountMinor: expense.amountMinor,
        currency: expense.currency,
        ...originalFields(expense),
        date: expense.date,
        note: normaliseNote(expense.note),
      },
    },
    options,
  );
}

/**
 * The fields of `draft` that differ from the stored row.
 *
 * Two things read this. Save enablement in edit mode - "disabled until something actually
 * changes" (`06-expense-form.md` rule 1, `EXP-11`) - is `changedExpenseFields(...)` being
 * non-empty. And the update itself sends only these keys, because a push is a merge: a
 * field included in `fields` overwrites whatever another device wrote there in the
 * meantime, so sending the whole row would silently undo somebody else's edit.
 */
export function changedExpenseFields(
  stored: ExpenseDetail,
  draft: ExpenseDraft,
): Partial<ExpenseDraft> {
  const changed: Record<string, unknown> = {};
  if (draft.categoryId !== stored.categoryId) changed.categoryId = draft.categoryId;
  if (draft.kind !== stored.kind) changed.kind = draft.kind;
  if (draft.amountMinor !== stored.amountMinor) changed.amountMinor = draft.amountMinor;
  if (draft.currency !== stored.currency) changed.currency = draft.currency;
  // Both halves move together, so a change to either sends both - including both as null,
  // which is how switching a foreign expense back to the account currency is recorded.
  if (
    draft.originalAmountMinor !== stored.originalAmountMinor ||
    draft.originalCurrency !== stored.originalCurrency
  ) {
    changed.originalAmountMinor = draft.originalAmountMinor;
    changed.originalCurrency = draft.originalCurrency;
  }
  if (draft.date !== stored.date) changed.date = draft.date;

  const note = normaliseNote(draft.note);
  if (note !== stored.note) changed.note = note;

  return changed as Partial<ExpenseDraft>;
}

/**
 * Edit an expense. Pass only what changed - {@link changedExpenseFields} is how the form
 * computes that.
 *
 * `updatedAt` is bumped by the write helper, which is what lets last-write-wins order this
 * edit against one made on another device.
 */
export async function updateExpense(
  database: SqliteDatabase,
  id: string,
  changes: Partial<ExpenseDraft>,
  options: LocalMutationOptions = {},
): Promise<QueuedMutation> {
  return await applyLocalMutation(
    database,
    { entity: 'expense', id, fields: { ...changes, note: noteIfPresent(changes) } },
    options,
  );
}

/** `note` normalised when the caller is changing it, and absent when they are not. */
function noteIfPresent(changes: Partial<ExpenseDraft>): string | null | undefined {
  return 'note' in changes ? normaliseNote(changes.note) : undefined;
}

/**
 * Delete an expense: **soft**, by stamping `deletedAt`.
 *
 * A hard local delete cannot be synced as a delete - the row is simply absent, which is
 * indistinguishable from "never seen it" - so the tombstone is a correctness requirement
 * rather than a preference (`docs/PLAN.md` §Deletes). The list excludes it by
 * `deletedAt IS NULL`, so the user sees exactly what a hard delete would have shown them.
 *
 * No confirmation dialog precedes this: the Undo snackbar is the confirmation
 * (`04-expense-list.md` rule 7). The delete is committed to SQLite the moment it happens,
 * so if the app is killed while the snackbar is up, the delete stands (`SYNC-27`).
 */
export async function deleteExpense(
  database: SqliteDatabase,
  id: string,
  options: LocalMutationOptions = {},
): Promise<QueuedMutation> {
  const at = (options.clock ?? systemClock)();
  return await applyLocalMutation(
    database,
    { entity: 'expense', id, fields: { deletedAt: toTimestamp(at) } },
    options,
  );
}

/**
 * Undo a delete, by clearing `deletedAt`.
 *
 * An undelete is an ordinary update in this protocol - the sync field schemas accept
 * `deletedAt: null` - so Undo stays available even after the delete has already reached
 * the server, and there is no race to lose (`04-expense-list.md` rule 9, `EXP-14`).
 */
export async function restoreExpense(
  database: SqliteDatabase,
  id: string,
  options: LocalMutationOptions = {},
): Promise<QueuedMutation> {
  return await applyLocalMutation(
    database,
    { entity: 'expense', id, fields: { deletedAt: null } },
    options,
  );
}

/** A category as the create sheet submits it. */
export interface NewCategory {
  readonly name: string;
  readonly color: string;
  /** Monthly limit in minor units, or omitted / null for none. */
  readonly monthlyBudgetMinor?: number | null;
}

/**
 * Create a category: one row, one outbox entry, one transaction
 * (`07-categories.md` §2 rule 4).
 *
 * `isDefault` is not passed and cannot be: it is server-owned, and only the seeded
 * fallback category carries it, so a locally created category is never a default
 * (`entities.ts`, `CATEGORY_SPEC`).
 */
export async function createCategory(
  database: SqliteDatabase,
  category: NewCategory,
  options: LocalMutationOptions & { readonly id?: string } = {},
): Promise<QueuedMutation> {
  return await applyLocalMutation(
    database,
    {
      entity: 'category',
      id: options.id ?? uuidv7(),
      fields: {
        name: category.name.trim(),
        color: category.color,
        // A create carries the budget only when there is one: absent and null are the same
        // thing on a new row, and the shorter push is the one the server logs less noise for.
        ...(category.monthlyBudgetMinor === undefined || category.monthlyBudgetMinor === null
          ? {}
          : { monthlyBudgetMinor: category.monthlyBudgetMinor }),
      },
    },
    options,
  );
}

/**
 * Rename or recolour a category.
 *
 * **Expenses are untouched.** They reference `categoryId`, so a rename is invisible to
 * them and no reassignment occurs - which is also why a rename must not bump them onto the
 * next sync page (`07-categories.md` §3 rule 5, `CAT-03`).
 */
export async function updateCategory(
  database: SqliteDatabase,
  id: string,
  changes: {
    readonly name?: string;
    readonly color?: string;
    /** A number sets the budget, null clears it, undefined leaves it alone. */
    readonly monthlyBudgetMinor?: number | null;
  },
  options: LocalMutationOptions = {},
): Promise<QueuedMutation> {
  return await applyLocalMutation(
    database,
    {
      entity: 'category',
      id,
      fields: {
        ...(changes.name === undefined ? {} : { name: changes.name.trim() }),
        ...(changes.color === undefined ? {} : { color: changes.color }),
        ...(changes.monthlyBudgetMinor === undefined
          ? {}
          : { monthlyBudgetMinor: changes.monthlyBudgetMinor }),
      },
    },
    options,
  );
}

/** What a category delete did, which is what its snackbar reports (`CAT-10`). */
export interface CategoryDeletion {
  /** Live expenses moved to the fallback category. */
  readonly movedCount: number;
  /** The fallback category's name at the moment of the delete, for the snackbar. */
  readonly fallbackName: string;
  readonly fallbackId: string;
  /** True when the fallback category had to be recreated first (§4 rule 9). */
  readonly fallbackRepaired: boolean;
}

/**
 * Attempted deletion of the `isDefault` category.
 *
 * Guarded at three levels before this throws - no swipe action on the row, no Delete button
 * in its sheet, and the server's `category_not_deletable` - so reaching it is a bug or an
 * `accessibilityAction` path the design covers with a snackbar rather than silence
 * (`07-categories.md` §4 rule 12).
 */
export class CategoryNotDeletableError extends Error {
  readonly categoryId: string;
  readonly fallbackName: string;

  constructor(categoryId: string, fallbackName: string) {
    super(`Category ${categoryId} is the fallback category and cannot be deleted`);
    this.name = 'CategoryNotDeletableError';
    this.categoryId = categoryId;
    this.fallbackName = fallbackName;
  }
}

/** A delete asked for a category that is not there - already deleted, or never existed. */
export class CategoryNotFoundError extends Error {
  constructor(categoryId: string) {
    super(`Category ${categoryId} is not a live category`);
    this.name = 'CategoryNotFoundError';
  }
}

interface CategoryRowForDelete {
  readonly id: string;
  readonly name: string;
  readonly isDefault: number;
}

/**
 * Delete a category and **move** its expenses to the fallback category.
 *
 * The flow the acceptance criteria single out, and the one with the most ways to be subtly
 * wrong. In **one** transaction (`07-categories.md` §4 rule 6):
 *
 * 1. every live expense pointing at this category is reassigned to the `isDefault`
 *    category's id, each with its own bumped `updatedAt` and its own outbox entry,
 * 2. the category is soft-deleted,
 * 3. one outbox entry exists per changed record - the category plus every expense.
 *
 * Why each part is the way it is:
 *
 * - **Reassign, never cascade.** Losing spend history to a category cleanup would be a
 *   data-loss bug (`docs/PLAN.md` §Deletes, `CAT-05`), and the dialog has already promised
 *   the user the expenses survive.
 * - **One transaction**, because a crash between the two halves would leave expenses
 *   pointing at a deleted category. The membership of the batch is also read inside it, so
 *   an expense arriving by sync mid-operation cannot be missed.
 * - **The reassignment is pushed as the expenses' new `categoryId`**, not as an instruction
 *   to re-derive it, so a peer converges on the same state (§4 rule 7, `CAT-06`).
 * - **Tombstoned expenses are left alone.** They are already deleted; moving them would
 *   bump their `updatedAt` for no visible reason and the count the user was shown excludes
 *   them (`CAT-05`, `CAT-09`).
 * - **No Undo**, which is why this flow has a confirmation dialog and expense delete does
 *   not (§4 rule 10).
 */
export async function deleteCategoryWithReassignment(
  database: SqliteDatabase,
  categoryId: string,
  options: LocalMutationOptions = {},
): Promise<CategoryDeletion> {
  const at = (options.clock ?? systemClock)();
  const deletedAt = toTimestamp(at);

  let result: CategoryDeletion | null = null;

  await applyLocalMutationPlan(
    database,
    async (txn) => {
      const target = await txn.getFirstAsync<CategoryRowForDelete>(
        'SELECT id, name, isDefault FROM categories WHERE id = ? AND deletedAt IS NULL',
        [categoryId],
      );
      if (target === null) throw new CategoryNotFoundError(categoryId);

      const fallback = await resolveFallback(txn, target, deletedAt);
      if (target.isDefault === 1 || target.id === fallback.id) {
        throw new CategoryNotDeletableError(categoryId, fallback.name);
      }

      const toReassign = await txn.getAllAsync<{ id: string }>(
        'SELECT id FROM expenses WHERE categoryId = ? AND deletedAt IS NULL',
        [categoryId],
      );

      result = {
        movedCount: toReassign.length,
        fallbackName: fallback.name,
        fallbackId: fallback.id,
        fallbackRepaired: fallback.repaired,
      };

      // Categories before expenses, matching `SYNC_APPLY_ORDER`. The drain already sorts
      // by entity, so this is not what makes the push ordered - it keeps the outbox
      // readable in the order the server will apply it.
      return [
        { entity: 'category', id: categoryId, fields: { deletedAt } },
        ...toReassign.map((expense): LocalMutation => ({
          entity: 'expense',
          id: expense.id,
          fields: { categoryId: fallback.id },
        })),
      ];
    },
    options,
  );

  if (result === null) {
    throw new CategoryNotFoundError(categoryId);
  }
  return result;
}

interface ResolvedFallback {
  readonly id: string;
  readonly name: string;
  readonly repaired: boolean;
}

/**
 * The live `isDefault` category, recreating it if it is gone (§4 rule 9).
 *
 * Exactly one live category must have `isDefault: true`. If none does - reachable only via
 * a buggy or hostile peer - the client recreates it rather than blocking the delete, and
 * must never pick an arbitrary other category as the target.
 *
 * Two deliberate departures from the rest of this module, both forced by the recreate
 * being a *local invariant* repair:
 *
 * - The row is written here with raw SQL inside the caller's transaction, not through a
 *   mutation, because `isDefault` is server-owned and is not a field
 *   `CategorySyncFields` can carry. A mutation would create the row without its flag,
 *   leaving the invariant still broken.
 * - It is therefore **not queued**, so the recreated fallback is local-only until the
 *   server's own default comes back on a pull. Pushing a category the wire cannot mark as
 *   default would create an ordinary second category on the server, which is worse than
 *   waiting. Raised on `TVO-11` for Chief: a client cannot tell the server about a default
 *   it had to recreate, and the contract has no field for it.
 */
async function resolveFallback(
  txn: SqliteExecutor,
  target: CategoryRowForDelete,
  at: string,
): Promise<ResolvedFallback> {
  const existing = await txn.getFirstAsync<{ id: string; name: string }>(
    `SELECT id, name FROM categories
      WHERE isDefault = 1 AND deletedAt IS NULL
      ORDER BY id
      LIMIT 1`,
    [],
  );
  if (existing !== null) {
    return { id: existing.id, name: existing.name, repaired: false };
  }

  const id = uuidv7();
  // Name and colour from the contract's own seed list rather than retyped here, so the
  // recreated row is indistinguishable from the one the server seeds.
  await txn.runAsync(
    `INSERT INTO categories (id, name, color, isDefault, createdAt, updatedAt, deletedAt, revision)
     VALUES (?, ?, ?, 1, NULL, ?, NULL, 0)`,
    [id, UNCATEGORIZED_NAME, DEFAULT_CATEGORIES[0].color, at],
  );
  return { id, name: UNCATEGORIZED_NAME, repaired: true };
}

/** Re-exported so screens import one module for a local write. */
export type { Clock, LocalMutationOptions, QueuedMutation };

// ---------------------------------------------------------------------------
// Recurring rules
// ---------------------------------------------------------------------------

/** A recurring rule as the form submits it. */
export interface NewRecurring {
  readonly categoryId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly note: string | null;
  readonly frequency: 'weekly' | 'monthly';
  readonly startDate: string;
  readonly endDate: string | null;
}

/**
 * Create a rule: one row, one outbox entry, one transaction. The expenses it is due to
 * produce are made by `generateDueRecurring`, which the caller runs next so a rule started
 * in the past shows its backfilled expenses straight away.
 */
export async function createRecurring(
  database: SqliteDatabase,
  rule: NewRecurring,
  options: LocalMutationOptions & { readonly id?: string } = {},
): Promise<QueuedMutation> {
  return await applyLocalMutation(
    database,
    {
      entity: 'recurring',
      id: options.id ?? uuidv7(),
      fields: {
        categoryId: rule.categoryId,
        amountMinor: rule.amountMinor,
        currency: rule.currency,
        note: normaliseNote(rule.note),
        frequency: rule.frequency,
        startDate: rule.startDate,
        // Absent and null mean the same on a new row; the shorter push omits it.
        ...(rule.endDate === null ? {} : { endDate: rule.endDate }),
      },
    },
    options,
  );
}

/**
 * Change a rule. Only the named fields are written and queued.
 *
 * **Expenses already generated are untouched**: they are ordinary expenses now, and editing
 * the rule changes what it produces from here on, not history. The one exception to
 * "untouched" is by design - occurrences are recomputed from `startDate`, so moving it
 * earlier backfills the newly covered dates and moving it later stops nothing that exists.
 */
export async function updateRecurring(
  database: SqliteDatabase,
  id: string,
  changes: Partial<NewRecurring>,
  options: LocalMutationOptions = {},
): Promise<QueuedMutation> {
  return await applyLocalMutation(
    database,
    {
      entity: 'recurring',
      id,
      fields: {
        ...(changes.categoryId === undefined ? {} : { categoryId: changes.categoryId }),
        ...(changes.amountMinor === undefined ? {} : { amountMinor: changes.amountMinor }),
        ...(changes.currency === undefined ? {} : { currency: changes.currency }),
        ...(changes.note === undefined ? {} : { note: normaliseNote(changes.note) }),
        ...(changes.frequency === undefined ? {} : { frequency: changes.frequency }),
        ...(changes.startDate === undefined ? {} : { startDate: changes.startDate }),
        ...(changes.endDate === undefined ? {} : { endDate: changes.endDate }),
      },
    },
    options,
  );
}

/**
 * Stop a rule: a tombstone. Nothing it generated is removed - those expenses are real
 * spending that happened - and nothing more is generated.
 */
export async function deleteRecurring(
  database: SqliteDatabase,
  id: string,
  options: LocalMutationOptions = {},
): Promise<QueuedMutation> {
  const stamp = (options.clock ?? systemClock)();
  return await applyLocalMutation(
    database,
    { entity: 'recurring', id, fields: { deletedAt: toTimestamp(stamp) } },
    options,
  );
}

/** Everything a savings goal needs to exist. `savedMinor` is the starting balance. */
export interface NewGoal {
  readonly name: string;
  readonly targetMinor: number;
  readonly savedMinor: number;
  readonly currency: string;
  readonly deadline: string | null;
}

export async function createGoal(
  database: SqliteDatabase,
  goal: NewGoal,
  options: LocalMutationOptions & { readonly id?: string } = {},
): Promise<QueuedMutation> {
  return await applyLocalMutation(
    database,
    {
      entity: 'goal',
      id: options.id ?? uuidv7(),
      fields: {
        name: goal.name.trim(),
        targetMinor: goal.targetMinor,
        savedMinor: goal.savedMinor,
        currency: goal.currency,
        ...(goal.deadline === null ? {} : { deadline: goal.deadline }),
      },
    },
    options,
  );
}

/** Change a goal. Only the named fields are written and queued. */
export async function updateGoal(
  database: SqliteDatabase,
  id: string,
  changes: Partial<Omit<NewGoal, 'currency'>>,
  options: LocalMutationOptions = {},
): Promise<QueuedMutation> {
  return await applyLocalMutation(
    database,
    {
      entity: 'goal',
      id,
      fields: {
        ...changes,
        ...(changes.name === undefined ? {} : { name: changes.name.trim() }),
      },
    },
    options,
  );
}

/**
 * Record a deposit: the new total is the stored one plus the amount, read here rather than
 * taken from the screen so two deposits in a row cannot both start from the same stale
 * balance. Capped at the contract's largest amount instead of failing the write.
 */
export async function depositToGoal(
  database: SqliteDatabase,
  id: string,
  amountMinor: number,
  options: LocalMutationOptions = {},
): Promise<QueuedMutation> {
  const row = await database.getFirstAsync<{ savedMinor: number }>(
    'SELECT savedMinor FROM goals WHERE id = ? AND deletedAt IS NULL',
    [id],
  );
  const saved = Math.min((row?.savedMinor ?? 0) + amountMinor, LIMITS.AMOUNT_MINOR_MAX);
  return await updateGoal(database, id, { savedMinor: saved }, options);
}

/** Delete a goal: a tombstone, like every other delete. */
export async function deleteGoal(
  database: SqliteDatabase,
  id: string,
  options: LocalMutationOptions = {},
): Promise<QueuedMutation> {
  const stamp = (options.clock ?? systemClock)();
  return await applyLocalMutation(
    database,
    { entity: 'goal', id, fields: { deletedAt: toTimestamp(stamp) } },
    options,
  );
}

/**
 * Rename several categories at once: one transaction, one outbox entry per category, each
 * carrying only `name`. All or none - a blank or over-long name rejects the whole batch
 * before anything is written, so a half-renamed set never reaches the screen or the server.
 *
 * An ordinary edit in every other respect, so it syncs like one. Used for the one-time offer
 * to give the untouched default categories Vietnamese names (`categories/renameDefaults.ts`).
 */
export async function renameCategories(
  database: SqliteDatabase,
  renames: readonly { readonly id: string; readonly to: string }[],
  options: LocalMutationOptions = {},
): Promise<readonly QueuedMutation[]> {
  if (renames.length === 0) return [];
  return await applyLocalMutations(
    database,
    renames.map(({ id, to }) => ({
      entity: 'category' as const,
      id,
      fields: { name: to.trim() },
    })),
    options,
  );
}
