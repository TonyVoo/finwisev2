import { activeFilterCount, presetRange, toSearch } from '@/search/filterModel';

const TODAY = '2026-11-03';

describe('date presets', () => {
  it.each([
    ['thisMonth', { from: '2026-11-01', to: '2026-11-30' }],
    ['lastMonth', { from: '2026-10-01', to: '2026-10-31' }],
    ['last3Months', { from: '2026-09-01', to: '2026-11-30' }],
    ['thisYear', { from: '2026-01-01', to: '2026-12-31' }],
  ] as const)('%s', (preset, range) => {
    expect(presetRange(preset, TODAY)).toEqual(range);
  });

  it('steps back across a year boundary', () => {
    expect(presetRange('lastMonth', '2026-01-15')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(presetRange('last3Months', '2026-02-15')).toEqual({
      from: '2025-12-01',
      to: '2026-02-28',
    });
  });
});

describe('turning a saved view into a search', () => {
  it('resolves the preset against today and keeps the rest', () => {
    expect(
      toSearch(
        { text: 'coffee', categoryId: 'c1', kind: 'expense', minMinor: 500, range: 'lastMonth' },
        TODAY,
      ),
    ).toEqual({
      text: 'coffee',
      categoryId: 'c1',
      kind: 'expense',
      minMinor: 500,
      maxMinor: null,
      from: '2026-10-01',
      to: '2026-10-31',
    });
  });

  it('has no dates without a preset', () => {
    expect(toSearch({ text: '', categoryId: null }, TODAY)).toMatchObject({ from: null, to: null });
  });
});

describe('counting the filters in use', () => {
  it('counts kind, amount, and dates, but not the text or category chips', () => {
    expect(activeFilterCount({ text: 'x', categoryId: 'c' })).toBe(0);
    expect(activeFilterCount({ text: '', categoryId: null, kind: 'income' })).toBe(1);
    expect(
      activeFilterCount({
        text: '',
        categoryId: null,
        kind: 'income',
        minMinor: 1,
        maxMinor: 2,
        range: 'thisYear',
      }),
    ).toBe(4);
  });
});
