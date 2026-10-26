import { COPY, VALIDATION_COPY } from '@/copy/strings';
import type { RecurringListItem } from '@/db/queries';
import {
  type RecurringDraft,
  parseDateInput,
  recurringNextLabel,
  recurringSummary,
  recurringTitle,
  validateRecurringDraft,
} from '@/recurring/recurringModel';

const draft = (overrides: Partial<RecurringDraft> = {}): RecurringDraft => ({
  categoryId: 'c1',
  amountText: '12.99',
  note: '',
  frequency: 'monthly',
  startText: '2026-11-05',
  endText: '',
  ...overrides,
});

describe('parseDateInput', () => {
  it.each(['2026-11-05', '2028-02-29', ' 2026-01-31 '])('accepts %j', (text) => {
    expect(parseDateInput(text)).toBe(text.trim());
  });

  it.each([
    '',
    '2026-2-5',
    '26-02-05',
    '2026/02/05',
    '2026-13-01',
    '2026-00-10',
    '2026-02-30',
    '2027-02-29',
    '2026-04-31',
    '2026-01-00',
    '1800-01-01',
    '2026-01-01T00:00',
  ])('rejects %j', (text) => {
    expect(parseDateInput(text)).toBeNull();
  });
});

describe('validateRecurringDraft', () => {
  it('accepts a good draft and returns minor units, a trimmed note and null end', () => {
    expect(validateRecurringDraft(draft({ note: '  Rent ' }), 2)).toEqual({
      ok: true,
      value: {
        categoryId: 'c1',
        amountMinor: 1299,
        note: 'Rent',
        frequency: 'monthly',
        startDate: '2026-11-05',
        endDate: null,
      },
    });
  });

  it('turns a blank note into null, not an empty string', () => {
    const result = validateRecurringDraft(draft({ note: '   ' }), 2);
    expect(result.ok && result.value.note).toBeNull();
  });

  it('reports every problem at once', () => {
    const result = validateRecurringDraft(
      draft({ categoryId: null, amountText: '', startText: 'soon', endText: 'later' }),
      2,
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        category: COPY.recurring.error.noCategory,
        amount: VALIDATION_COPY.amount.zero,
        startDate: COPY.recurring.error.date,
        endDate: COPY.recurring.error.date,
      },
    });
  });

  it.each([
    ['0', VALIDATION_COPY.amount.zero],
    ['abc', COPY.recurring.error.amount],
    ['1.234', COPY.recurring.error.amount],
    ['9'.repeat(30), VALIDATION_COPY.amount.max],
  ])('rejects the amount %j', (amountText, message) => {
    const result = validateRecurringDraft(draft({ amountText }), 2);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.amount).toBe(message);
  });

  it('refuses an end before the start, but allows end equal to start', () => {
    const before = validateRecurringDraft(draft({ endText: '2026-11-04' }), 2);
    expect(!before.ok && before.errors.endDate).toBe(COPY.recurring.error.endBeforeStart);

    expect(validateRecurringDraft(draft({ endText: '2026-11-05' }), 2).ok).toBe(true);
  });

  it('does not judge the end against a start that is itself invalid', () => {
    const result = validateRecurringDraft(draft({ startText: 'x', endText: '2026-01-01' }), 2);
    expect(!result.ok && result.errors).toEqual({ startDate: COPY.recurring.error.date });
  });

  it('reads whole-unit currencies with no decimals', () => {
    const result = validateRecurringDraft(draft({ amountText: '1500' }), 0);
    expect(result.ok && result.value.amountMinor).toBe(1500);
    expect(validateRecurringDraft(draft({ amountText: '15.5' }), 0).ok).toBe(false);
  });
});

describe('list labels', () => {
  const item = (overrides: Partial<RecurringListItem> = {}): RecurringListItem => ({
    id: 'r1',
    categoryId: 'c1',
    categoryName: 'Bills',
    categoryColor: '#8E4EC6',
    amountMinor: 1299,
    currency: 'USD',
    note: 'Netflix',
    frequency: 'monthly',
    startDate: '2026-01-31',
    endDate: null,
    pending: false,
    ...overrides,
  });

  it('titles a row with its note, then its category, then the fallback name', () => {
    expect(recurringTitle(item(), 'Uncategorized')).toBe('Netflix');
    expect(recurringTitle(item({ note: null }), 'Uncategorized')).toBe('Bills');
    expect(recurringTitle(item({ note: null, categoryName: null }), 'Uncategorized')).toBe(
      'Uncategorized',
    );
  });

  it('summarises amount and frequency', () => {
    expect(recurringSummary(item())).toBe('$12.99 · Monthly');
    expect(recurringSummary(item({ frequency: 'weekly' }))).toBe('$12.99 · Weekly');
  });

  it('says when it fires next, or that it ended', () => {
    expect(recurringNextLabel(item(), '2026-02-28')).toBe('Next 2026-03-31');
    expect(recurringNextLabel(item({ endDate: '2026-03-01' }), '2026-03-10')).toBe('Ended');
  });
});
