import type { TradeListItem } from '@/db/queries';
import {
  buildPortfolio,
  performanceOf,
  resultsByTag,
  summarise,
  tagsOf,
  valuePosition,
} from '@/invest/portfolioModel';

let n = 0;
function trade(
  side: 'buy' | 'sell' | 'dividend',
  symbol: string,
  quantity: number,
  price: number,
  fee = 0,
  note: string | null = null,
  date = '2026-11-01',
): TradeListItem {
  n += 1;
  return {
    id: `t${n}`,
    symbol,
    side,
    quantity,
    price,
    fee,
    date,
    note,
    pending: false,
  };
}

describe('buildPortfolio', () => {
  it('has nothing for no trades', () => {
    expect(buildPortfolio([])).toEqual({
      open: [],
      closed: [],
      realized: 0,
      dividends: 0,
      sales: [],
    });
  });

  it('adds fees to the cost of a buy and averages across buys', () => {
    const { open } = buildPortfolio([
      trade('buy', 'VNM', 100, 50_000, 7_500),
      trade('buy', 'VNM', 100, 60_000, 9_000),
    ]);

    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ symbol: 'VNM', quantity: 200, cost: 11_016_500, realized: 0 });
    expect(open[0]?.avgCost).toBe(55_083);
  });

  it('books profit on a sale against the average cost, net of its fee', () => {
    const book = buildPortfolio([
      trade('buy', 'VNM', 100, 50_000, 0),
      trade('buy', 'VNM', 100, 60_000, 0),
      trade('sell', 'VNM', 100, 70_000, 10_000),
    ]);

    // Cost 11.000.000 for 200 shares: selling 100 removes 5.500.000. Proceeds 7.000.000 - 10.000.
    expect(book.realized).toBe(7_000_000 - 10_000 - 5_500_000);
    expect(book.open[0]).toMatchObject({ quantity: 100, cost: 5_500_000, avgCost: 55_000 });
  });

  it('moves a fully sold symbol to closed, keeping what it made', () => {
    const book = buildPortfolio([
      trade('buy', 'FPT', 100, 100_000),
      trade('sell', 'FPT', 100, 90_000),
    ]);

    expect(book.open).toEqual([]);
    expect(book.closed[0]).toMatchObject({
      symbol: 'FPT',
      quantity: 0,
      cost: 0,
      realized: -1_000_000,
    });
    expect(book.realized).toBe(-1_000_000);
  });

  it('keeps symbols apart and puts the biggest holding first', () => {
    const { open } = buildPortfolio([
      trade('buy', 'AAA', 100, 10_000),
      trade('buy', 'BBB', 100, 90_000),
    ]);
    expect(open.map((p) => p.symbol)).toEqual(['BBB', 'AAA']);
  });

  it('does not invent a cost for shares sold that were never bought', () => {
    const { open, closed, realized } = buildPortfolio([
      trade('buy', 'HPG', 100, 20_000),
      trade('sell', 'HPG', 150, 25_000, 1_500),
    ]);

    expect(closed[0]).toMatchObject({ symbol: 'HPG', oversold: 50 });
    expect(open).toEqual([]);
    // Only the 100 shares we can price: 100 * 25.000 less 100/150 of the fee, against cost 2.000.000.
    expect(realized).toBe(2_500_000 - 1_000 - 2_000_000);
  });

  it('leaves cost an integer after a sale that does not divide evenly', () => {
    const { open } = buildPortfolio([
      trade('buy', 'XYZ', 3, 10_001),
      trade('sell', 'XYZ', 1, 12_000),
    ]);
    expect(Number.isInteger(open[0]?.cost)).toBe(true);
    expect(open[0]?.cost).toBe(30_003 - 10_001);
  });
});

describe('valuation', () => {
  const position = {
    symbol: 'VNM',
    quantity: 100,
    cost: 5_000_000,
    avgCost: 50_000,
    realized: 0,
    dividends: 0,
    oversold: 0,
  };

  it('values a position at the last close', () => {
    expect(valuePosition(position, 56_800)).toEqual({
      marketValue: 5_680_000,
      unrealized: 680_000,
      unrealizedPct: 0.136,
    });
  });

  it('has no valuation without a price', () => {
    expect(valuePosition(position, null)).toBeNull();
  });
});

