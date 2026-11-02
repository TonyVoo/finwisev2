import { planImport, type ImportContext } from '@/import/planImport';
import { buildExpensesCsv } from '@/export/csv';
import { parseCsv } from '@/import/parseCsv';

const FOOD = 'cat-food';
const OTHER = 'cat-other';

function context(overrides: Partial<ImportContext> = {}): ImportContext {
  return {
    homeCurrency: 'USD',
    decimalsFor: (c) => (c === 'VND' || c === 'JPY' ? 0 : 2),
    categories: [
      { id: FOOD, name: 'Food', isDefault: false },
      { id: OTHER, name: 'Uncategorized', isDefault: true },
    ],
    existingKeys: new Set(),
    ...overrides,
  };
}

const plan = (text: string, overrides: Partial<ImportContext> = {}) =>
  planImport(parseCsv(text), context(overrides));

describe('reading our own export back', () => {
  it('round-trips an exported file', () => {
    const csv = buildExpensesCsv(
      [
        {
          date: '2026-10-05',
          amountMinor: 1250,
          currency: 'USD',
          categoryName: 'Food',
          note: 'Lunch, with Sam',
        },
        {
          date: '2026-10-06',
          amountMinor: 50000,
          currency: 'USD',
          categoryName: 'Uncategorized',
          note: null,
          kind: 'income',
        },
      ],
      (c) => (c === 'VND' ? 0 : 2),
    );

    const result = plan(csv);

    expect(result.entries).toEqual([
      {
        categoryId: FOOD,
        kind: 'expense',
        amountMinor: 1250,
        currency: 'USD',
        date: '2026-10-05',
        note: 'Lunch, with Sam',
      },
      {
        categoryId: OTHER,
        kind: 'income',
        amountMinor: 50000,
        currency: 'USD',
        date: '2026-10-06',
        note: null,
      },
    ]);
    expect(result.skipped).toEqual({});
  });

  it('keeps a foreign original amount', () => {
    const csv = buildExpensesCsv(
      [
        {
          date: '2026-10-05',
          amountMinor: 1082,
          currency: 'USD',
          categoryName: 'Food',
          note: null,
          originalAmountMinor: 1000,
          originalCurrency: 'EUR',
        },
      ],
      () => 2,
    );
    expect(plan(csv).entries[0]).toMatchObject({
      originalAmountMinor: 1000,
      originalCurrency: 'EUR',
    });
  });

  it('undoes the apostrophe that guards a note against being read as a formula', () => {
    const csv = buildExpensesCsv(
      [
        {
          date: '2026-10-05',
          amountMinor: 100,
          currency: 'USD',
          categoryName: 'Food',
          note: '=1+1',
        },
      ],
      () => 2,
    );
    expect(plan(csv).entries[0]?.note).toBe('=1+1');
  });
});

describe('other files', () => {
  it('finds columns by their names, in any order and case', () => {
    const result = plan('memo,AMOUNT,category,date\nCoffee,3.50,food,2026-10-05');
    expect(result.entries).toEqual([
      {
        categoryId: FOOD,
        kind: 'expense',
        amountMinor: 350,
        currency: 'USD',
        date: '2026-10-05',
        note: 'Coffee',
      },
    ]);
  });

  it('reads day-first dates, the usual in Vietnam, and uses the month when the day cannot be one', () => {
    const result = plan('Date,Amount\n05/10/2026,1\n25/10/2026,1\n10/25/2026,1');
    expect(result.entries.map((e) => e.date)).toEqual(['2026-10-05', '2026-10-25', '2026-10-25']);
  });

  it.each([
    ['1.250.000', 'VND', 1250000],
    ['1,250,000', 'VND', 1250000],
    ['12.50', 'USD', 1250],
    ['12,50', 'USD', 1250],
    ['1,234.56', 'USD', 123456],
    ['1.234,56', 'USD', 123456],
    ['$ 7', 'USD', 700],
    ['-3.5', 'USD', 350],
  ])('reads the amount %s in %s', (text, currency, minor) => {
    const result = plan(`Date,Amount\n2026-10-05,"${text}"`, { homeCurrency: currency });
    expect(result.entries[0]?.amountMinor).toBe(minor);
  });

  it('files an unknown category under the default one and says how many', () => {
    const result = plan('Date,Amount,Category\n2026-10-05,1,Pets\n2026-10-05,1,Food');
    expect(result.entries.map((e) => e.categoryId)).toEqual([OTHER, FOOD]);
    expect(result.unmatchedCategories).toBe(1);
  });
});

describe('rows that are left out, and why', () => {
  it('skips a bad date, a bad amount, a zero amount and an empty row', () => {
    const result = plan(
      'Date,Amount\nsoon,1\n2026-10-05,abc\n2026-10-05,0\n2026-02-30,1\n,\n2026-10-05,2',
    );
    expect(result.entries).toHaveLength(1);
    expect(result.skipped).toEqual({ date: 2, amount: 2 });
  });

  it('skips an amount too large to store', () => {
    const result = plan('Date,Amount\n2026-10-05,99999999999999');
    expect(result.skipped).toEqual({ amount: 1 });
  });

  it('skips a row in another currency, which cannot be converted without a rate', () => {
    const result = plan('Date,Amount,Currency\n2026-10-05,5,EUR\n2026-10-05,5,USD');
    expect(result.entries).toHaveLength(1);
    expect(result.skipped).toEqual({ currency: 1 });
  });

  it('skips what is already there, so importing a file twice adds nothing the second time', () => {
    const first = plan('Date,Amount,Note\n2026-10-05,1.00,Tea');
    const key = first.keys[0]!;

    const again = plan('Date,Amount,Note\n2026-10-05,1.00,Tea', { existingKeys: new Set([key]) });

    expect(again.entries).toEqual([]);
    expect(again.skipped).toEqual({ duplicate: 1 });
  });

  it('refuses a file without a date and an amount column', () => {
    expect(plan('Foo,Bar\n1,2').problem).toBe('columns');
    expect(plan('').problem).toBe('empty');
  });

  it('refuses a file with too many rows', () => {
    const rows = Array.from({ length: 2001 }, () => '2026-10-05,1').join('\n');
    expect(plan(`Date,Amount\n${rows}`).problem).toBe('tooMany');
  });
});
