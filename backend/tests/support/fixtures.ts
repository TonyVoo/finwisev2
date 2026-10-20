import type { Category, Expense } from '@expense-tracker/shared';
import { v7 as uuidv7 } from 'uuid';
import { getPrisma } from '../../src/db/client.ts';
import { api, bearer, signUp, type SignedUpUser } from './api.ts';

/**
 * Fixtures for the CRUD suites.
 *
 * Everything here goes through the real HTTP endpoints rather than seeding Prisma
 * directly, so a fixture cannot construct a row the API itself would refuse — which is
 * how a test ends up asserting against state the server can never actually be in.
 * `revisionWatermark` is the one exception, and it reads rather than writes.
 */

export interface TestUser extends SignedUpUser {
  /** `Authorization` header value for this user's access token. */
  readonly auth: string;
  /** The six categories seeded at signup, by name. */
  readonly categories: Readonly<Record<string, Category>>;
  /** The seeded `isDefault` category — the target a category delete reassigns to. */
  readonly defaultCategory: Category;
}

/** Sign up, then read back the seeded categories. */
export async function createUser(overrides: { currency?: string } = {}): Promise<TestUser> {
  const session = await signUp(overrides);
  const auth = bearer(session.accessToken);

  const response = await api().get('/v1/categories').set('Authorization', auth);
  if (response.status !== 200) {
    throw new Error(`fixture could not list categories: ${response.status}`);
  }

  const list = response.body.data as Category[];
  const categories = Object.fromEntries(list.map((c) => [c.name, c]));
  const defaultCategory = list.find((c) => c.isDefault);
  if (!defaultCategory) throw new Error('signup seeded no default category');

  return { ...session, auth, categories, defaultCategory };
}

export interface ExpenseInput {
  readonly id?: string;
  readonly categoryId: string;
  readonly amountMinor?: number;
  readonly currency?: string;
  readonly date?: string;
  readonly note?: string | null;
}

/** Create an expense through `POST /v1/expenses`, asserting it worked. */
export async function createExpense(user: TestUser, input: ExpenseInput): Promise<Expense> {
  const response = await api()
    .post('/v1/expenses')
    .set('Authorization', user.auth)
    .send({
      ...(input.id === undefined ? {} : { id: input.id }),
      categoryId: input.categoryId,
      amountMinor: input.amountMinor ?? 1234,
      date: input.date ?? '2026-10-06',
      ...(input.currency === undefined ? {} : { currency: input.currency }),
      ...(input.note === undefined ? {} : { note: input.note }),
    });

  if (response.status !== 201) {
    throw new Error(
      `fixture could not create an expense: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
  return response.body.data as Expense;
}

/** A fresh UUIDv7, for the client-minted-id cases. */
export function clientId(): string {
  return uuidv7();
}

/**
 * The user's current `revision` watermark — the highest revision they have been handed.
 *
 * This is what a sync cursor would be sitting at. Read from the counter rather than from
 * `max(revision)` over the rows, so it is still correct when the most recent write was
 * rolled back.
 */
export async function revisionWatermark(userId: string): Promise<number> {
  const counter = await getPrisma().revisionCounter.findUniqueOrThrow({ where: { userId } });
  return counter.lastRevision;
}

/**
 * Every row of the user that a sync pull would deliver after `since`.
 *
 * The pull's selection predicate — `revision > cursor`, ordered by `revision` — applied
 * directly to the tables. `GET /v1/sync` now exists, and the suites that test it use the
 * real endpoint (`tests/support/sync.ts`); this stays as the independent restatement of
 * what the endpoint is *supposed* to select, so a CRUD test can assert "this write
 * reaches a syncing client" without depending on the implementation it would be
 * checking.
 */
export async function changesSince(
  userId: string,
  since: number,
): Promise<{ entity: 'category' | 'expense'; id: string; revision: number }[]> {
  const db = getPrisma();
  const [categories, expenses] = await Promise.all([
    db.category.findMany({
      where: { userId, revision: { gt: since } },
      select: { id: true, revision: true },
    }),
    db.expense.findMany({
      where: { userId, revision: { gt: since } },
      select: { id: true, revision: true },
    }),
  ]);

  return [
    ...categories.map((c) => ({ entity: 'category' as const, id: c.id, revision: c.revision })),
    ...expenses.map((e) => ({ entity: 'expense' as const, id: e.id, revision: e.revision })),
  ].sort((a, b) => a.revision - b.revision);
}

/**
 * `F-MONTH` from §3 of the test plan: 42 expenses in one month across all six seeded
 * categories, plus 5 in the month before.
 *
 * The month is fixed rather than read from the clock. Every API-layer assertion here is
 * about `date` as a calendar value, so a run on the 1st of a month would otherwise
 * straddle `MONTH`/`PREVIOUS` and change the counts under the cases that assert them.
 * The device cases are the ones that need a real "current month", and they do not use
 * this helper.
 *
 * Asserts its own postconditions, per §3: a fixture that silently builds the wrong state
 * turns every case using it into a false green.
 */
export const F_MONTH = {
  /** The month the 42 live expenses are dated in. */
  month: '2026-10',
  previousMonth: '2026-09',
  liveCount: 42,
  previousCount: 5,
} as const;

export interface MonthFixture {
  readonly user: TestUser;
  /** The 42 expenses dated in `F_MONTH.month`, in creation order. */
  readonly expenses: readonly Expense[];
  /** The 5 expenses dated in `F_MONTH.previousMonth`. */
  readonly previous: readonly Expense[];
  /** Expenses of one category name, among `expenses`. */
  byCategory(name: string): readonly Expense[];
}

export async function createMonth(
  overrides: { currency?: string } = {},
): Promise<MonthFixture> {
  const user = await createUser(overrides);
  const names = Object.keys(user.categories).sort();
  if (names.length !== 6) throw new Error(`F-MONTH expected 6 seeded categories, got ${names.length}`);

  const expenses: Expense[] = [];
  for (let i = 0; i < F_MONTH.liveCount; i += 1) {
    const name = names[i % names.length] as string;
    expenses.push(
      await createExpense(user, {
        categoryId: user.categories[name]!.id,
        amountMinor: 100 + i,
        // Spread over the first 28 days so no run lands on a day the month lacks.
        date: `${F_MONTH.month}-${String((i % 28) + 1).padStart(2, '0')}`,
        note: `m-${i}`,
      }),
    );
  }

  const previous: Expense[] = [];
  for (let i = 0; i < F_MONTH.previousCount; i += 1) {
    previous.push(
      await createExpense(user, {
        categoryId: user.defaultCategory.id,
        amountMinor: 500 + i,
        date: `${F_MONTH.previousMonth}-${String(i + 1).padStart(2, '0')}`,
        note: `p-${i}`,
      }),
    );
  }

  if (expenses.length !== F_MONTH.liveCount || previous.length !== F_MONTH.previousCount) {
    throw new Error('F-MONTH built the wrong number of expenses');
  }
  const distinct = new Set(expenses.map((e) => e.categoryId));
  if (distinct.size !== 6) throw new Error(`F-MONTH spread over ${distinct.size} categories, not 6`);

  return {
    user,
    expenses,
    previous,
    byCategory: (name: string) => {
      const category = user.categories[name];
      if (!category) throw new Error(`F-MONTH has no category named ${name}`);
      return expenses.filter((e) => e.categoryId === category.id);
    },
  };
}
