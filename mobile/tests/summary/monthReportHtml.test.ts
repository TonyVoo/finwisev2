import { COPY } from '@/copy/strings';
import { buildStocksBlock } from '@/summary/monthReport';
import { type MonthReport, monthReportHtml } from '@/summary/monthReportHtml';
import type { SpendEntry } from '@/summary/summaryModel';
import type { TradeListItem } from '@/db/queries';

const entry = (name: string, total: number, budget?: number): SpendEntry =>
  ({
    categoryId: name,
    name,
    color: '#2F8044',
    totalMinor: total,
    expenseCount: 1,
    budget:
      budget === undefined
        ? null
        : {
            budgetMinor: budget,
            spentMinor: total,
            remainingMinor: budget - total,
            over: total > budget,
            fill: 1,
          },
    share: 0.5,
    percentLabel: '50%',
  }) as SpendEntry;

const report = (over: Partial<MonthReport> = {}): MonthReport => ({
  month: '2026-11',
  currency: 'USD',
  spentMinor: 120_000,
  incomeMinor: 500_000,
  entries: [entry('Food', 80_000, 70_000), entry('Rent', 40_000)],
  goals: [],
  stocks: null,
  insights: [],
  madeOn: '2026-11-14',
  ...over,
});

describe('monthReportHtml', () => {
  it('has the month, the three figures and each category with its budget', () => {
    const html = monthReportHtml(report(), 'en');
    expect(html).toContain('November 2026');
    expect(html).toContain('$1,200.00');
    expect(html).toContain('$5,000.00');
    expect(html).toContain('$3,800.00');
    expect(html).toContain('Food');
    expect(html).toContain('$700.00');
    expect(html).toContain('class="over"');
    expect(html).toContain('Made on 2026-11-14');
  });

  it('escapes what a person typed', () => {
    const html = monthReportHtml(
      report({
        entries: [entry('<script>alert(1)</script>', 1000)],
        insights: ['a "quote" & <b>'],
        goals: [
          {
            id: 'g',
            name: '<img src=x>',
            targetMinor: 100,
            savedMinor: 50,
            currency: 'USD',
            deadline: null,
            pending: false,
          },
        ],
      }),
      'en',
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &quot;quote&quot; &amp; &lt;b&gt;');
  });

  it('says nothing was recorded for an empty month, with no category table', () => {
    const html = monthReportHtml(report({ entries: [], spentMinor: 0, incomeMinor: 0 }), 'en');
    expect(html).toContain(COPY.summary.report.empty);
    expect(html).not.toContain(COPY.summary.report.categories);
  });

  it('adds goals with their progress, and the stocks only when given', () => {
    const goals = [
      {
        id: 'g',
        name: 'Laptop',
        targetMinor: 100_000,
        savedMinor: 25_000,
        currency: 'USD',
        deadline: null,
        pending: false,
      },
    ];
    expect(monthReportHtml(report({ goals }), 'en')).toContain('width:25%');
    expect(monthReportHtml(report(), 'en')).not.toContain(COPY.summary.report.stocks);

    const html = monthReportHtml(
      report({
        stocks: {
          worthDong: 5_680_000,
          unrealizedDong: 672_500,
          holdings: [
            { symbol: 'VNM', valueDong: 5_680_000 },
            { symbol: 'ZZZ', valueDong: null },
          ],
        },
      }),
      'en',
    );
    expect(html).toContain(COPY.summary.report.stocks);
    expect(html).toContain('VNM');
    expect(html).toContain('—');
  });
});

describe('buildStocksBlock', () => {
  let n = 0;
  const buy = (symbol: string, quantity: number, price: number): TradeListItem => ({
    id: `t${(n += 1)}`,
    symbol,
    side: 'buy',
    quantity,
    price,
    fee: 0,
    date: '2026-10-01',
    note: null,
    pending: false,
  });
  const quote = (close: number) => ({ data: { close } }) as never;

  it('values what has a price, lists what has none without a value, and leaves it out with no price at all', async () => {
    const some = await buildStocksBlock(
      {
        getMarketQuote: async (s: string) =>
          s === 'VNM' ? quote(56_800) : Promise.reject(new Error('down')),
      },
      [buy('VNM', 100, 50_000), buy('ZZZ', 100, 10_000)],
    );
    expect(some?.holdings).toEqual([
      { symbol: 'VNM', valueDong: 5_680_000 },
      { symbol: 'ZZZ', valueDong: null },
    ]);
    expect(some?.worthDong).toBe(5_680_000 + 1_000_000);
    expect(some?.unrealizedDong).toBe(680_000);

    expect(
      await buildStocksBlock({ getMarketQuote: async () => Promise.reject(new Error('down')) }, [
        buy('VNM', 1, 1),
      ]),
    ).toBeNull();
    expect(await buildStocksBlock({ getMarketQuote: async () => quote(1) }, [])).toBeNull();
  });
});
