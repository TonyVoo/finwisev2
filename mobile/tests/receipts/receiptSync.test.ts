import type { ReceiptIndexItem } from '@expense-tracker/shared';
import { ApiRequestError } from '@/api/errors';
import { migrate } from '@/db/migrations';
import { SessionChangedError } from '@/sync/sessionGuard';
import { type ReceiptApi, syncReceipts } from '@/receipts/receiptSync';
import {
  attachReceipt,
  decodedSize,
  detachReceipt,
  hasReceipt,
  readReceipt,
  storeDownloaded,
} from '@/receipts/receiptStore';
import { categoryId, expenseId, seedCategory, seedExpense } from '../support/seed';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/**
 * The receipt half of a sync pass, against a real SQLite engine and a scripted API.
 *
 * The cases are the ones where the state machine could lose a photo or resurrect a removed
 * one: an upload for an expense the server has not seen, a replace or remove racing a
 * request, another device's change arriving, and an expense that no longer exists.
 */

const T0 = '2026-10-20T10:00:00.000Z';
const T1 = '2026-10-20T11:00:00.000Z';
const E1 = expenseId(1);
const E2 = expenseId(2);
const IMG = '/9j/AAAA';

const problem = (status: number) =>
  new ApiRequestError({
    status,
    code: status === 404 ? 'not_found' : 'validation_error',
    message: 'x',
  });

interface Script {
  put?: (id: string, body: { dataBase64: string }) => Promise<void>;
  del?: (id: string) => Promise<void>;
  index?: ReceiptIndexItem[];
}

function fakeApi(script: Script = {}) {
  const calls: string[] = [];
  const api: ReceiptApi = {
    putReceipt: async (id, body) => {
      calls.push(`put ${id}`);
      await script.put?.(id, body);
      return {
        data: {
          expenseId: id,
          contentType: 'image/jpeg',
          dataBase64: body.dataBase64,
          sizeBytes: decodedSize(body.dataBase64),
          updatedAt: T1,
        },
      };
    },
    deleteReceipt: async (id) => {
      calls.push(`delete ${id}`);
      await script.del?.(id);
    },
    listReceipts: async () => {
      calls.push('list');
      return { data: script.index ?? [] };
    },
  };
  return { api, calls };
}

const guard = { assertCurrent: () => undefined };

