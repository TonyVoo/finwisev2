import { UNCATEGORIZED_NAME } from '@expense-tracker/shared';
import type { ExpenseListItem } from '@/db/queries';
import {
  type ExpenseSection,
  expenseRowLabel,
  groupByDate,
  rowCategoryColor,
  rowCategoryName,
} from '@/expenses/listModel';
import { CATEGORY_RESERVED_COLOR } from '@/theme/tokens';

/**
 * The list's shape: `docs/design/04-expense-list.md` rules 1-2 and §Accessibility rule 1.
 *
 * Pure functions over the rows the query returned, tested as arithmetic. What they decide
 * is which day an expense is filed under and what a screen reader hears, and both are
 * wrong in ways a screenshot does not show.
 */

const TODAY = '2026-10-14';

/**
 * `en-GB` is passed wherever a literal day label is asserted, matching the convention in
 * `tests/lib/calendar.test.ts`. The design writes the format as `EEE d MMM` (`Mon 4 Oct`),
 * which is the `en-GB` rendering; `dayLabel` follows the *device* locale on purpose, so
 * `en-US` would correctly hand back `Mon Oct 4`. Pinning the locale keeps these cases
 * about the grouping rather than about where the suite runs.
 */
const UK = 'en-GB';

/**
 * The section at `index`, or a failure naming what was missing.
 *
 * `noUncheckedIndexedAccess` is on, so indexing returns `T | undefined`. Asserting here
 * rather than with `!` means a grouping bug that produces too few sections fails with a
 * sentence instead of a `Cannot read property 'title' of undefined`.
 */
function sectionAt(sections: readonly ExpenseSection[], index: number): ExpenseSection {
  const found = sections[index];
  if (found === undefined) {
    throw new Error(`expected a section at index ${index}, got ${sections.length} sections`);
  }
  return found;
}

function item(overrides: Partial<ExpenseListItem> = {}): ExpenseListItem {
  return {
    id: 'e1',
    categoryId: 'c1',
    kind: 'expense',
    categoryName: 'Groceries',
    categoryColor: '#22C55E',
    fallbackName: 'Uncategorized',
    fallbackColor: CATEGORY_RESERVED_COLOR,
    amountMinor: 1250,
    currency: 'USD',
    originalAmountMinor: null,
    originalCurrency: null,
    date: TODAY,
    note: null,
    createdBy: null,
    pending: false,
    needsAttention: false,
    ...overrides,
  };
}

