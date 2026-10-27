import {
  CategorySyncFields,
  ExpenseSyncFields,
  GoalSyncFields,
  RecurringSyncFields,
  type SyncEntity,
} from '@expense-tracker/shared';
import type { SqliteBindValue } from './sqlite';

/**
 * How each syncable entity maps onto its local table.
 *
 * The local schema deliberately mirrors the wire contract column-for-column (see the
 * note in `migrations.ts`), so these specs are small. What they buy is that the write
 * helper is written **once** instead of once per entity: it reads the spec and builds
 * the SQL, so categories and expenses cannot drift apart in how they are persisted or
 * how they are queued.
 */

/** A row of the local `categories` table. */
export interface CategoryRow {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  /** SQLite has no boolean type; migration 1 constrains this to 0 or 1. */
  readonly isDefault: 0 | 1;
  /** Monthly limit in minor units; null means no budget (migration 5). */
  readonly monthlyBudgetMinor: number | null;
  /** Server-assigned. Null until the row has been round-tripped through sync. */
  readonly createdAt: string | null;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
  readonly revision: number;
}

/** A row of the local `expenses` table. */
export interface ExpenseRow {
  readonly id: string;
  readonly categoryId: string;
  /** `expense` or `income` (migration 9). */
  readonly kind: 'expense' | 'income';
  readonly amountMinor: number;
  readonly currency: string;
  /** Calendar date `YYYY-MM-DD`. Never a timestamp. */
  readonly date: string;
  readonly note: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
  readonly revision: number;
}

/** A row of the local `goals` table (migration 10). */
export interface GoalRow {
  readonly id: string;
  readonly name: string;
  readonly targetMinor: number;
  readonly savedMinor: number;
  readonly currency: string;
  /** Calendar date `YYYY-MM-DD`, or null for no deadline. */
  readonly deadline: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
  readonly revision: number;
}

/** A row of the local `recurring` table (migration 6). */
export interface RecurringRow {
  readonly id: string;
  readonly categoryId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly note: string | null;
  readonly frequency: 'weekly' | 'monthly';
  /** Calendar date `YYYY-MM-DD`. */
  readonly startDate: string;
  readonly endDate: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
  readonly revision: number;
}

export interface LocalRowByEntity {
  readonly category: CategoryRow;
  readonly recurring: RecurringRow;
  readonly goal: GoalRow;
  readonly expense: ExpenseRow;
}

export interface EntitySpec {
  readonly entity: SyncEntity;
  readonly table: string;
  /**
   * Columns a push may carry, i.e. the keys of this entity's sync-fields schema in
   * `@expense-tracker/shared`. `tests/db/entities.test.ts` asserts the two lists are
   * identical, so a field added to the contract fails the build here rather than being
   * silently dropped on its way to the server.
   */
  readonly mutableColumns: readonly string[];
  /**
   * Columns that are `NOT NULL` locally with no default, so a mutation that creates the
   * row has to supply them. The server has the same requirement (an incomplete create
   * comes back `invalid`); checking locally means the user finds out at the point of the
   * write instead of a sync pass later.
   */
  readonly requiredOnCreate: readonly string[];
  /** Values used on insert for every column `fields` does not carry. */
  readonly insertDefaults: Readonly<Record<string, SqliteBindValue>>;
  /** Validate and normalise the mutated fields. Throws `ZodError` on a bad shape. */
  readonly parseFields: (fields: unknown) => Record<string, unknown>;
}

/**
 * `revision: 0` and `createdAt: null` together mean "the server has never seen this
 * row". `isDefault` is server-owned — only the seeded `Uncategorized` category is a
 * default, so a locally created one never is.
 */
const CATEGORY_SPEC: EntitySpec = {
  entity: 'category',
  table: 'categories',
  mutableColumns: ['name', 'color', 'monthlyBudgetMinor', 'deletedAt'],
  requiredOnCreate: ['name', 'color'],
  insertDefaults: {
    isDefault: 0,
    monthlyBudgetMinor: null,
    createdAt: null,
    deletedAt: null,
    revision: 0,
  },
  parseFields: (fields) => CategorySyncFields.parse(fields),
};

/**
 * `currency` is optional on the wire (the server fills in the user's currency) but
 * `NOT NULL` locally, because a row the UI renders before its first sync still has to
 * show an amount. The caller passes the user's currency.
 */
const EXPENSE_SPEC: EntitySpec = {
  entity: 'expense',
  table: 'expenses',
  mutableColumns: ['categoryId', 'kind', 'amountMinor', 'currency', 'date', 'note', 'deletedAt'],
  requiredOnCreate: ['categoryId', 'amountMinor', 'currency', 'date'],
  insertDefaults: { kind: 'expense', note: null, createdAt: null, deletedAt: null, revision: 0 },
  parseFields: (fields) => ExpenseSyncFields.parse(fields),
};

const RECURRING_SPEC: EntitySpec = {
  entity: 'recurring',
  table: 'recurring',
  mutableColumns: [
    'categoryId',
    'amountMinor',
    'currency',
    'note',
    'frequency',
    'startDate',
    'endDate',
    'deletedAt',
  ],
  requiredOnCreate: ['categoryId', 'amountMinor', 'currency', 'frequency', 'startDate'],
  insertDefaults: { note: null, endDate: null, createdAt: null, deletedAt: null, revision: 0 },
  parseFields: (fields) => RecurringSyncFields.parse(fields),
};

const GOAL_SPEC: EntitySpec = {
  entity: 'goal',
  table: 'goals',
  mutableColumns: ['name', 'targetMinor', 'savedMinor', 'currency', 'deadline', 'deletedAt'],
  requiredOnCreate: ['name', 'targetMinor', 'currency'],
  insertDefaults: { savedMinor: 0, deadline: null, createdAt: null, deletedAt: null, revision: 0 },
  parseFields: (fields) => GoalSyncFields.parse(fields),
};

export const ENTITY_SPECS: Readonly<Record<SyncEntity, EntitySpec>> = {
  category: CATEGORY_SPEC,
  recurring: RECURRING_SPEC,
  goal: GOAL_SPEC,
  expense: EXPENSE_SPEC,
};

export function entitySpec(entity: SyncEntity): EntitySpec {
  return ENTITY_SPECS[entity];
}
