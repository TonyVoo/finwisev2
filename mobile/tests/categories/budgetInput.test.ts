import { LIMITS } from '@expense-tracker/shared';
import { budgetInputText, parseBudgetInput } from '@/categories/budgetInput';

describe('parseBudgetInput', () => {
  it.each([
    ['40', 2, 4000],
    ['40.5', 2, 4050],
    ['40.50', 2, 4050],
    ['40,50', 2, 4050],
    ['0.05', 2, 5],
    ['007', 2, 700],
    [' 12 ', 2, 1200],
    ['500', 0, 500],
    ['1.234', 3, 1234],
  ])('reads %j at %i decimals as %i minor units', (text, decimals, expected) => {
    expect(parseBudgetInput(text, decimals)).toEqual({ kind: 'amount', amountMinor: expected });
  });

  it('treats empty and whitespace as "no budget"', () => {
    expect(parseBudgetInput('', 2)).toEqual({ kind: 'none' });
    expect(parseBudgetInput('   ', 2)).toEqual({ kind: 'none' });
  });

  it.each(['abc', '1.2.3', '-5', '+5', '1e3', '1,234.50', '.5', '$5', '5.'.concat('x')])(
    'rejects malformed %j',
    (text) => {
      expect(parseBudgetInput(text, 2)).toEqual({ kind: 'invalid', reason: 'format' });
    },
  );

  it('rejects more fraction digits than the currency has, instead of rounding money', () => {
    expect(parseBudgetInput('1.999', 2)).toEqual({ kind: 'invalid', reason: 'format' });
    expect(parseBudgetInput('1.5', 0)).toEqual({ kind: 'invalid', reason: 'format' });
  });

  it('rejects zero in every spelling, because a zero budget is not "no budget"', () => {
    for (const text of ['0', '0.00', '000', '0,0']) {
      expect(parseBudgetInput(text, 2)).toEqual({ kind: 'invalid', reason: 'zero' });
    }
  });

  it('accepts the contract maximum and rejects one minor unit past it', () => {
    const max = LIMITS.AMOUNT_MINOR_MAX;
    const asText = (minor: number) =>
      `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
    expect(parseBudgetInput(asText(max), 2)).toEqual({ kind: 'amount', amountMinor: max });
    expect(parseBudgetInput(asText(max + 1), 2)).toEqual({ kind: 'invalid', reason: 'max' });
    expect(parseBudgetInput('9'.repeat(40), 2)).toEqual({ kind: 'invalid', reason: 'max' });
  });
});

describe('budgetInputText', () => {
  it.each([
    [null, 2, ''],
    [4000, 2, '40.00'],
    [5, 2, '0.05'],
    [1234, 3, '1.234'],
    [500, 0, '500'],
  ])('renders %j at %i decimals as %j', (minor, decimals, expected) => {
    expect(budgetInputText(minor, decimals)).toBe(expected);
  });

  it('round-trips through the parser, so opening a sheet and saving changes nothing', () => {
    for (const minor of [1, 99, 100, 4050, 123456789]) {
      const text = budgetInputText(minor, 2);
      expect(parseBudgetInput(text, 2)).toEqual({ kind: 'amount', amountMinor: minor });
    }
  });
});