describe('groupByDate', () => {
  it('groups nothing into nothing', () => {
    expect(groupByDate([], TODAY)).toEqual([]);
  });

  it('puts a day of rows under one header', () => {
    const sections = groupByDate(
      [
        item({ id: 'a', date: TODAY }),
        item({ id: 'b', date: TODAY }),
        item({ id: 'c', date: TODAY }),
      ],
      TODAY,
    );

    expect(sections).toHaveLength(1);
    expect(sectionAt(sections, 0).title).toBe('Today');
    expect(sectionAt(sections, 0).data.map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });

  it('starts a new section when the date changes', () => {
    const sections = groupByDate(
      [
        item({ id: 'a', date: '2026-10-14' }),
        item({ id: 'b', date: '2026-10-13' }),
        item({ id: 'c', date: '2026-10-13' }),
        item({ id: 'd', date: '2026-10-04' }),
      ],
      TODAY,
      UK,
    );

    expect(sections.map((section) => [section.title, section.data.length])).toEqual([
      ['Today', 1],
      ['Yesterday', 2],
      ['Sun 4 Oct', 1],
    ]);
  });

  it('keys each section on the raw date, not on its title', () => {
    // Two different days can render the same *title* only across years, but the key has to
    // be stable and unique regardless - `date` is, a localised title is not.
    const sections = groupByDate(
      [item({ id: 'a', date: '2026-10-14' }), item({ id: 'b', date: '2025-10-14' })],
      TODAY,
    );

    expect(sections.map((section) => section.date)).toEqual(['2026-10-14', '2025-10-14']);
  });

  it('preserves the order the query returned, and does not sort', () => {
    // The query owns the ordering contract - `date DESC, id DESC`, which is what puts a
    // just-added expense at the top of its day. Re-sorting here would take that over and
    // the two could then disagree with nothing to say which was right. So an input in a
    // surprising order comes back in that same order.
    const sections = groupByDate(
      [
        item({ id: 'x', date: '2026-10-10' }),
        item({ id: 'y', date: '2026-10-14' }),
        item({ id: 'z', date: '2026-10-10' }),
      ],
      TODAY,
    );

    // Three sections, not two: the walk is consecutive, so the second 2026-10-10 opens a
    // new one rather than being folded back into the first.
    expect(sections.map((section) => section.date)).toEqual([
      '2026-10-10',
      '2026-10-14',
      '2026-10-10',
    ]);
  });

  describe('the day an expense is filed under', () => {
    it('files a row by its own date, not by when it was typed', () => {
      // Rule 1: "A row dated last Tuesday that was typed today belongs under last
      // Tuesday." Nothing here reads `createdAt`, which is the whole point.
      const sections = groupByDate([item({ date: '2026-10-06' })], TODAY, UK);

      expect(sectionAt(sections, 0).title).toBe('Tue 6 Oct');
    });

    it('does not shift a date through a local Date', () => {
      // The single most likely date bug in this app. A date at the very start of a day is
      // the one that moves if it is parsed as an instant and re-read in a zone behind UTC.
      const sections = groupByDate([item({ date: '2026-03-01' })], '2026-03-01');

      expect(sectionAt(sections, 0).title).toBe('Today');
      expect(sectionAt(sections, 0).date).toBe('2026-03-01');
    });

    it('keeps the year on a date from another calendar year', () => {
      // Rule 2: `Mon 4 Oct` alone would read as this year's.
      const sections = groupByDate([item({ date: '2025-10-04' })], TODAY, UK);

      expect(sectionAt(sections, 0).title).toBe('Sat 4 Oct 2025');
    });
  });
});

describe('what a row shows when its category is gone', () => {
  it('uses the category name when it resolves', () => {
    expect(rowCategoryName(item())).toBe('Groceries');
    expect(rowCategoryColor(item())).toBe('#22C55E');
  });

  it('falls back to the default category when the row points at a tombstone', () => {
    // Reachable rather than defensive: a pull delivers rows by revision, so a category
    // tombstone can arrive before the reassignment that follows it. The row is money the
    // user spent and must render.
    const orphan = item({ categoryName: null, categoryColor: null });

    expect(rowCategoryName(orphan)).toBe('Uncategorized');
    expect(rowCategoryColor(orphan)).toBe(CATEGORY_RESERVED_COLOR);
  });

  it('renders even when the default category is missing too', () => {
    // A broken invariant, repaired by the delete path rather than here. What matters is
    // that the row does not render blank or crash while it is broken.
    const orphan = item({
      categoryName: null,
      categoryColor: null,
      fallbackName: null,
      fallbackColor: null,
    });

    expect(rowCategoryName(orphan)).toBe(UNCATEGORIZED_NAME);
    expect(rowCategoryColor(orphan)).toBe(CATEGORY_RESERVED_COLOR);
  });
});

describe('expenseRowLabel', () => {
  it('composes the parts in the order the spec lists them', () => {
    // §Accessibility rule 1's own example.
    const label = expenseRowLabel(item({ note: 'Milk and eggs', pending: true }), TODAY, 'en-US');

    expect(label).toBe('Groceries, $12.50, Milk and eggs, Today, not synced yet');
  });

  it('omits the note when there is none', () => {
    expect(expenseRowLabel(item({ note: null }), TODAY, 'en-US')).toBe('Groceries, $12.50, Today');
  });

  it('omits a note that is only whitespace', () => {
    // `normaliseNote` stores `null` rather than `''`, so this should be unreachable from
    // the form - but a row arriving by sync from another client is not bound by that, and
    // a label with an empty part reads as a stumble.
    expect(expenseRowLabel(item({ note: '   ' }), TODAY, 'en-US')).toBe('Groceries, $12.50, Today');
  });

  it('says nothing about sync on a settled row', () => {
    expect(expenseRowLabel(item({ pending: false }), TODAY, 'en-US')).not.toContain(
      'not synced yet',
    );
  });

  it('reads the amount as money and never as minor units', () => {
    // `00-foundations.md` §8 rule 3. A raw `amountMinor` would be read as "one thousand
    // two hundred fifty", which is a different number from the one on screen.
    const label = expenseRowLabel(item({ amountMinor: 128450 }), TODAY, 'en-US');

    expect(label).toContain('$1,284.50');
    expect(label).not.toContain('128450');
  });

  it('includes the date even though the section header says it too', () => {
    // Deliberate redundancy: "section headers are easy to miss when swiping element to
    // element, and a row read without its date is ambiguous."
    expect(expenseRowLabel(item({ date: '2026-10-06' }), TODAY, UK)).toContain('Tue 6 Oct');
  });
});
