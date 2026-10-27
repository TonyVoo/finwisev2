import { expenseRowLabel, originalLabel } from '@/expenses/listModel';
import type { ExpenseListItem } from '@/db/queries';

function item(overrides: Partial<ExpenseListItem> = {}): ExpenseListItem {
  return {
    id: 'e1',
    categoryId: 'c1',
    kind: 'expense',
    categoryName: 'Groceries',
    categoryColor: '#22C55E',
    fallbackName: 'Uncategorized',
    fallbackColor: '#6B7280',
    amountMinor: 1082,
    currency: 'USD',
    originalAmountMinor: null,
    originalCurrency: null,
    date: '2026-10-14',
    note: null,
    createdBy: null,
    pending: false,
    needsAttention: false,
    ...overrides,
  };
}

describe('how a foreign expense reads', () => {
  it('has no original label for an ordinary expense', () => {
    expect(originalLabel(item(), 'en-US')).toBeNull();
  });

  it('shows what was actually paid, in its own currency', () => {
    expect(
      originalLabel(item({ originalAmountMinor: 1000, originalCurrency: 'EUR' }), 'en-US'),
    ).toBe('€10.00');
    expect(
      originalLabel(item({ originalAmountMinor: 5000, originalCurrency: 'JPY' }), 'en-US'),
    ).toBe('¥5,000');
  });

  it('adds it to the spoken label, after the amount the totals use', () => {
    const label = expenseRowLabel(
      item({ originalAmountMinor: 1000, originalCurrency: 'EUR' }),
      '2026-10-14',
      'en-US',
    );
    expect(label).toContain('$10.82');
    expect(label).toContain('paid €10.00');
    expect(label.indexOf('$10.82')).toBeLessThan(label.indexOf('paid €10.00'));
  });

  it('leaves an ordinary expense label as it was', () => {
    expect(expenseRowLabel(item(), '2026-10-14', 'en-US')).not.toContain('paid');
  });
});
