import type { ReceiptScan } from '@expense-tracker/shared';
import {
  isEmptyScan,
  matchCategory,
  planSuggestion,
  suggestionSummary,
} from '@/receipts/receiptSuggestion';

/**
 * What a receipt reading may do to the form, and what it must leave alone. The reading is only
 * ever a suggestion: these rules decide which of its values are safe to put in the fields when
 * the person taps Use (`docs/design/11-receipt-scan.md`).
 */

const FULL: ReceiptScan = {
  amountMinor: 1250,
  currency: 'USD',
  date: '2026-10-14',
  merchant: 'Milk Mart',
  category: 'groceries',
};
const NONE: ReceiptScan = {
  amountMinor: null,
  currency: 'USD',
  date: null,
  merchant: null,
  category: null,
};
const CATEGORIES = [
  { id: 'c-unc', name: 'Uncategorized' },
  { id: 'c-groc', name: 'Groceries' },
  { id: 'c-eat', name: 'Eating out' },
  { id: 'c-trans', name: 'Transport' },
  { id: 'c-health', name: 'Health' },
  { id: 'c-bills', name: 'Bills' },
];
const CONTEXT = {
  currentNote: null,
  decimalsMatch: true,
  categories: CATEGORIES,
  today: '2026-10-14',
};

describe('matchCategory', () => {
  it.each([
    ['groceries', 'c-groc'],
    ['eating_out', 'c-eat'],
    ['transport', 'c-trans'],
    ['health', 'c-health'],
    ['bills', 'c-bills'],
  ] as const)('%s is the default category of that name', (key, id) => {
    expect(matchCategory(key, CATEGORIES)).toBe(id);
  });

  it('knows the Vietnamese default names too', () => {
    const vi = [
      { id: 'v-groc', name: 'Tạp hóa' },
      { id: 'v-eat', name: 'Ăn ngoài' },
    ];
    expect(matchCategory('groceries', vi)).toBe('v-groc');
    expect(matchCategory('eating_out', vi)).toBe('v-eat');
  });

  it('ignores case and surrounding space', () => {
    expect(matchCategory('groceries', [{ id: 'x', name: '  GROCERIES ' }])).toBe('x');
  });

  it('is null when the person no longer has that category, or the reading has none', () => {
    expect(matchCategory('health', CATEGORIES.slice(0, 3))).toBeNull();
    expect(matchCategory(null, CATEGORIES)).toBeNull();
  });
});

describe('planSuggestion', () => {
  it('offers every value it found', () => {
    expect(planSuggestion(FULL, CONTEXT)).toEqual({
      amountMinor: 1250,
      date: '2026-10-14',
      note: 'Milk Mart',
      categoryId: 'c-groc',
    });
  });

  it('offers nothing for a reading that found nothing', () => {
    expect(planSuggestion(NONE, CONTEXT)).toEqual({});
  });

  it('never overwrites a note the person already wrote', () => {
    expect(planSuggestion(FULL, { ...CONTEXT, currentNote: 'Birthday cake' }).note).toBeUndefined();
  });

  it('treats a note of only spaces as empty', () => {
    expect(planSuggestion(FULL, { ...CONTEXT, currentNote: '   ' }).note).toBe('Milk Mart');
  });

  it('leaves the amount alone when the form pays in a currency with other decimals', () => {
    const patch = planSuggestion(FULL, { ...CONTEXT, decimalsMatch: false });
    expect(patch.amountMinor).toBeUndefined();
    expect(patch.date).toBe('2026-10-14');
  });

  it('leaves the date alone when it is after the form’s today', () => {
    expect(planSuggestion({ ...FULL, date: '2026-10-15' }, CONTEXT).date).toBeUndefined();
    expect(planSuggestion({ ...FULL, date: '2026-10-14' }, CONTEXT).date).toBe('2026-10-14');
  });

  it('leaves the category alone when it matches none of the person’s own', () => {
    const patch = planSuggestion(FULL, { ...CONTEXT, categories: [] });
    expect(patch.categoryId).toBeUndefined();
    expect(patch.amountMinor).toBe(1250);
  });
});

describe('isEmptyScan', () => {
  it('is true only when nothing at all was found', () => {
    expect(isEmptyScan(NONE)).toBe(true);
    expect(isEmptyScan({ ...NONE, category: 'bills' })).toBe(false);
    expect(isEmptyScan({ ...NONE, merchant: 'x' })).toBe(false);
  });
});

describe('suggestionSummary', () => {
  it('joins what was found, amount first', () => {
    expect(suggestionSummary(FULL, () => '14 Oct')).toBe('$12.50 · 14 Oct · Milk Mart');
  });

  it('leaves out what was not found', () => {
    expect(suggestionSummary({ ...NONE, amountMinor: 500 }, () => 'x')).toBe('$5.00');
    expect(
      suggestionSummary({ ...NONE, merchant: 'Cafe', date: '2026-10-01' }, () => '1 Oct'),
    ).toBe('1 Oct · Cafe');
  });
});
