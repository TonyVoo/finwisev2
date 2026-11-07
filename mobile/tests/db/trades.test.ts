import { META_KEYS, WIPED_META_KEYS } from '@/db/meta';
import { migrate } from '@/db/migrations';
import { createTrade, deleteTrade, restoreTrade, updateTrade } from '@/db/mutations';
import { listTrades } from '@/db/queries';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

let database: TestDatabase;
beforeEach(async () => {
  database = await createTestDatabase();
  await migrate(database);
});

const buy = {
  symbol: 'vnm',
  side: 'buy' as const,
  quantity: 100,
  price: 56800,
  fee: 8520,
  date: '2026-11-04',
};

describe('trades in the local store', () => {
  it('writes the row and queues one mutation, upper-casing the symbol', async () => {
    const queued = await createTrade(database, { ...buy, note: '  first lot  ' });

    const [trade] = await listTrades(database);
    expect(trade).toMatchObject({ symbol: 'VNM', side: 'buy', quantity: 100, price: 56800 });
    expect(trade?.note).toBe('first lot');
    expect(trade?.pending).toBe(true);
    const outbox = await database.getAllAsync<{ entity: string; recordId: string }>(
      'SELECT entity, recordId FROM outbox',
      [],
    );
    expect(outbox).toEqual([{ entity: 'trade', recordId: queued.recordId }]);
  });

  it('lists oldest first, the order a position is worked out in', async () => {
    await createTrade(database, { ...buy, date: '2026-11-05', quantity: 200 });
    await createTrade(database, { ...buy, date: '2026-11-01', quantity: 100 });

    expect((await listTrades(database)).map((t) => t.quantity)).toEqual([100, 200]);
  });

  it('keeps a same-day buy before a sell however the buy is edited later', async () => {
    const { recordId: buyId } = await createTrade(
      database,
      { ...buy, quantity: 100 },
      { id: '0192f5a0-0000-7000-8000-000000000001' },
    );
    await createTrade(
      database,
      { ...buy, side: 'sell', quantity: 100 },
      { id: '0192f5a0-0000-7000-8000-000000000002' },
    );

    await updateTrade(database, buyId, { price: 51000 });

    expect((await listTrades(database)).map((t) => t.side)).toEqual(['buy', 'sell']);
  });

  it('refuses what can never be valid before writing anything', async () => {
    await expect(createTrade(database, { ...buy, price: 56800.5 })).rejects.toThrow();
    await expect(createTrade(database, { ...buy, quantity: 0 })).rejects.toThrow();
    await expect(createTrade(database, { ...buy, side: 'hold' as never })).rejects.toThrow();
    expect(await listTrades(database)).toEqual([]);
    expect(await database.getAllAsync('SELECT * FROM outbox', [])).toEqual([]);
  });

  it('edits only the named fields', async () => {
    const { recordId: id } = await createTrade(database, buy);

    await updateTrade(database, id, { quantity: 300 });

    const [trade] = await listTrades(database);
    expect(trade).toMatchObject({ quantity: 300, price: 56800, symbol: 'VNM' });
  });

  it('deletes softly and restores', async () => {
    const { recordId: id } = await createTrade(database, buy);

    await deleteTrade(database, id);
    expect(await listTrades(database)).toEqual([]);
    const row = await database.getFirstAsync<{ deletedAt: string | null }>(
      'SELECT deletedAt FROM trades WHERE id = ?',
      [id],
    );
    expect(row?.deletedAt).not.toBeNull();

    await restoreTrade(database, id);
    expect(await listTrades(database)).toHaveLength(1);
  });

  it('leaves the watchlist alone on a wipe: it is a device preference', () => {
    expect(META_KEYS.watchlist).toBeDefined();
    expect(WIPED_META_KEYS).not.toContain(META_KEYS.watchlist);
  });
});

describe('dividends in the local store', () => {
  it('is a kind of trade the table accepts, and one that is not is refused', async () => {
    await createTrade(database, {
      ...buy,
      side: 'dividend',
      quantity: 100,
      price: 2000,
      fee: 20000,
    });

    expect((await listTrades(database)).map((t) => t.side)).toEqual(['dividend']);
    await expect(
      database.runAsync(
        "INSERT INTO trades (id, symbol, side, quantity, price, fee, date, updatedAt) VALUES ('x','VNM','gift',1,1,0,'2026-11-01','2026-11-01T00:00:00.000Z')",
        [],
      ),
    ).rejects.toThrow();
  });
});