describe('summarise', () => {
  it('totals only the priced positions for profit, and counts the unpriced', () => {
    const book = buildPortfolio([
      trade('buy', 'VNM', 100, 50_000),
      trade('buy', 'ZZZ', 100, 10_000),
    ]);

    const totals = summarise(book, { VNM: 56_800, ZZZ: null });

    expect(totals).toMatchObject({
      cost: 6_000_000,
      marketValue: 5_680_000,
      unrealized: 680_000,
      unpriced: 1,
    });
    expect(totals.unrealizedPct).toBeCloseTo(0.136);
    // What the holdings are worth leaves no one out: the priced at market, the unpriced at cost.
    expect(totals.worth).toBe(5_680_000 + 1_000_000);
  });

  it('carries realised profit through', () => {
    const book = buildPortfolio([
      trade('buy', 'FPT', 100, 100_000),
      trade('sell', 'FPT', 100, 110_000),
    ]);
    expect(summarise(book, {}).realized).toBe(1_000_000);
  });
});

describe('dividends', () => {
  it('are income: net of tax, apart from realised profit, and change no position', () => {
    const book = buildPortfolio([
      trade('buy', 'VNM', 100, 50_000),
      trade('dividend', 'VNM', 100, 2_000, 20_000),
    ]);

    expect(book.dividends).toBe(180_000);
    expect(book.realized).toBe(0);
    expect(book.open[0]).toMatchObject({ quantity: 100, cost: 5_000_000, dividends: 180_000 });
  });

  it('count in the totals even when the symbol has no recorded buy, without becoming a holding', () => {
    const book = buildPortfolio([trade('dividend', 'ZZZ', 50, 1_000)]);
    expect(book.open).toEqual([]);
    expect(book.closed).toEqual([]);
    expect(summarise(book, {}).dividends).toBe(50_000);
  });
});

describe('sales and performance', () => {
  const book = buildPortfolio([
    trade('buy', 'AAA', 100, 10_000, 0, '#breakout first lot'),
    trade('sell', 'AAA', 100, 12_000, 0, null, '2026-11-02'),
    trade('buy', 'BBB', 100, 10_000, 0, '#breakout #news'),
    trade('sell', 'BBB', 100, 9_000, 0, null, '2026-11-03'),
    trade('buy', 'CCC', 100, 10_000, 0, '#news'),
    trade('sell', 'CCC', 100, 11_000, 0, null, '2026-11-04'),
  ]);

  it('lists each sale with what it made', () => {
    expect(book.sales.map((s) => [s.symbol, s.realized])).toEqual([
      ['AAA', 200_000],
      ['BBB', -100_000],
      ['CCC', 100_000],
    ]);
  });

  it('works out the win rate, the averages, the factor and the extremes', () => {
    const p = performanceOf(book.sales);
    expect(p).toMatchObject({
      sales: 3,
      wins: 2,
      losses: 1,
      avgWin: 150_000,
      avgLoss: 100_000,
      total: 200_000,
    });
    expect(p.winRate).toBeCloseTo(2 / 3);
    expect(p.profitFactor).toBeCloseTo(3);
    expect(p.best?.symbol).toBe('AAA');
    expect(p.worst?.symbol).toBe('BBB');
  });

  it('has nothing to say for no sales, and no factor when nothing was lost', () => {
    expect(performanceOf([])).toMatchObject({
      sales: 0,
      winRate: null,
      best: null,
      worst: null,
      total: 0,
    });
    expect(performanceOf(book.sales.filter((s) => s.realized > 0)).profitFactor).toBeNull();
  });

  it('reads #tags from notes, lower-cased, once each', () => {
    expect(tagsOf('#Breakout and #breakout, #news!')).toEqual(['breakout', 'news']);
    expect(tagsOf('#x no')).toEqual([]);
    expect(tagsOf(null)).toEqual([]);
  });

  it('shows which reason paid: results by tag, best total first', () => {
    const results = resultsByTag(book.sales);
    expect(results.map((r) => [r.tag, r.sales, r.total])).toEqual([
      ['breakout', 2, 100_000],
      ['news', 2, 0],
    ]);
    expect(results[0]?.winRate).toBeCloseTo(0.5);
  });
});
