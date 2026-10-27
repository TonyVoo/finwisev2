import { ExpenseResponse } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { api } from './support/api.ts';
import { createUser } from './support/fixtures.ts';
import { pull, pushItem, pushOk } from './support/sync.ts';
import { v7 as uuidv7 } from 'uuid';

/**
 * Foreign-currency expenses: `amountMinor` is the amount in the account's currency, and the
 * original amount and currency are recorded beside it, together or not at all. The server does
 * not convert anything - the device did, at entry - it only keeps the pair consistent.
 */

const FOREIGN = { originalAmountMinor: 1000, originalCurrency: 'EUR' };

async function create(user: Awaited<ReturnType<typeof createUser>>, extra: object = {}) {
  return api()
    .post('/v1/expenses')
    .set('Authorization', user.auth)
    .send({
      categoryId: user.categories.Groceries!.id,
      amountMinor: 1082,
      date: '2026-10-06',
      ...extra,
    });
}

describe('POST /v1/expenses with an original amount', () => {
  it('stores and reports the pair, leaving amountMinor in the account currency', async () => {
    const user = await createUser({ currency: 'USD' });
    const response = await create(user, FOREIGN);

    expect(response.status).toBe(201);
    expect(() => ExpenseResponse.parse(response.body)).not.toThrow();
    expect(response.body.data).toMatchObject({
      amountMinor: 1082,
      currency: 'USD',
      originalAmountMinor: 1000,
      originalCurrency: 'EUR',
    });
  });

  it('reports null for both on an ordinary expense', async () => {
    const user = await createUser();
    const response = await create(user);

    expect(response.body.data.originalAmountMinor).toBeNull();
    expect(response.body.data.originalCurrency).toBeNull();
  });

  it('refuses an original currency that is the account currency', async () => {
    const user = await createUser({ currency: 'USD' });
    const response = await create(user, { originalAmountMinor: 1000, originalCurrency: 'USD' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
  });

  it('refuses half a pair', async () => {
    const user = await createUser();
    expect((await create(user, { originalAmountMinor: 1000 })).status).toBe(400);
    expect((await create(user, { originalCurrency: 'EUR' })).status).toBe(400);
  });
});

describe('PATCH /v1/expenses/:id with an original amount', () => {
  it('sets the pair on an existing expense, and clears it with null', async () => {
    const user = await createUser({ currency: 'USD' });
    const created = await create(user);
    const url = `/v1/expenses/${created.body.data.id}`;

    const set = await api().patch(url).set('Authorization', user.auth).send(FOREIGN);
    expect(set.status).toBe(200);
    expect(set.body.data).toMatchObject(FOREIGN);

    const cleared = await api()
      .patch(url)
      .set('Authorization', user.auth)
      .send({ originalAmountMinor: null, originalCurrency: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.originalAmountMinor).toBeNull();
    expect(cleared.body.data.originalCurrency).toBeNull();
  });

  it('refuses a patch that makes the original currency the account currency', async () => {
    const user = await createUser({ currency: 'USD' });
    const created = await create(user);
    const response = await api()
      .patch(`/v1/expenses/${created.body.data.id}`)
      .set('Authorization', user.auth)
      .send({ originalAmountMinor: 5, originalCurrency: 'USD' });

    expect(response.status).toBe(400);
  });
});

describe('the original amount through sync', () => {
  function expenseItem(
    user: Awaited<ReturnType<typeof createUser>>,
    fields: object,
    id = uuidv7(),
    updatedAt = new Date(Date.now() - 60_000).toISOString(),
  ) {
    return pushItem({
      entity: 'expense',
      id,
      updatedAt,
      fields: {
        categoryId: user.categories.Groceries!.id,
        amountMinor: 1082,
        date: '2026-10-06',
        ...fields,
      },
    } as never);
  }

  it('creates a foreign expense, and delivers it on pull', async () => {
    const user = await createUser({ currency: 'USD' });
    const item = expenseItem(user, FOREIGN);

    const [result] = await pushOk(user, [item]);

    expect(result!.status).toBe('applied');
    expect(result!.record).toMatchObject(FOREIGN);
    const page = await pull(user, { since: 0 });
    const change = page.changes.find((c) => c.entity === 'expense');
    expect(change!.record).toMatchObject(FOREIGN);
  });

  it('reports invalid, and stores nothing, for an original currency equal to the account', async () => {
    const user = await createUser({ currency: 'USD' });
    const item = expenseItem(user, { originalAmountMinor: 5, originalCurrency: 'USD' });

    const [result] = await pushOk(user, [item]);

    expect(result!.status).toBe('invalid');
    expect(result!.error?.code).toBe('validation_error');
  });

  it('merges an unrelated edit without touching the stored pair', async () => {
    const user = await createUser({ currency: 'USD' });
    const id = uuidv7();
    const t0 = new Date(Date.now() - 120_000).toISOString();
    const t1 = new Date(Date.now() - 60_000).toISOString();
    await pushOk(user, [expenseItem(user, FOREIGN, id, t0)]);

    const [result] = await pushOk(user, [
      pushItem({ entity: 'expense', id, updatedAt: t1, fields: { note: 'lunch' } } as never),
    ]);

    expect(result!.record).toMatchObject({ ...FOREIGN, note: 'lunch' });
  });

  it('clears the pair with both nulls', async () => {
    const user = await createUser({ currency: 'USD' });
    const id = uuidv7();
    const t0 = new Date(Date.now() - 120_000).toISOString();
    const t1 = new Date(Date.now() - 60_000).toISOString();
    await pushOk(user, [expenseItem(user, FOREIGN, id, t0)]);

    const [result] = await pushOk(user, [
      pushItem({
        entity: 'expense',
        id,
        updatedAt: t1,
        fields: { originalAmountMinor: null, originalCurrency: null },
      } as never),
    ]);

    expect(result!.record).toMatchObject({ originalAmountMinor: null, originalCurrency: null });
  });
});
