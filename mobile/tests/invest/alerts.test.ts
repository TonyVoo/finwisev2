import { migrate } from '@/db/migrations';
import {
  MAX_ALERTS,
  addAlert,
  isTripped,
  markFired,
  readAlerts,
  rearm,
  removeAlert,
  trippedBy,
  waitingSymbols,
} from '@/invest/alerts';
import {
  CHECK_INTERVAL_MS,
  checkPriceAlerts,
  resetAlertThrottleForTests,
} from '@/invest/checkAlerts';
import { META_KEYS, WIPED_META_KEYS, writeMeta } from '@/db/meta';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

let database: TestDatabase;
beforeEach(async () => {
  database = await createTestDatabase();
  await migrate(database);
  resetAlertThrottleForTests();
});

describe('alert list', () => {
  it('adds an alert, newest first, and replaces the same symbol and side', async () => {
    await addAlert(database, 'vnm', 'above', 60000);
    await addAlert(database, 'fpt', 'below', 100000);
    const list = await addAlert(database, 'VNM', 'above', 62000);

    expect(list.map((a) => [a.symbol, a.direction, a.price])).toEqual([
      ['VNM', 'above', 62000],
      ['FPT', 'below', 100000],
    ]);
    expect(await readAlerts(database)).toEqual(list);
  });

  it('keeps one above and one below for a symbol', async () => {
    await addAlert(database, 'VNM', 'above', 60000);
    const list = await addAlert(database, 'VNM', 'below', 52000);
    expect(list).toHaveLength(2);
  });

  it('ignores what is not a ticker or not a whole price above zero', async () => {
    await addAlert(database, 'a-b', 'above', 60000);
    await addAlert(database, 'VNM', 'above', 0);
    await addAlert(database, 'VNM', 'above', 5.5);
    await addAlert(database, 'VNM', 'above', 2_000_000_000);
    expect(await readAlerts(database)).toEqual([]);
  });

  it('keeps the newest twenty and removes by id', async () => {
    for (let i = 0; i < MAX_ALERTS + 2; i += 1)
      await addAlert(database, `S${i}`, 'above', 1000 + i);
    const list = await readAlerts(database);
    expect(list).toHaveLength(MAX_ALERTS);
    expect((await removeAlert(database, list[0]!.id)).length).toBe(MAX_ALERTS - 1);
  });

  it('reads damaged storage as empty and drops entries that are not alerts', async () => {
    await writeMeta(database, META_KEYS.priceAlerts, '{nope');
    expect(await readAlerts(database)).toEqual([]);
    await writeMeta(database, META_KEYS.priceAlerts, JSON.stringify([{ id: 1 }, 'x', null]));
    expect(await readAlerts(database)).toEqual([]);
  });

  it('is a device preference, not account data', () => {
    expect(WIPED_META_KEYS).not.toContain(META_KEYS.priceAlerts);
    expect(WIPED_META_KEYS).not.toContain(META_KEYS.dcaPlans);
  });
});

describe('what trips an alert', () => {
  const above = {
    id: 'a',
    symbol: 'VNM',
    direction: 'above' as const,
    price: 60000,
    firedAt: null,
    firedPrice: null,
  };
  const below = { ...above, id: 'b', direction: 'below' as const, price: 52000 };

  it("is at or past the price, in the alert's direction", () => {
    expect(isTripped(above, 60000)).toBe(true);
    expect(isTripped(above, 59999)).toBe(false);
    expect(isTripped(below, 52000)).toBe(true);
    expect(isTripped(below, 52001)).toBe(false);
  });

  it('is never tripped by a missing price, and never twice', () => {
    expect(trippedBy([above, below], { VNM: null })).toEqual([]);
    expect(trippedBy([above, below], {})).toEqual([]);
    expect(trippedBy([above, below], { VNM: 61000 }).map((a) => a.id)).toEqual(['a']);
    expect(trippedBy([{ ...above, firedAt: 'x' }], { VNM: 61000 })).toEqual([]);
  });

  it('asks only for symbols with an alert still waiting', () => {
    expect(waitingSymbols([above, { ...below, symbol: 'FPT', firedAt: 'x' }])).toEqual(['VNM']);
  });
});

describe('checking', () => {
  const NOW = new Date('2026-11-07T04:00:00.000Z');
  const quotes = (closes: Record<string, number | 'down'>) => ({
    getMarketQuote: jest.fn(async (symbol: string) => {
      const close = closes[symbol];
      if (close === undefined || close === 'down') throw new Error('down');
      return { data: { close } } as never;
    }),
  });

  it('marks a tripped alert fired with the price that tripped it, and tells the person once', async () => {
    await addAlert(database, 'VNM', 'above', 60000);
    const notify = jest.fn(async () => undefined);

    const result = await checkPriceAlerts(quotes({ VNM: 61000 }), database, NOW, notify);

    expect(result.fired.map((a) => a.symbol)).toEqual(['VNM']);
    expect(notify).toHaveBeenCalledTimes(1);
    const [alert] = await readAlerts(database);
    expect(alert).toMatchObject({ firedAt: NOW.toISOString(), firedPrice: 61000 });

    const later = new Date(NOW.getTime() + CHECK_INTERVAL_MS + 1);
    await checkPriceAlerts(quotes({ VNM: 70000 }), database, later, notify);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('leaves an alert waiting when its price cannot be had', async () => {
    await addAlert(database, 'VNM', 'below', 52000);
    const notify = jest.fn(async () => undefined);

    const result = await checkPriceAlerts(quotes({ VNM: 'down' }), database, NOW, notify);

    expect(result.fired).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
    expect((await readAlerts(database))[0]?.firedAt).toBeNull();
  });

  it('asks nothing when there is nothing waiting, and not again within the interval', async () => {
    const api = quotes({ VNM: 61000 });
    await checkPriceAlerts(api, database, NOW, jest.fn());
    expect(api.getMarketQuote).not.toHaveBeenCalled();

    await addAlert(database, 'VNM', 'above', 70000);
    await checkPriceAlerts(api, database, NOW, jest.fn());
    await checkPriceAlerts(api, database, new Date(NOW.getTime() + 1000), jest.fn());
    expect(api.getMarketQuote).toHaveBeenCalledTimes(1);
  });

  it('does not fire again if telling the person fails: it was marked first', async () => {
    await addAlert(database, 'VNM', 'above', 60000);
    const notify = jest.fn(async () => {
      throw new Error('no permission');
    });

    await checkPriceAlerts(quotes({ VNM: 61000 }), database, NOW, notify);
    await checkPriceAlerts(
      quotes({ VNM: 61000 }),
      database,
      new Date(NOW.getTime() + CHECK_INTERVAL_MS + 1),
      notify,
    );

    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('can be set again after it fired', async () => {
    const [added] = await addAlert(database, 'VNM', 'above', 60000);
    await markFired(database, [{ id: added!.id, close: 61000 }], NOW);
    expect((await rearm(database, added!.id))[0]).toMatchObject({
      firedAt: null,
      firedPrice: null,
    });
  });
});