describe('syncReceipts', () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createTestDatabase();
    await migrate(database);
    await seedCategory(database, { id: categoryId(1), name: 'Food' });
    await seedExpense(database, {
      id: E1,
      categoryId: categoryId(1),
      amountMinor: 100,
      date: '2026-10-01',
    });
  });
  afterEach(() => database.close());

  const run = (api: ReceiptApi, g = guard) => syncReceipts({ database, api, guard: g });

  it('uploads an attached photo and marks it synced with the server version', async () => {
    await attachReceipt(database, E1, IMG, T0);
    const { api, calls } = fakeApi({ index: [{ expenseId: E1, sizeBytes: 6, updatedAt: T1 }] });

    await expect(run(api)).resolves.toBe(true);

    expect(calls).toEqual([`put ${E1}`, 'list']);
    await expect(readReceipt(database, E1)).resolves.toMatchObject({
      state: 'synced',
      dataBase64: IMG,
      updatedAt: T1,
    });
  });

  it('keeps an upload queued while the expense has not reached the server', async () => {
    await attachReceipt(database, E1, IMG, T0);
    const { api } = fakeApi({
      put: async () => {
        throw problem(404);
      },
    });

    await run(api);

    await expect(readReceipt(database, E1)).resolves.toMatchObject({ state: 'pending-upload' });
  });

  it('drops an upload whose expense is gone locally, rather than retrying forever', async () => {
    await attachReceipt(database, E2, IMG, T0); // no such expense
    const { api } = fakeApi({
      put: async () => {
        throw problem(404);
      },
    });

    await expect(run(api)).resolves.toBe(true);
    await expect(readReceipt(database, E2)).resolves.toBeNull();
  });

  it('drops an image the server will never accept', async () => {
    await attachReceipt(database, E1, IMG, T0);
    const { api } = fakeApi({
      put: async () => {
        throw problem(400);
      },
    });
    await run(api);
    await expect(readReceipt(database, E1)).resolves.toBeNull();
  });

  it('rethrows other failures and leaves the row queued', async () => {
    await attachReceipt(database, E1, IMG, T0);
    const { api } = fakeApi({
      put: async () => {
        throw new Error('network down');
      },
    });
    await expect(run(api)).rejects.toThrow('network down');
    await expect(readReceipt(database, E1)).resolves.toMatchObject({ state: 'pending-upload' });
  });

  it('does not let the answer to an old upload overwrite a replacement made meanwhile', async () => {
    await attachReceipt(database, E1, IMG, T0);
    const { api } = fakeApi({
      put: async () => {
        await attachReceipt(database, E1, '/9j/BBBB', '2026-10-20T10:30:00.000Z');
      },
      index: [],
    });

    await run(api);

    // Still the newer image, still waiting: the stale answer touched nothing.
    await expect(readReceipt(database, E1)).resolves.toMatchObject({
      state: 'pending-upload',
      dataBase64: '/9j/BBBB',
    });
  });

  it('sends a queued remove, and treats a 404 as done', async () => {
    await attachReceipt(database, E1, IMG, T0);
    await detachReceipt(database, E1, T1);
    expect(hasReceipt(await readReceipt(database, E1))).toBe(false);

    const { api, calls } = fakeApi({
      del: async () => {
        throw problem(404);
      },
    });
    await run(api);

    expect(calls[0]).toBe(`delete ${E1}`);
    await expect(readReceipt(database, E1)).resolves.toBeNull();
  });

  it("learns about another device's receipt without downloading it", async () => {
    const { api, calls } = fakeApi({ index: [{ expenseId: E1, sizeBytes: 5000, updatedAt: T1 }] });

    await expect(run(api)).resolves.toBe(true);

    expect(calls).toEqual(['list']);
    await expect(readReceipt(database, E1)).resolves.toMatchObject({
      state: 'remote',
      dataBase64: null,
      sizeBytes: 5000,
    });
  });

  it('forgets a cached image another device replaced, and one it removed', async () => {
    await storeDownloaded(database, E1, IMG, 6, T0);
    await storeDownloaded(database, E2, IMG, 6, T0);

    const { api } = fakeApi({ index: [{ expenseId: E1, sizeBytes: 9, updatedAt: T1 }] });
    await run(api);

    await expect(readReceipt(database, E1)).resolves.toMatchObject({
      state: 'remote',
      dataBase64: null,
      updatedAt: T1,
    });
    await expect(readReceipt(database, E2)).resolves.toBeNull();
  });

  it('never lets the index disturb a row with something still to send', async () => {
    await attachReceipt(database, E1, IMG, T0);
    const { api } = fakeApi({
      put: async () => {
        throw problem(404);
      },
      index: [], // the server knows nothing of it yet
    });
    await run(api);
    await expect(readReceipt(database, E1)).resolves.toMatchObject({ state: 'pending-upload' });
  });

  it('abandons the pass when the session changes, writing nothing', async () => {
    await attachReceipt(database, E1, IMG, T0);
    const { api, calls } = fakeApi();
    const changed = {
      assertCurrent: () => {
        throw new SessionChangedError();
      },
    };

    await expect(run(api, changed)).rejects.toBeInstanceOf(SessionChangedError);
    expect(calls).toEqual([]);
    await expect(readReceipt(database, E1)).resolves.toMatchObject({ state: 'pending-upload' });
  });
});

describe('decodedSize', () => {
  it('matches the real decoded length, padding included', () => {
    for (const bytes of [1, 2, 3, 10, 255, 1000]) {
      const text = Buffer.alloc(bytes, 1).toString('base64');
      expect(decodedSize(text)).toBe(bytes);
    }
  });
});
