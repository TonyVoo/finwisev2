import { LIMITS } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { getPrisma } from '../src/db/client.ts';
import { api } from './support/api.ts';
import { createExpense as create, createUser, type TestUser } from './support/fixtures.ts';

const createExpense = (user: TestUser) =>
  create(user, { categoryId: user.categories.Groceries!.id });

/**
 * Receipt photos: `PUT|GET|DELETE /v1/expenses/{id}/receipt` and `GET /v1/receipts`.
 *
 * The bytes are opaque to the server except for one check - the JPEG signature - so the
 * cases that matter are the boundaries: whose expense, how big, what kind of file, and what
 * happens to the photo when its expense is deleted.
 */

/** A minimal JPEG-looking payload: the 3-byte marker plus filler. */
function jpeg(size = 64): Buffer {
  const bytes = Buffer.alloc(size, 7);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  return bytes;
}
const b64 = (bytes: Buffer): string => bytes.toString('base64');

const put = (auth: string, id: string, dataBase64: string) =>
  api()
    .put(`/v1/expenses/${id}/receipt`)
    .set('Authorization', auth)
    .send({ contentType: 'image/jpeg', dataBase64 });
const get = (auth: string, id: string) =>
  api().get(`/v1/expenses/${id}/receipt`).set('Authorization', auth);
const del = (auth: string, id: string) =>
  api().delete(`/v1/expenses/${id}/receipt`).set('Authorization', auth);
const index = (auth: string) => api().get('/v1/receipts').set('Authorization', auth);

describe('receipts', () => {
  it('stores a photo and gives the same bytes back', async () => {
    const user = await createUser();
    const expense = await createExpense(user);
    const bytes = jpeg(500);

    const stored = await put(user.auth, expense.id, b64(bytes));
    expect(stored.status).toBe(200);
    expect(stored.body.data).toMatchObject({ expenseId: expense.id, sizeBytes: 500 });

    const fetched = await get(user.auth, expense.id);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(fetched.body.data.dataBase64, 'base64').equals(bytes)).toBe(true);
  });

  it('replaces an earlier photo', async () => {
    const user = await createUser();
    const expense = await createExpense(user);
    await put(user.auth, expense.id, b64(jpeg(100)));
    await put(user.auth, expense.id, b64(jpeg(200)));

    expect((await get(user.auth, expense.id)).body.data.sizeBytes).toBe(200);
    expect((await index(user.auth)).body.data).toHaveLength(1);
  });

  it('lists receipts without their bytes', async () => {
    const user = await createUser();
    const a = await createExpense(user);
    const b = await createExpense(user);
    await put(user.auth, a.id, b64(jpeg(10)));
    await put(user.auth, b.id, b64(jpeg(20)));

    const listed = await index(user.auth);
    expect(listed.status).toBe(200);
    expect(listed.body.data.map((r: { expenseId: string }) => r.expenseId).sort()).toEqual(
      [a.id, b.id].sort(),
    );
    expect(listed.body.data[0]).not.toHaveProperty('dataBase64');
  });

  it('404s when there is no receipt, and delete is idempotent', async () => {
    const user = await createUser();
    const expense = await createExpense(user);
    expect((await get(user.auth, expense.id)).status).toBe(404);

    await put(user.auth, expense.id, b64(jpeg()));
    expect((await del(user.auth, expense.id)).status).toBe(204);
    expect((await del(user.auth, expense.id)).status).toBe(204);
    expect((await get(user.auth, expense.id)).status).toBe(404);
  });

  it('refuses bytes that are not a JPEG, whatever the declared type', async () => {
    const user = await createUser();
    const expense = await createExpense(user);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

    const res = await put(user.auth, expense.id, b64(png));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('refuses an image over the decoded size limit, and a body over the route limit', async () => {
    const user = await createUser();
    const expense = await createExpense(user);

    const tooBig = await put(user.auth, expense.id, b64(jpeg(LIMITS.RECEIPT_MAX_BYTES + 3)));
    expect(tooBig.status).toBe(400);

    const huge = await api()
      .put(`/v1/expenses/${expense.id}/receipt`)
      .set('Authorization', user.auth)
      .send({ contentType: 'image/jpeg', dataBase64: 'A'.repeat(3 * 1024 * 1024 + 10) });
    expect(huge.status).toBe(413);
    expect(huge.body.error.code).toBe('batch_too_large');
  });

  it('accepts a photo at the size limit', async () => {
    const user = await createUser();
    const expense = await createExpense(user);
    const res = await put(user.auth, expense.id, b64(jpeg(LIMITS.RECEIPT_MAX_BYTES)));
    expect(res.status).toBe(200);
  });

  it("treats another user's expense as not found, for every verb", async () => {
    const owner = await createUser();
    const other = await createUser();
    const expense = await createExpense(owner);
    await put(owner.auth, expense.id, b64(jpeg()));

    expect((await put(other.auth, expense.id, b64(jpeg()))).status).toBe(404);
    expect((await get(other.auth, expense.id)).status).toBe(404);
    expect((await del(other.auth, expense.id)).status).toBe(404);
    expect((await index(other.auth)).body.data).toEqual([]);
    // And the owner's photo is untouched.
    expect((await get(owner.auth, expense.id)).status).toBe(200);
  });

  it('404s for an expense that does not exist yet (queued offline)', async () => {
    const user = await createUser();
    const res = await put(user.auth, '0192f3b1-0000-7f1e-9b2d-0000000000aa', b64(jpeg()));
    expect(res.status).toBe(404);
  });

  it('drops the photo when the expense is deleted over REST', async () => {
    const user = await createUser();
    const expense = await createExpense(user);
    await put(user.auth, expense.id, b64(jpeg()));

    await api().delete(`/v1/expenses/${expense.id}`).set('Authorization', user.auth);

    expect(await getPrisma().expenseReceipt.count()).toBe(0);
    expect((await get(user.auth, expense.id)).status).toBe(404);
    expect((await put(user.auth, expense.id, b64(jpeg()))).status).toBe(404);
    expect((await index(user.auth)).body.data).toEqual([]);
  });

  it('drops the photo when a sync push tombstones the expense', async () => {
    const user = await createUser();
    const expense = await createExpense(user);
    await put(user.auth, expense.id, b64(jpeg()));

    const later = new Date(Date.now() + 1000).toISOString();
    const res = await api()
      .post('/v1/sync')
      .set('Authorization', user.auth)
      .send({
        changes: [
          {
            entity: 'expense',
            id: expense.id,
            clientMutationId: '0192f3b1-0000-7f1e-9b2d-0000000000bb',
            updatedAt: later,
            fields: { deletedAt: later },
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(await getPrisma().expenseReceipt.count()).toBe(0);
  });

  it('deleting the account removes its photos', async () => {
    const user = await createUser();
    const expense = await createExpense(user);
    await put(user.auth, expense.id, b64(jpeg()));
    const res = await api()
      .delete('/v1/me')
      .set('Authorization', user.auth)
      .send({ password: user.password });
    expect(res.status).toBe(204);
    expect(await getPrisma().expenseReceipt.count()).toBe(0);
  });
});
