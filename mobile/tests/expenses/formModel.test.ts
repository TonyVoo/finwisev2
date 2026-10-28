import { LIMITS } from '@expense-tracker/shared';
import { VALIDATION_COPY } from '@/copy/strings';
import type { ExpenseDraft } from '@/db/mutations';
import type { ExpenseDetail } from '@/db/queries';
import { hasEdits, saveState } from '@/expenses/formModel';

/**
 * Save enablement and the discard gate: `docs/design/06-expense-form.md` rules 6 and 11.
 *
 * Tested apart from the screen because this is the logic with four interacting inputs and
 * a precedence between them. The overlaps are the interesting part - a first-run user with
 * no categories also has a zero amount, and a stored row that is out of range is also
 * unchanged - and the spec names one message per situation rather than a list.
 */

const STORED: ExpenseDetail = {
  id: 'e1',
  categoryId: 'c1',
  kind: 'expense',
  amountMinor: 1250,
  currency: 'USD',
  originalAmountMinor: null,
  originalCurrency: null,
  date: '2026-10-14',
  note: 'Milk',
  private: false,
};

function draft(overrides: Partial<ExpenseDraft> = {}): ExpenseDraft {
  return {
    categoryId: 'c1',
    kind: 'expense',
    amountMinor: 1250,
    currency: 'USD',
    originalAmountMinor: null,
    originalCurrency: null,
    date: '2026-10-14',
    note: 'Milk',
    ...overrides,
  };
}

