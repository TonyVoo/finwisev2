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
