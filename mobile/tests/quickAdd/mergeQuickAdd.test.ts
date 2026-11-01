import type { QuickAddSuggestion } from '@expense-tracker/shared';
import type { QuickAddReading } from '@/quickAdd/parseQuickAdd';
import { mergeQuickAdd } from '@/quickAdd/mergeQuickAdd';

/**
 * Putting the server's reading beside the phone's own (`docs/design/15-quick-add.md`, "Merging"): the
 * phone keeps everything it was sure of, and the model fills only the gaps, so it can add a date or a
 * note but never overrule a clear `45k`.
 */

const CATEGORIES = ['Groceries', 'Eating out', 'Transport', 'Health', 'Bills'].map((name) => ({
  id: name,
  name,
}));

const unsure: QuickAddReading = {
  type: 'expense',
  amountMinor: null,
  date: null,
  note: 'Coffee 4.50 tip 1.00',
  categoryId: 'Eating out',
  confident: false,
};

const model: QuickAddSuggestion = {
  type: 'expense',
  amountMinor: 450,
  currency: 'USD',
  date: '2026-11-01',
  note: 'coffee',
  category: 'groceries',
};

const merge = (rules: QuickAddReading, answer: Partial<QuickAddSuggestion> = {}) =>
  mergeQuickAdd(rules, { ...model, ...answer }, CATEGORIES);

describe('mergeQuickAdd', () => {
  it('fills what the phone left empty from the model', () => {
    expect(merge(unsure)).toMatchObject({ amountMinor: 450, date: '2026-11-01', confident: true });
  });

  it('never overrules what the phone was sure of', () => {
    const sure: QuickAddReading = {
      ...unsure,
      amountMinor: 999,
      date: '2026-10-14',
      confident: true,
    };
    expect(merge(sure)).toMatchObject({ amountMinor: 999, date: '2026-10-14' });
  });

  describe('type', () => {
    it('keeps income the phone found', () => {
      expect(merge({ ...unsure, type: 'income' }, { type: 'expense' }).type).toBe('income');
    });

    it('takes the model’s income where the phone saw only the default expense', () => {
      expect(merge(unsure, { type: 'income' }).type).toBe('income');
    });

    it('keeps the phone’s type when the model has none', () => {
      expect(merge(unsure, { type: null }).type).toBe('expense');
    });
  });

  describe('note', () => {
    it('prefers the model’s, which has the amount and date taken out, and capitalises it', () => {
      expect(merge(unsure, { note: 'rent to Mr Lam' }).note).toBe('Rent to Mr Lam');
    });

    it('keeps the phone’s when the model has none', () => {
      expect(merge(unsure, { note: null }).note).toBe('Coffee 4.50 tip 1.00');
    });
  });

  describe('category', () => {
    it('keeps the phone’s, which matched the person’s own names', () => {
      expect(merge(unsure).categoryId).toBe('Eating out');
    });

    it('maps the model’s default key to the person’s own category when the phone had none', () => {
      expect(merge({ ...unsure, categoryId: null }, { category: 'groceries' }).categoryId).toBe(
        'Groceries',
      );
    });

    it('offers none the person does not have', () => {
      expect(
        mergeQuickAdd({ ...unsure, categoryId: null }, model, [{ id: 'x', name: 'Pets' }])
          .categoryId,
      ).toBeNull();
    });
  });

  it('is not confident when the model found no amount either', () => {
    expect(merge(unsure, { amountMinor: null }).confident).toBe(false);
  });

  it('changes nothing when the model found nothing', () => {
    const nothing: QuickAddSuggestion = {
      type: null,
      amountMinor: null,
      currency: 'USD',
      date: null,
      note: null,
      category: null,
    };
    expect(mergeQuickAdd(unsure, nothing, CATEGORIES)).toEqual(unsure);
  });

  it('does not change what it was given', () => {
    const before = { ...unsure };
    merge(unsure);
    expect(unsure).toEqual(before);
  });
});