describe('saveState', () => {
  describe('add mode', () => {
    it('refuses a zero amount, and says why', () => {
      // Rule 6, and the reason it is a *hint* and not an error: this is guidance about a
      // form the user has not finished, not something they got wrong.
      const state = saveState({
        amountMinor: 0,
        stored: null,
        draft: draft({ amountMinor: 0 }),
        hasCategories: true,
      });

      expect(state.canSave).toBe(false);
      expect(state.hint).toBe(VALIDATION_COPY.amount.zero);
      expect(state.error).toBeUndefined();
    });

    it('allows a single minor unit', () => {
      // The boundary. `> 0`, not `>= 0`: zero is the initial state and would otherwise be
      // savable by pressing Save immediately.
      const state = saveState({
        amountMinor: 1,
        stored: null,
        draft: draft({ amountMinor: 1 }),
        hasCategories: true,
      });

      expect(state.canSave).toBe(true);
      expect(state.hint).toBeUndefined();
    });

    it('allows the maximum', () => {
      const state = saveState({
        amountMinor: LIMITS.AMOUNT_MINOR_MAX,
        stored: null,
        draft: draft({ amountMinor: LIMITS.AMOUNT_MINOR_MAX }),
        hasCategories: true,
      });

      expect(state.canSave).toBe(true);
    });

    it('does not ask for a change in add mode', () => {
      // "Nothing changed" is an edit-mode condition. An add-mode form has nothing to
      // compare against, and a nonzero amount is already the change.
      const state = saveState({
        amountMinor: 500,
        stored: null,
        draft: draft({ amountMinor: 500 }),
        hasCategories: true,
      });

      expect(state.canSave).toBe(true);
      expect(state.hint).not.toBe(VALIDATION_COPY.nochange);
    });
  });

  describe('edit mode', () => {
    it('refuses a form where nothing has changed', () => {
      const state = saveState({
        amountMinor: STORED.amountMinor,
        stored: STORED,
        draft: draft(),
        hasCategories: true,
      });

      expect(state.canSave).toBe(false);
      expect(state.hint).toBe(VALIDATION_COPY.nochange);
    });

    it.each([
      ['amount', draft({ amountMinor: 1300 }), 1300],
      ['category', draft({ categoryId: 'c2' }), STORED.amountMinor],
      ['date', draft({ date: '2026-10-13' }), STORED.amountMinor],
      ['note', draft({ note: 'Milk and eggs' }), STORED.amountMinor],
      ['note cleared', draft({ note: null }), STORED.amountMinor],
    ])('allows a save once the %s differs', (_field, changed, amountMinor) => {
      const state = saveState({ amountMinor, stored: STORED, draft: changed, hasCategories: true });

      expect(state.canSave).toBe(true);
    });

    it('treats a note that only gained whitespace as unchanged', () => {
      // `normaliseNote` trims on save, so `'Milk '` would store the same value as
      // `'Milk'`. Enabling Save for it would queue a mutation that changes nothing.
      const state = saveState({
        amountMinor: STORED.amountMinor,
        stored: STORED,
        draft: draft({ note: '  Milk  ' }),
        hasCategories: true,
      });

      expect(state.canSave).toBe(false);
      expect(state.hint).toBe(VALIDATION_COPY.nochange);
    });
  });

  describe('the precedence between reasons', () => {
    it('reports no categories ahead of a zero amount', () => {
      // Both are true for a first-run user whose category fetch failed. The missing
      // category is the one they cannot fix on this screen by typing, so it is the one
      // worth saying.
      const state = saveState({
        amountMinor: 0,
        stored: null,
        draft: draft({ amountMinor: 0 }),
        hasCategories: false,
      });

      expect(state.hint).toBe(VALIDATION_COPY.nocategories);
    });

    it('reports an out-of-range amount ahead of nothing having changed', () => {
      // A stored row out of range is also, necessarily, unchanged. Reporting it as merely
      // unchanged would hide the actual problem: the user has to know the amount is why.
      const outOfRange = { ...STORED, amountMinor: LIMITS.AMOUNT_MINOR_MAX + 1 };

      const state = saveState({
        amountMinor: outOfRange.amountMinor,
        stored: outOfRange,
        draft: draft({ amountMinor: outOfRange.amountMinor }),
        hasCategories: true,
      });

      expect(state.canSave).toBe(false);
      // An error, in `danger.default`, not a hint - the one genuine amount error, and it
      // comes from data rather than from typing (rule 8, last row).
      expect(state.error).toBe(VALIDATION_COPY.amount.outOfRange);
      expect(state.hint).toBeUndefined();
    });

    it('lets the user save their way out of an out-of-range row', () => {
      // "Save is disabled until the user changes the amount." Once they have, the row is
      // savable - the value is never auto-corrected for them.
      const outOfRange = { ...STORED, amountMinor: LIMITS.AMOUNT_MINOR_MAX + 1 };

      const state = saveState({
        amountMinor: 999,
        stored: outOfRange,
        draft: draft({ amountMinor: 999 }),
        hasCategories: true,
      });

      expect(state.canSave).toBe(true);
    });
  });
});

describe('hasEdits', () => {
  it('sees nothing to discard in an untouched form', () => {
    // Rule 11: with nothing edited, closing is immediate. A user who opens Add and backs
    // straight out must not be asked about a form they never touched - the prefilled
    // category and today's date are not edits.
    expect(
      hasEdits(draft({ amountMinor: 0, note: null }), draft({ amountMinor: 0, note: null })),
    ).toBe(false);
  });

  it('counts a nonzero amount in add mode', () => {
    const initial = draft({ amountMinor: 0, note: null });

    expect(hasEdits(initial, { ...initial, amountMinor: 1 })).toBe(true);
  });

  it('counts a category the user actually changed', () => {
    // The case a rule written only about the amount would miss: the user picked a
    // category, pressed back, and silently lost the choice.
    const initial = draft({ amountMinor: 0, note: null });

    expect(hasEdits(initial, { ...initial, categoryId: 'c2' })).toBe(true);
  });

  it('counts a changed date and a changed note', () => {
    const initial = draft({ amountMinor: 0, note: null });

    expect(hasEdits(initial, { ...initial, date: '2026-10-01' })).toBe(true);
    expect(hasEdits(initial, { ...initial, note: 'Coffee' })).toBe(true);
  });

  it('does not count whitespace that would not be stored', () => {
    const initial = draft({ note: null });

    expect(hasEdits(initial, { ...initial, note: '   ' })).toBe(false);
  });
});
