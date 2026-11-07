import type { MarketQuotePoint } from '@expense-tracker/shared';
import type { TradeListItem } from '@/db/queries';
import { migrate } from '@/db/migrations';
import {
  buildNetWorthSeries,
  closeAsOf,
  readSnapshots,
  recordSnapshot,
  savingsAsOf,
  sharesAsOf,
  stocksValueAt,
} from '@/invest/netWorth';
import { createTestDatabase } from '../support/sqlite';

let n = 0;
const trade = (
  side: 'buy' | 'sell' | 'dividend',
  symbol: string,
  quantity: number,
  date: string,
): TradeListItem => ({
  id: `t${(n += 1)}`,
  symbol,
  side,
  quantity,
  price: 1,
  fee: 0,
  date,
  note: null,
  pending: false,
});
const pt = (date: string, close: number): MarketQuotePoint => ({ date, close, volume: 0 });

describe('holdings at a date', () => {
  const trades = [
    trade('buy', 'VNM', 100, '2026-10-01'),
    trade('sell', 'VNM', 40, '2026-10-10'),
    trade('dividend', 'VNM', 100, '2026-10-12'),
    trade('buy', 'FPT', 10, '2026-10-20'),
    trade('sell', 'FPT', 10, '2026-10-25'),
  ];
  it('counts buys and sells up to the day, ignores dividends, and drops a symbol sold out', () => {
    expect(sharesAsOf(trades, '2026-09-30').size).toBe(0);
    expect(sharesAsOf(trades, '2026-10-05').get('VNM')).toBe(100);
    expect(sharesAsOf(trades, '2026-10-12').get('VNM')).toBe(60);
    expect(sharesAsOf(trades, '2026-10-22').get('FPT')).toBe(10);
    expect(sharesAsOf(trades, '2026-10-30').has('FPT')).toBe(false);
  });
});

describe('as-of lookups', () => {
  const series = [pt('2026-10-01', 50), pt('2026-10-02', 52), pt('2026-10-05', 51)];
  it('takes the last close on or before the day', () => {
    expect(closeAsOf(series, '2026-09-30')).toBeNull();
    expect(closeAsOf(series, '2026-10-02')).toBe(52);
    expect(closeAsOf(series, '2026-10-03')).toBe(52);
    expect(closeAsOf(series, '2026-12-01')).toBe(51);
    expect(closeAsOf([], '2026-10-01')).toBeNull();
  });
  it('takes the savings as last recorded on or before the day', () => {
    const snaps = [
      { date: '2026-10-02', savingsMinor: 100 },
      { date: '2026-10-09', savingsMinor: 300 },
    ];
    expect(savingsAsOf(snaps, '2026-10-01')).toBeNull();
    expect(savingsAsOf(snaps, '2026-10-05')).toBe(100);
    expect(savingsAsOf(snaps, '2026-10-09')).toBe(300);
  });
  it('values the stocks, or says it cannot while one has no price yet', () => {
    const trades = [trade('buy', 'VNM', 100, '2026-10-01')];
    expect(stocksValueAt(trades, { VNM: series }, '2026-10-02')).toBe(5200);
    expect(stocksValueAt(trades, { VNM: [pt('2026-10-03', 50)] }, '2026-10-02')).toBeNull();
  });
});

describe('buildNetWorthSeries', () => {
  const series = {
    VNM: [pt('2026-10-01', 50), pt('2026-10-02', 52), pt('2026-10-05', 51), pt('2026-10-06', 53)],
  };
  const trades = [trade('buy', 'VNM', 100, '2026-10-02')];

  it('is the stocks alone when no savings are held', () => {
    const { points, savingsFrom } = buildNetWorthSeries({ trades, series, snapshots: [] });
    expect(savingsFrom).toBeNull();
    expect(points.map((p) => [p.date, p.close])).toEqual([
      ['2026-10-02', 5200],
      ['2026-10-05', 5100],
      ['2026-10-06', 5300],
    ]);
  });

  it('adds the savings, and starts only where they are known, never with a made-up stretch', () => {
    const { points, savingsFrom } = buildNetWorthSeries({
      trades,
      series,
      snapshots: [
        { date: '2026-10-05', savingsMinor: 1000 },
        { date: '2026-10-06', savingsMinor: 1500 },
      ],
    });
    expect(savingsFrom).toBe('2026-10-05');
    expect(points.map((p) => [p.date, p.close])).toEqual([
      ['2026-10-05', 6100],
      ['2026-10-06', 6800],
    ]);
  });

  it('is savings alone, by snapshot day, with no trades', () => {
    const { points } = buildNetWorthSeries({
      trades: [],
      series: {},
      snapshots: [
        { date: '2026-10-05', savingsMinor: 1000 },
        { date: '2026-10-06', savingsMinor: 1500 },
      ],
    });
    expect(points.map((p) => p.close)).toEqual([1000, 1500]);
  });

  it('is empty with nothing at all', () => {
    expect(buildNetWorthSeries({ trades: [], series: {}, snapshots: [] }).points).toEqual([]);
  });
});

describe('snapshots', () => {
  it('keeps one a day, the last reading winning, oldest first', async () => {
    const database = await createTestDatabase();
    await migrate(database);
    await recordSnapshot(database, '2026-10-05', 100);
    await recordSnapshot(database, '2026-10-05', 120);
    await recordSnapshot(database, '2026-10-04', 90);
    expect(await readSnapshots(database)).toEqual([
      { date: '2026-10-04', savingsMinor: 90 },
      { date: '2026-10-05', savingsMinor: 120 },
    ]);
  });
  it('reads a damaged value as empty', async () => {
    const database = await createTestDatabase();
    await migrate(database);
    await database.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
      'netWorthSnapshots',
      '{"x":1}',
    ]);
    expect(await readSnapshots(database)).toEqual([]);
  });
});
