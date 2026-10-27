import { COPY } from '@/copy/strings';
import { alertBody, alertNames, alertTitle, budgetAlert } from '@/summary/budgetAlerts';
import { type SpendEntry, budgetStatus } from '@/summary/summaryModel';

function entry(name: string, spentMinor: number, budgetMinor: number | null): SpendEntry {
  return {
    categoryId: name,
    name,
    color: '#2F8044',
    totalMinor: spentMinor,
    expenseCount: 1,
    budget: budgetStatus(spentMinor, budgetMinor),
    share: null,
    percentLabel: null,
  };
}

describe('budgetAlert', () => {
  it('is quiet when nothing has a budget, or everything is comfortably inside it', () => {
    expect(budgetAlert([])).toBeNull();
    expect(budgetAlert([entry('Food', 9999, null)])).toBeNull();
    expect(budgetAlert([entry('Food', 7900, 10000)])).toBeNull();
  });

  it('warns at exactly 80% and not a minor unit before', () => {
    expect(budgetAlert([entry('Food', 7999, 10000)])).toBeNull();
    expect(budgetAlert([entry('Food', 8000, 10000)])).toMatchObject({
      level: 'near',
      names: ['Food'],
    });
  });

  it('does not call spending exactly the budget "over"', () => {
    // The legend's own rule: hitting the limit is a month going to plan.
    expect(budgetAlert([entry('Food', 10000, 10000)])).toMatchObject({ level: 'near' });
    expect(budgetAlert([entry('Food', 10001, 10000)])).toMatchObject({ level: 'over' });
  });

  it('reports only the more serious level, with just the categories at it', () => {
    const alert = budgetAlert([
      entry('Rent', 150000, 100000),
      entry('Food', 9000, 10000),
      entry('Fun', 1000, 10000),
    ]);

    expect(alert).toMatchObject({ level: 'over', names: ['Rent'] });
  });

  it('keeps the legend order among categories at the same level', () => {
    const alert = budgetAlert([entry('B', 2000, 1000), entry('A', 3000, 1000)]);
    expect(alert?.names).toEqual(['B', 'A']);
  });

  it('changes its key when the situation does, so a dismissal cannot hide a new problem', () => {
    const one = budgetAlert([entry('Food', 2000, 1000)]);
    const two = budgetAlert([entry('Food', 2000, 1000), entry('Fun', 2000, 1000)]);
    const worse = budgetAlert([entry('Food', 9000, 10000)]);

    expect(one?.key).not.toBe(two?.key);
    expect(one?.key).not.toBe(worse?.key);
  });

  it('ignores an entry with a budget and no spend', () => {
    expect(budgetAlert([entry('Food', 0, 1000)])).toBeNull();
  });
});

describe('alert wording', () => {
  it('names one, two, three and many categories', () => {
    expect(alertNames(['A'])).toBe('A');
    expect(alertNames(['A', 'B'])).toBe('A and B');
    expect(alertNames(['A', 'B', 'C'])).toBe('A, B and C');
    expect(alertNames(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 more');
  });

  it('titles by level and count, and puts the names in the body', () => {
    const over = budgetAlert([entry('Rent', 2000, 1000)]);
    const overMany = budgetAlert([entry('Rent', 2000, 1000), entry('Fun', 2000, 1000)]);
    const near = budgetAlert([entry('Food', 900, 1000)]);

    expect(alertTitle(over!)).toBe(COPY.home.budgetAlert.overOne);
    expect(alertTitle(overMany!)).toBe('2 categories over budget');
    expect(alertTitle(near!)).toBe(COPY.home.budgetAlert.nearOne);
    expect(alertBody(over!)).toBe('Rent: spending is past the monthly budget.');
    expect(alertBody(near!)).toContain('Food');
  });
});
