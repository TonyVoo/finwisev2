import { ExpenseResponse } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { api } from './support/api.ts';
import { createUser } from './support/fixtures.ts';

/** Income shares the expenses table: `kind` is `expense` unless said otherwise. */

describe('expense kind', () => {
  it('defaults to expense', async () => {
    const user = await createUser();
    const response = await api().post('/v1/expenses').set('Authorization', user.auth).send({
      categoryId: user.categories.Groceries!.id,
      amountMinor: 100,
      date: '2026-10-06',
    });
    expect(response.status).toBe(201);
    expect(ExpenseResponse.parse(response.body).data.kind).toBe('expense');
  });

  it('stores income, and lets a patch flip the kind', async () => {
    const user = await createUser();
    const created = await api().post('/v1/expenses').set('Authorization', user.auth).send({
      categoryId: user.categories.Groceries!.id,
      kind: 'income',
      amountMinor: 250000,
      date: '2026-10-06',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.kind).toBe('income');

    const patched = await api()
      .patch(`/v1/expenses/${created.body.data.id}`)
      .set('Authorization', user.auth)
      .send({ kind: 'expense' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.kind).toBe('expense');
  });

  it('rejects an unknown kind', async () => {
    const user = await createUser();
    const response = await api().post('/v1/expenses').set('Authorization', user.auth).send({
      categoryId: user.categories.Groceries!.id,
      kind: 'gift',
      amountMinor: 100,
      date: '2026-10-06',
    });
    expect(response.status).toBe(400);
  });

  it('carries kind through the sync push', async () => {
    const user = await createUser();
    const id = '0192f5a0-0000-7000-8000-0000000000aa';
    const push = await api()
      .post('/v1/sync')
      .set('Authorization', user.auth)
      .send({
        changes: [
          {
            entity: 'expense',
            id,
            updatedAt: new Date(Date.now() - 1000).toISOString(),
            clientMutationId: '0192f5a0-0000-7000-8000-0000000000bb',
            fields: {
              categoryId: user.categories.Groceries!.id,
              kind: 'income',
              amountMinor: 5000,
              date: '2026-10-06',
            },
          },
        ],
      });
    expect(push.status).toBe(200);
    expect(push.body.results[0].record.kind).toBe('income');
  });
});
