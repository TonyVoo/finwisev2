import { formatMoney } from '@/lib/money';
import {
  isEmptyReading,
  planQuickAdd,
  quickAddSummary,
  type QuickAddPlanContext,
} from '@/quickAdd/planQuickAdd';
import type { QuickAddReading } from '@/quickAdd/parseQuickAdd';

/**
 * What a quick-add reading may do to the form: the receipt rules (`11-receipt-scan.md`), plus the type.
 * A reading is a suggestion and Use is the person's own act, but even then a value is only applied where it
 * is safe, and these plain functions are where that is decided.
 */

const reading: QuickAddReading = {
  type: 'income',
  amountMinor: 450,
  date: '2026-11-01',
  note: 'Coffee',
  categoryId: 'cat-1',
  confident: true,
};

const context: QuickAddPlanContext = {
  currentNote: null,
  decimalsMatch: true,
  today: '2026-11-02',
  canSetType: true,
};

describe('planQuickAdd', () => {
  it('offers everything the reading found when all of it is safe', () => {
    expect(planQuickAdd(reading, context)).toEqual({
      type: 'income',
      amountMinor: 450,
      date: '2026-11-01',
      note: 'Coffee',
      categoryId: 'cat-1',
    });
  });

  it('leaves the amount alone when the form pays in a currency with other decimals', () => {
    expect(planQuickAdd(reading, { ...context, decimalsMatch: false })).not.toHaveProperty(
      'amountMinor',
    );
  });

  it('never offers a date after the form’s today', () => {
    expect(planQuickAdd({ ...reading, date: '2026-11-03' }, context)).not.toHaveProperty('date');
    expect(planQuickAdd({ ...reading, date: '2026-11-02' }, context)).toHaveProperty('date');
  });

  it('never overwrites a note someone wrote, but fills an empty or blank one', () => {
    expect(planQuickAdd(reading, { ...context, currentNote: 'my own words' })).not.toHaveProperty(
      'note',
    );
    expect(planQuickAdd(reading, { ...context, currentNote: '   ' })).toHaveProperty('note');
  });

  it('only changes the type while the form is still untouched', () => {
    expect(planQuickAdd(reading, { ...context, canSetType: false })).not.toHaveProperty('type');
  });

  it('offers nothing for a reading that found nothing', () => {
    const nothing: QuickAddReading = {
      type: 'expense',
      amountMinor: null,
      date: null,
      note: null,
      categoryId: null,
      confident: false,
    };
    expect(planQuickAdd(nothing, context)).toEqual({});
  });

  it('leaves out each field the reading did not find', () => {
    expect(planQuickAdd({ ...reading, date: null, note: null, categoryId: null }, context)).toEqual(
      { type: 'income', amountMinor: 450 },
    );
  });
});

describe('isEmptyReading', () => {
  const nothing: QuickAddReading = {
    type: 'expense',
    amountMinor: null,
    date: null,
    note: null,
    categoryId: null,
    confident: false,
  };

  it('is true only when there is nothing to offer', () => {
    expect(isEmptyReading(nothing)).toBe(true);
    expect(isEmptyReading({ ...nothing, note: 'Hello' })).toBe(false);
    expect(isEmptyReading({ ...nothing, amountMinor: 5 })).toBe(false);
    expect(isEmptyReading({ ...nothing, type: 'income' })).toBe(false);
  });
});

describe('quickAddSummary', () => {
  const formatDate = (date: string) => `on ${date}`;

  it('is one line: amount first, then the date and the note', () => {
    expect(quickAddSummary(reading, 'USD', formatDate)).toBe(
      [formatMoney(450, 'USD'), 'on 2026-11-01', 'Coffee'].join(' · '),
    );
  });

  it('skips what was not found', () => {
    expect(quickAddSummary({ ...reading, amountMinor: null, date: null }, 'USD', formatDate)).toBe(
      'Coffee',
    );
  });
});
