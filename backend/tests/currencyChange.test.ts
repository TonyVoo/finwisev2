import { LIMITS } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { getPrisma } from '../src/db/client.ts';
import { TEST_PASSWORD, api } from './support/api.ts';
import { createExpense, createUser, type TestUser } from './support/fixtures.ts';
import { makeHousehold } from './support/spaces.ts';
import { pull, pushItem, pushOk } from './support/sync.ts';
import { v7 as uuidv7 } from 'uuid';

/**
 * `POST /v1/me/currency`: switch the account currency and convert every amount of the
 * account's own books at a rate the person gives. One transaction; all or nothing.
 */

function change(user: Pick<TestUser, 'auth'>, body: unknown) {
  return api()
    .post('/v1/me/currency')
    .set('Authorization', user.auth)
    .send(body as object);
}

const toVnd = { currency: 'VND', rate: '25400', password: TEST_PASSWORD };

async function expenseRow(id: string) {
  return getPrisma().expense.findUniqueOrThrow({ where: { id } });
}

describe('POST /v1/me/currency - who may call it', () => {
  it('needs a signed-in user', async () => {
    const response = await api().post('/v1/me/currency').send(toVnd);
    expect(response.status).toBe(401);
  });

  it('is 403 forbidden on a wrong password, and changes nothing', async () => {
    const user = await createUser({ currency: 'USD' });
    const expense = await createExpense(user, { categoryId: user.defaultCategory.id });

    const response = await change(user, { ...toVnd, password: 'not-the-password' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('forbidden');
    expect((await expenseRow(expense.id)).currency).toBe('USD');
    const me = await api().get('/v1/me').set('Authorization', user.auth);
    expect(me.body.user.currency).toBe('USD');
  });
});

describe('POST /v1/me/currency - what it refuses', () => {
  it.each([
    ['the same currency', { currency: 'USD', rate: '1', password: TEST_PASSWORD }],
    ['a zero rate', { currency: 'VND', rate: '0', password: TEST_PASSWORD }],
    ['an exponent rate', { currency: 'VND', rate: '1e3', password: TEST_PASSWORD }],
    ['a numeric rate', { currency: 'VND', rate: 25400, password: TEST_PASSWORD }],
    ['a lowercase code', { currency: 'vnd', rate: '25400', password: TEST_PASSWORD }],
    ['a missing rate', { currency: 'VND', password: TEST_PASSWORD }],
    ['an extra field', { ...toVnd, extra: true }],
  ])('is 400 validation_error for %s', async (_name, body) => {
    const user = await createUser({ currency: 'USD' });
    const response = await change(user, body);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
  });

  it('refuses when any converted amount would be too large, and changes nothing', async () => {
    const user = await createUser({ currency: 'USD' });
    const small = await createExpense(user, {
      categoryId: user.defaultCategory.id,
      amountMinor: 1000,
    });
    await createExpense(user, {
      categoryId: user.defaultCategory.id,
      amountMinor: Math.floor(LIMITS.AMOUNT_MINOR_MAX / 1000),
    });

    const response = await change(user, { currency: 'EUR', rate: '5000', password: TEST_PASSWORD });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
    expect(await expenseRow(small.id)).toMatchObject({ amountMinor: 1000n, currency: 'USD' });
    const me = await api().get('/v1/me').set('Authorization', user.auth);
    expect(me.body.user.currency).toBe('USD');
  });
});

describe('POST /v1/me/currency - converting expenses', () => {
  it('converts at the rate, records the old amount as the original, and reports the new currency', async () => {
    const user = await createUser({ currency: 'USD' });
    const expense = await createExpense(user, {
      categoryId: user.defaultCategory.id,
      amountMinor: 1250,
    });

    const response = await change(user, toVnd);

    expect(response.status).toBe(200);
    expect(response.body.user.currency).toBe('VND');
    // 12.50 USD at 25 400 is 317 500 dong (a currency with no decimals).
    expect(await expenseRow(expense.id)).toMatchObject({
      amountMinor: 317500n,
      currency: 'VND',
      originalAmountMinor: 1250n,
      originalCurrency: 'USD',
    });
  });

  it('allows for the decimals of both currencies in the other direction', async () => {
    const user = await createUser({ currency: 'VND' });
    const expense = await createExpense(user, {
      categoryId: user.defaultCategory.id,
      amountMinor: 317500,
    });

    const response = await change(user, {
      currency: 'USD',
      rate: '0.00003937',
      password: TEST_PASSWORD,
    });

    expect(response.status).toBe(200);
    // 317 500 dong x 0.00003937 = 12.4997 USD = 1250 cents.
    expect(await expenseRow(expense.id)).toMatchObject({
      amountMinor: 1250n,
      currency: 'USD',
      originalAmountMinor: 317500n,
      originalCurrency: 'VND',
    });
  });

  it('rounds half up to a whole minor unit', async () => {
    const user = await createUser({ currency: 'USD' });
    const expense = await createExpense(user, {
      categoryId: user.defaultCategory.id,
      amountMinor: 1,
    });

    await change(user, { currency: 'EUR', rate: '0.5', password: TEST_PASSWORD });

    expect((await expenseRow(expense.id)).amountMinor).toBe(1n);
  });

  it('gives the original amount back exactly when the new currency is the one it was paid in', async () => {
    const user = await createUser({ currency: 'USD' });
    const response = await api().post('/v1/expenses').set('Authorization', user.auth).send({
      categoryId: user.defaultCategory.id,
      amountMinor: 1082,
      date: '2026-10-06',
      originalAmountMinor: 1000,
      originalCurrency: 'EUR',
    });
    expect(response.status).toBe(201);

    // A deliberately odd rate: the original must win over the arithmetic.
    await change(user, { currency: 'EUR', rate: '0.9', password: TEST_PASSWORD });

    expect(await expenseRow(response.body.data.id)).toMatchObject({
      amountMinor: 1000n,
      currency: 'EUR',
      originalAmountMinor: null,
      originalCurrency: null,
    });
  });

  it('keeps an original paid in a third currency, converting only the amount', async () => {
    const user = await createUser({ currency: 'USD' });
    const response = await api().post('/v1/expenses').set('Authorization', user.auth).send({
      categoryId: user.defaultCategory.id,
      amountMinor: 1082,
      date: '2026-10-06',
      originalAmountMinor: 1000,
      originalCurrency: 'EUR',
    });

    await change(user, toVnd);

    expect(await expenseRow(response.body.data.id)).toMatchObject({
      amountMinor: 274828n,
      currency: 'VND',
      originalAmountMinor: 1000n,
      originalCurrency: 'EUR',
    });
  });

  it('converts a deleted expense too, so a restored one is not left behind', async () => {
    const user = await createUser({ currency: 'USD' });
    const expense = await createExpense(user, {
      categoryId: user.defaultCategory.id,
      amountMinor: 1000,
    });
    await api().delete(`/v1/expenses/${expense.id}`).set('Authorization', user.auth);

    await change(user, toVnd);

    const row = await expenseRow(expense.id);
    expect(row.deletedAt).not.toBeNull();
    expect(row).toMatchObject({ amountMinor: 254000n, currency: 'VND' });
  });

  it('takes new expenses in the new currency only', async () => {
    const user = await createUser({ currency: 'USD' });
    await change(user, toVnd);

    const old = await api().post('/v1/expenses').set('Authorization', user.auth).send({
      categoryId: user.defaultCategory.id,
      amountMinor: 1000,
      currency: 'USD',
      date: '2026-10-06',
    });
    const fresh = await api().post('/v1/expenses').set('Authorization', user.auth).send({
      categoryId: user.defaultCategory.id,
      amountMinor: 50000,
      currency: 'VND',
      date: '2026-10-06',
    });

    expect(old.status).toBe(400);
    expect(fresh.status).toBe(201);
  });
});

describe('POST /v1/me/currency - the rest of the books', () => {
  it('converts goals, recurring rules and category budgets', async () => {
    const user = await createUser({ currency: 'USD' });
    const goalId = uuidv7();
    const ruleId = uuidv7();
    await pushOk(user, [
      pushItem({
        entity: 'goal',
        id: goalId,
        fields: { name: 'Holiday', targetMinor: 100000, savedMinor: 25050 },
      } as never),
      pushItem({
        entity: 'recurring',
        id: ruleId,
        fields: {
          categoryId: user.categories['Bills']!.id,
          amountMinor: 1299,
          frequency: 'monthly',
          startDate: '2026-10-31',
        },
      } as never),
    ]);
    const bills = user.categories['Bills']!;
    await api()
      .patch(`/v1/categories/${bills.id}`)
      .set('Authorization', user.auth)
      .send({ monthlyBudgetMinor: 20000 });

    const response = await change(user, toVnd);
    expect(response.status).toBe(200);

    const db = getPrisma();
    expect(await db.goal.findUniqueOrThrow({ where: { id: goalId } })).toMatchObject({
      targetMinor: 25400000n,
      savedMinor: 6362700n,
      currency: 'VND',
    });
    expect(await db.recurringRule.findUniqueOrThrow({ where: { id: ruleId } })).toMatchObject({
      amountMinor: 329946n,
      currency: 'VND',
    });
    const budgeted = await db.category.findUniqueOrThrow({ where: { id: bills.id } });
    expect(budgeted.monthlyBudgetMinor).toBe(5080000n);
  });

  it('leaves a household book alone, since it has a currency of its own', async () => {
    const user = await createUser({ currency: 'USD' });
    const house = await makeHousehold({ owner: user, currency: 'USD' });
    const shared = await getPrisma().expense.count({ where: { userId: house.scopeId } });

    const response = await change(user, toVnd);

    expect(response.status).toBe(200);
    expect(await getPrisma().expense.count({ where: { userId: house.scopeId } })).toBe(shared);
    const book = await getPrisma().user.findUniqueOrThrow({ where: { id: house.scopeId } });
    expect(book.currency).toBe('USD');
  });
});

describe('POST /v1/me/currency - reaching other devices', () => {
  it('gives every changed row a new revision, so the next sync delivers it', async () => {
    const user = await createUser({ currency: 'USD' });
    const expense = await createExpense(user, {
      categoryId: user.defaultCategory.id,
      amountMinor: 1250,
    });
    const before = await pull(user, { since: 0 });
    const cursor = before.nextCursor;

    await change(user, toVnd);

    const after = await pull(user, { since: cursor });
    const delivered = after.changes.find((c) => c.record.id === expense.id);
    expect(delivered?.record).toMatchObject({ amountMinor: 317500, currency: 'VND' });
    expect(after.changes.every((c) => c.record.id !== undefined)).toBe(true);
  });

  it('keeps revisions unique and ascending', async () => {
    const user = await createUser({ currency: 'USD' });
    for (let i = 0; i < 3; i++) {
      await createExpense(user, { categoryId: user.defaultCategory.id, amountMinor: 100 + i });
    }

    await change(user, toVnd);

    const rows = await getPrisma().expense.findMany({
      where: { userId: user.user.id },
      select: { revision: true },
    });
    const revisions = rows.map((row) => row.revision);
    expect(new Set(revisions).size).toBe(revisions.length);
  });
});
