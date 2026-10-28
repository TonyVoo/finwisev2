import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { COPY, EMPTY_COPY, SNACK_COPY } from '@/copy/strings';
import { MONTH_NEXT_TEST_ID, MONTH_PREVIOUS_TEST_ID } from '@/month/MonthSwitcher';
import { MONTH_TOTAL_TEST_ID } from '@/expenses/MonthTotal';
import { FIRST_RUN_EMPTY_TEST_ID, MONTH_EMPTY_TEST_ID } from '@/expenses/ListStates';
import {
  clearCategoryReviewPending,
  markCategoryReviewPending,
  readCategoryReviewPending,
} from '@/db/onboarding';
import { META_KEYS, writeMeta } from '@/db/meta';
import { writeUser } from '@/db/user';
import { writeLastSyncedAt } from '@/sync/cursor';
import type { SqliteDatabase } from '@/db/sqlite';
import ExpenseListScreen from '../../app/(app)/(tabs)/index';
import { resetRouter, routerRecord } from '../support/router';
import { recordRejection } from '@/sync/rejections';
import { mountScreen, type MountedScreen } from '../support/mount';
import {
  categoryId,
  entryAt,
  expenseId,
  outboxEntries,
  seedCategory,
  seedExpense,
  seedFallbackCategory,
  storedExpense,
} from '../support/seed';

jest.mock('expo-router');

/**
 * Home: `docs/design/04-expense-list.md`.
 *
 * Driven over a real container - a real SQLite engine with the real migrations, the real
 * queries, the real write helper and the real query cache. The only thing faked is the
 * router, and the transport is a stand-in that **fails the test if it is called**: this
 * screen is specified to read and write local SQLite and nothing else, so a request
 * escaping it is the offline promise being broken, and that is worth a failure rather than
 * a silent pass (`tests/support/mount.tsx`, `NO_NETWORK_EXPECTED`).
 *
 * That transport is also what makes these cases evidence for "works end to end in airplane
 * mode". There is no network available to this screen at all, and every case below -
 * listing, totalling, deleting, undoing, month switching - passes anyway.
 */

/** 14 October 2026. Local components, so the suite's timezone cannot move the day. */
const NOW = new Date(2026, 9, 14, 9, 0, 0);

const GROCERIES = categoryId(1);
const TRANSPORT = categoryId(2);

/** A user row, because every amount on this screen is formatted in their currency. */
async function seedUser(database: SqliteDatabase, currency = 'USD'): Promise<void> {
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency,
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  // An account that has synced before: an empty store is then a true empty, not "not loaded
  // yet" (`useAwaitingFirstSync`).
  await writeLastSyncedAt(database, '2026-10-16T08:00:00.000Z');
}

/** A month with four expenses across three days, as the spec's own layout draws it. */
async function seedOctober(database: SqliteDatabase): Promise<void> {
  await seedUser(database);
  await seedFallbackCategory(database);
  await seedCategory(database, { id: GROCERIES, name: 'Groceries', color: '#22C55E' });
  await seedCategory(database, { id: TRANSPORT, name: 'Transport', color: '#3B82F6' });

  await seedExpense(database, {
    id: expenseId(1),
    categoryId: GROCERIES,
    amountMinor: 1250,
    date: '2026-10-14',
    note: 'Milk, eggs',
  });
  await seedExpense(database, {
    id: expenseId(2),
    categoryId: TRANSPORT,
    amountMinor: 320,
    date: '2026-10-14',
  });
  await seedExpense(database, {
    id: expenseId(3),
    categoryId: GROCERIES,
    amountMinor: 2400,
    date: '2026-10-13',
    note: 'Dinner with Sam',
  });
  await seedExpense(database, {
    id: expenseId(4),
    categoryId: TRANSPORT,
    amountMinor: 8900,
    date: '2026-10-04',
  });
}

async function mountHome(
  seed?: (database: SqliteDatabase) => Promise<void>,
): Promise<MountedScreen> {
  const mounted = await mountScreen(<ExpenseListScreen />, { clock: () => NOW, seed });
  // The first SQLite reads resolve a tick after mount; every case asserts on settled state.
  await waitFor(() => expect(screen.queryByTestId(MONTH_TOTAL_TEST_ID)).not.toBeNull());
  return mounted;
}

function totalLabel(): string {
  return screen.getByTestId(MONTH_TOTAL_TEST_ID).props.accessibilityLabel as string;
}

/**
 * The pending clock glyph, which is `accessibilityElementsHidden` on purpose - the row's
 * own composed label says `, not synced yet` in words, so the glyph must not be announced
 * a second time. Queries therefore have to opt into hidden elements, as
 * `tests/components/Row.test.tsx` does for the chevron and the swatch.
 */
function pendingGlyphs(): unknown[] {
  return screen.queryAllByTestId('pending-glyph', { includeHiddenElements: true });
}

/**
 * A button, by its accessible name.
 *
 * `Button` hides its own label `Text` from the accessibility tree and carries the name on
 * the `Pressable`, so `getByText` cannot see it - the name is the thing to assert on
 * anyway, since that is what a screen reader reads.
 */
function button(name: string) {
  return screen.getByRole('button', { name });
}

beforeEach(() => {
  resetRouter();
});

describe('the expense list', () => {
  it('renders the month grouped by day, newest day first', async () => {
    await mountHome(seedOctober);

    // Rule 2: `Today` and `Yesterday` against the device's local calendar day, every other
    // day as a dated header.
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Yesterday')).toBeTruthy();
    expect(screen.getByText(/4 Oct|Oct 4/)).toBeTruthy();
  });

  it('shows each expense with its category, amount and note', async () => {
    await mountHome(seedOctober);

    expect(screen.getByText('Milk, eggs')).toBeTruthy();
    expect(screen.getByText('$12.50')).toBeTruthy();
    expect(screen.getByText('$3.20')).toBeTruthy();
    expect(screen.getByText('Dinner with Sam')).toBeTruthy();
    expect(screen.getByText('$89.00')).toBeTruthy();
  });

  it('renders no second line for an expense with no note', async () => {
    // `''` and `null` would render differently - an empty subtitle line versus no line -
    // so only one of them must be reachable (`06-expense-form.md` rule 10).
    await mountHome(seedOctober);

    const row = screen.getByTestId(`expense-row-${expenseId(2)}`);

    expect(row.props.accessibilityLabel).toBe('Transport, $3.20, Today');
  });

  it('is one accessibility element per expense, with a composed label', async () => {
    // §Accessibility rule 1: a screen-reader user swipes once per expense rather than
    // four times, past a swatch, a name, a note and an amount.
    await mountHome(seedOctober);

    const row = screen.getByTestId(`expense-row-${expenseId(1)}`);

    expect(row.props.accessible).toBe(true);
    expect(row.props.accessibilityLabel).toBe('Groceries, $12.50, Milk, eggs, Today');
    expect(row.props.accessibilityHint).toBe('Double tap to edit this expense.');
  });

  describe('the month total', () => {
    it('sums the month in SQLite, including every day on the page', async () => {
      // 1250 + 320 + 2400 + 8900 = 12870. Rule 3: computed with `SUM(amountMinor)` over
      // the month, never by reducing over the rendered page.
      await mountHome(seedOctober);

      expect(screen.getByText('$128.70')).toBeTruthy();
    });

    it('is one element, labelled as money', async () => {
      // §Accessibility rule 5, and `00-foundations.md` §8 rule 3: the label is the
      // formatted string, so a screen reader never reaches the raw `amountMinor`.
      await mountHome(seedOctober);

      expect(totalLabel()).toBe('Total this month, $128.70');
      expect(totalLabel()).not.toContain('12870');
    });

    it('announces its own change without stealing focus', async () => {
      await mountHome(seedOctober);

      expect(screen.getByTestId(MONTH_TOTAL_TEST_ID).props.accessibilityLiveRegion).toBe('polite');
    });

    it('says "Total this month" only for the current month', async () => {
      await mountHome(seedOctober);

      await userEvent.press(screen.getByTestId(MONTH_PREVIOUS_TEST_ID));

      // A month in the past labelled "this month" would be a lie about which number the
      // user is reading.
      await waitFor(() => expect(totalLabel()).toBe('Total, $0.00'));
      expect(screen.queryByText(COPY.home.total.current)).toBeNull();
    });

    it('renders a zero month as the formatted zero, not a blank', async () => {
      // Rule 5, and state `empty` - first run: "hiding it would make the number appear to
      // pop into existence later."
      await mountHome(async (database) => {
        await seedUser(database);
        await seedFallbackCategory(database);
      });

      expect(screen.getByText('$0.00')).toBeTruthy();
      expect(totalLabel()).toBe('Total this month, $0.00');
    });

    it('formats in the user’s currency, not a hardcoded dollar', async () => {
      await mountHome(async (database) => {
        await seedUser(database, 'JPY');
        await seedFallbackCategory(database);
        await seedCategory(database, { id: GROCERIES, name: 'Groceries' });
        await seedExpense(database, {
          id: expenseId(1),
          categoryId: GROCERIES,
          amountMinor: 1200,
          currency: 'JPY',
          date: '2026-10-14',
        });
      });

      // JPY has no minor unit, so 1200 minor units is ¥1,200 - not ¥12.00.
      expect(totalLabel()).toBe('Total this month, ¥1,200');
    });
  });

  describe('soft deletes are excluded', () => {
    it('leaves a tombstoned expense out of the list and out of the total', async () => {
      // Rule 8 and `docs/PLAN.md` §Deletes. The row survives in the table so sync can
      // carry the delete; the user sees exactly what a hard delete would have shown them.
      await mountHome(async (database) => {
        await seedUser(database);
        await seedFallbackCategory(database);
        await seedCategory(database, { id: GROCERIES, name: 'Groceries' });
        await seedExpense(database, {
          id: expenseId(1),
          categoryId: GROCERIES,
          amountMinor: 1250,
          date: '2026-10-14',
        });
        await seedExpense(database, {
          id: expenseId(2),
          categoryId: GROCERIES,
          amountMinor: 9900,
          date: '2026-10-14',
          deletedAt: '2026-10-14T08:00:00.000Z',
        });
      });

      expect(screen.queryByTestId(`expense-row-${expenseId(2)}`)).toBeNull();
      expect(screen.getByTestId(`expense-row-${expenseId(1)}`)).toBeTruthy();
      // 9900 is absent from the sum, not merely hidden from the rows.
      expect(totalLabel()).toBe('Total this month, $12.50');
    });
  });

  describe('the pending glyph', () => {
    it('marks a row with an undrained outbox entry, and not a settled one', async () => {
      // `02-offline-and-sync.md` §2: the outbox is the source of truth for `pending`.
      // The seeded rows carry no outbox entry; the delete below creates one.
      await mountHome(seedOctober);
      expect(pendingGlyphs()).toHaveLength(0);

      // Deleting row 1 queues a mutation for it, so row 3 becomes pending-free evidence
      // while a *restored* row 1 carries the glyph.
      await act(async () => {
        screen.getByTestId(`expense-row-${expenseId(1)}`).props.onAccessibilityAction({
          nativeEvent: { actionName: 'delete' },
        });
      });
      await userEvent.press(screen.getByText(COPY.common.undo));

      await waitFor(() => expect(pendingGlyphs()).toHaveLength(1));
      const row = screen.getByTestId(`expense-row-${expenseId(1)}`);
      expect(row.props.accessibilityLabel).toContain('not synced yet');
    });
  });

  describe('a row the server refused', () => {
    /**
     * `02-offline-and-sync.md` §5.1. The contrast with the case above is the whole point:
     * a queued change is warning-coloured because nothing is wrong, and a refused one is
     * red because the user has to do something. The pill does *not* enter its error state
     * for this - a per-record rejection is a per-record problem.
     */
    it('replaces its subtitle with what to do, and says so in its label', async () => {
      await mountHome(async (database) => {
        await seedOctober(database);
        await recordRejection(database, {
          entity: 'expense',
          recordId: expenseId(1),
          code: 'unknown_category',
          message: 'unknown category',
          rejectedAt: '2026-10-16T09:00:00.000Z',
        });
      });

      expect(screen.getByTestId(`expense-needs-attention-${expenseId(1)}`)).toHaveTextContent(
        "Couldn't sync — tap to fix",
      );
      // The note it replaced is gone: the row has one subtitle line and this is the
      // urgent half.
      expect(screen.queryByText('Milk, eggs')).toBeNull();

      const row = screen.getByTestId(`expense-row-${expenseId(1)}`);
      expect(row.props.accessibilityLabel).toContain('could not sync');
      // Still tappable, and still the way in to fix it - §5.1 opens Edit from here.
      // Hidden from the accessibility tree for the same reason the clock is: the label
      // above already says it in words.
      expect(
        screen.getByTestId('needs-attention-glyph', { includeHiddenElements: true }),
      ).toBeTruthy();
      expect(pendingGlyphs()).toHaveLength(0);
    });
  });

  describe('deleting an expense', () => {
    it('soft-deletes it, removes it from the list, and queues one mutation', async () => {
      const { database } = await mountHome(seedOctober);

      await act(async () => {
        screen.getByTestId(`expense-row-${expenseId(1)}`).props.onAccessibilityAction({
          nativeEvent: { actionName: 'delete' },
        });
      });

      // Gone from the list...
      await waitFor(() => expect(screen.queryByTestId(`expense-row-${expenseId(1)}`)).toBeNull());
      // ...but a tombstone in the table, not an absence. A hard local delete cannot be
      // synced as a delete, so this is a correctness requirement.
      const stored = await storedExpense(database, expenseId(1));
      expect(stored?.deletedAt).not.toBeNull();
      expect(stored?.amountMinor).toBe(1250);

      // And exactly one outbox entry, carrying the tombstone. A row written without its
      // outbox entry is a change that never syncs.
      const queued = await outboxEntries(database);
      expect(queued).toHaveLength(1);
      expect(entryAt(queued, 0).entity).toBe('expense');
      expect(entryAt(queued, 0).recordId).toBe(expenseId(1));
      expect(JSON.parse(entryAt(queued, 0).fields)).toEqual({ deletedAt: expect.any(String) });
    });

    it('recalculates the total in the same pass', async () => {
      // Rule 4: "adding, editing or deleting never leaves the total briefly stale."
      await mountHome(seedOctober);
      expect(totalLabel()).toBe('Total this month, $128.70');

      await act(async () => {
        screen.getByTestId(`expense-row-${expenseId(4)}`).props.onAccessibilityAction({
          nativeEvent: { actionName: 'delete' },
        });
      });

      // 12870 - 8900 = 3970.
      await waitFor(() => expect(totalLabel()).toBe('Total this month, $39.70'));
    });

    it('offers Undo rather than a confirmation dialog', async () => {
      // Rule 7: "There is no confirmation dialog - the Undo snackbar is the confirmation."
      await mountHome(seedOctober);

      await act(async () => {
        screen.getByTestId(`expense-row-${expenseId(1)}`).props.onAccessibilityAction({
          nativeEvent: { actionName: 'delete' },
        });
      });

      expect(screen.getByText(SNACK_COPY.expense.deleted)).toBeTruthy();
      expect(screen.getByText(COPY.common.undo)).toBeTruthy();
    });

    it('restores the row on Undo, as a second mutation', async () => {
      // Rule 9: undeleting is a normal update in this protocol, so Undo stays available
      // even after the delete has synced - there is no race to lose.
      const { database } = await mountHome(seedOctober);
      await act(async () => {
        screen.getByTestId(`expense-row-${expenseId(1)}`).props.onAccessibilityAction({
          nativeEvent: { actionName: 'delete' },
        });
      });

      await userEvent.press(screen.getByText(COPY.common.undo));

      await waitFor(() =>
        expect(screen.queryByTestId(`expense-row-${expenseId(1)}`)).not.toBeNull(),
      );
      expect((await storedExpense(database, expenseId(1)))?.deletedAt).toBeNull();
      // Two entries, not one amended: the delete may already have been pushed.
      const queued = await outboxEntries(database);
      expect(queued).toHaveLength(2);
      expect(JSON.parse(entryAt(queued, 1).fields)).toEqual({ deletedAt: null });
      await waitFor(() => expect(totalLabel()).toBe('Total this month, $128.70'));
    });

    it('is reachable without the swipe gesture', async () => {
      // §Accessibility rule 3: the gesture is invisible to a screen reader and "must not
      // be the only path to delete", so the row exposes a `delete` accessibility action.
      await mountHome(seedOctober);

      const row = screen.getByTestId(`expense-row-${expenseId(1)}`);

      expect(row.props.accessibilityActions).toEqual([{ name: 'delete', label: 'Delete expense' }]);
    });

    it('lets the second delete stand when a snackbar is already up', async () => {
      // Rule 9: "Deleting a second expense while a snackbar is showing replaces it, and
      // the first delete stands. Undo only ever applies to the most recent delete."
      const { database } = await mountHome(seedOctober);

      await act(async () => {
        screen.getByTestId(`expense-row-${expenseId(1)}`).props.onAccessibilityAction({
          nativeEvent: { actionName: 'delete' },
        });
      });
      await act(async () => {
        screen.getByTestId(`expense-row-${expenseId(3)}`).props.onAccessibilityAction({
          nativeEvent: { actionName: 'delete' },
        });
      });

      // One snackbar, and its Undo belongs to the second delete.
      expect(screen.getAllByText(SNACK_COPY.expense.deleted)).toHaveLength(1);
      await userEvent.press(screen.getByText(COPY.common.undo));

      await waitFor(async () => {
        expect((await storedExpense(database, expenseId(3)))?.deletedAt).toBeNull();
      });
      // The first delete stands.
      expect((await storedExpense(database, expenseId(1)))?.deletedAt).not.toBeNull();
    });
  });

  describe('the empty states', () => {
    it('teaches a first-run user what the app is for', async () => {
      await mountHome(async (database) => {
        await seedUser(database);
        await seedFallbackCategory(database);
      });

      expect(screen.getByTestId(FIRST_RUN_EMPTY_TEST_ID)).toBeTruthy();
      expect(screen.getByText(EMPTY_COPY.home.firstRun.headline)).toBeTruthy();
      expect(screen.getByText(EMPTY_COPY.home.firstRun.body)).toBeTruthy();
      expect(button(EMPTY_COPY.home.firstRun.action)).toBeTruthy();
    });

    it('offers navigation, not a tutorial, in an empty month', async () => {
      // The distinction the spec insists on: "a user who has used the app does not need to
      // be taught what the app is for, and the useful action is navigation, not creation."
      await mountHome(seedOctober);

      await userEvent.press(screen.getByTestId(MONTH_PREVIOUS_TEST_ID));

      await waitFor(() => expect(screen.queryByTestId(MONTH_EMPTY_TEST_ID)).not.toBeNull());
      expect(screen.getByText('Nothing in September 2026')).toBeTruthy();
      expect(screen.getByText(EMPTY_COPY.home.month.body)).toBeTruthy();
      // No illustration and no primary button.
      expect(screen.queryByTestId(FIRST_RUN_EMPTY_TEST_ID)).toBeNull();
      expect(screen.queryByRole('button', { name: EMPTY_COPY.home.firstRun.action })).toBeNull();
    });

    it('offers a jump back to the current month, and takes it', async () => {
      await mountHome(seedOctober);
      await userEvent.press(screen.getByTestId(MONTH_PREVIOUS_TEST_ID));
      await waitFor(() => expect(screen.queryByTestId(MONTH_EMPTY_TEST_ID)).not.toBeNull());

      await userEvent.press(button('Go to October 2026'));

      await waitFor(() => expect(screen.queryByText('Milk, eggs')).not.toBeNull());
      expect(totalLabel()).toBe('Total this month, $128.70');
    });

    it('hides the jump when the current month is already selected', async () => {
      // Rule: omitted, not disabled - "a no-op button is worse than no button."
      await mountHome(async (database) => {
        await seedUser(database);
        await seedFallbackCategory(database);
        await seedCategory(database, { id: GROCERIES, name: 'Groceries' });
        // An expense in another month, so this is the month-empty state and not first run.
        await seedExpense(database, {
          id: expenseId(1),
          categoryId: GROCERIES,
          amountMinor: 500,
          date: '2026-08-02',
        });
      });

      expect(screen.getByTestId(MONTH_EMPTY_TEST_ID)).toBeTruthy();
      expect(screen.getByText('Nothing in October 2026')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Go to October 2026' })).toBeNull();
    });
  });

  describe('month switching', () => {
    it('re-queries the list for the month it moved to', async () => {
      await mountHome(async (database) => {
        await seedUser(database);
        await seedFallbackCategory(database);
        await seedCategory(database, { id: GROCERIES, name: 'Groceries' });
        await seedExpense(database, {
          id: expenseId(1),
          categoryId: GROCERIES,
          amountMinor: 1000,
          date: '2026-10-02',
          note: 'October',
        });
        await seedExpense(database, {
          id: expenseId(2),
          categoryId: GROCERIES,
          amountMinor: 2000,
          date: '2026-09-28',
          note: 'September',
        });
      });
      expect(screen.getByText('October')).toBeTruthy();

      await userEvent.press(screen.getByTestId(MONTH_PREVIOUS_TEST_ID));

      await waitFor(() => expect(screen.queryByText('September')).not.toBeNull());
      expect(screen.queryByText('October')).toBeNull();
      expect(totalLabel()).toBe('Total, $20.00');
    });

    it('will not walk into the future', async () => {
      await mountHome(seedOctober);

      await userEvent.press(screen.getByTestId(MONTH_NEXT_TEST_ID));

      expect(screen.getByText(SNACK_COPY.month.current)).toBeTruthy();
      expect(totalLabel()).toBe('Total this month, $128.70');
    });

    it('bounds a month by string comparison, so no expense changes month', async () => {
      // `05-month-switcher.md` rule 11. The first and last days of the month are the rows
      // that move if the bounds are computed through a `Date` in a non-UTC zone.
      await mountHome(async (database) => {
        await seedUser(database);
        await seedFallbackCategory(database);
        await seedCategory(database, { id: GROCERIES, name: 'Groceries' });
        await seedExpense(database, {
          id: expenseId(1),
          categoryId: GROCERIES,
          amountMinor: 100,
          date: '2026-10-01',
          note: 'first day',
        });
        await seedExpense(database, {
          id: expenseId(2),
          categoryId: GROCERIES,
          amountMinor: 200,
          date: '2026-10-31',
          note: 'last day',
        });
        await seedExpense(database, {
          id: expenseId(3),
          categoryId: GROCERIES,
          amountMinor: 400,
          date: '2026-09-30',
          note: 'previous month',
        });
      });

      expect(screen.getByText('first day')).toBeTruthy();
      expect(screen.getByText('last day')).toBeTruthy();
      expect(screen.queryByText('previous month')).toBeNull();
      // Both bounds inclusive: 100 + 200.
      expect(totalLabel()).toBe('Total this month, $3.00');
    });
  });

  describe('where the screen goes', () => {
    it('opens the form in edit mode when a row is tapped', async () => {
      // Rule 6: the whole row is the target.
      await mountHome(seedOctober);

      await userEvent.press(screen.getByTestId(`expense-row-${expenseId(1)}`));

      expect(routerRecord.push).toEqual([`/(app)/expense/${expenseId(1)}`]);
    });

    it('opens Add from the FAB', async () => {
      await mountHome(seedOctober);

      await userEvent.press(screen.getByTestId('home-fab'));

      expect(routerRecord.push).toEqual(['/(app)/expense/new']);
    });

    it('opens Add from the first-run button', async () => {
      await mountHome(async (database) => {
        await seedUser(database);
        await seedFallbackCategory(database);
      });

      await userEvent.press(screen.getByTestId('empty-add-first'));

      expect(routerRecord.push).toEqual(['/(app)/expense/new']);
    });

    it('has no Settings button in the app bar: Settings is a tab of its own', async () => {
      await mountHome(seedOctober);

      expect(screen.queryByTestId('home-settings')).toBeNull();
      expect(screen.queryByLabelText(COPY.settings.title)).toBeNull();
    });

    it('opens the month picker from the centre label', async () => {
      await mountHome(seedOctober);

      await userEvent.press(screen.getByText('October 2026'));

      expect(routerRecord.push).toEqual(['/(app)/month-picker']);
    });
  });

  it('never reaches the network', async () => {
    // The mounted transport throws if called, so this would already have failed above.
    // Asserted explicitly because it is the acceptance criterion rather than a detail:
    // the whole screen works with the device in airplane mode.
    const { requests } = await mountHome(seedOctober);

    await act(async () => {
      screen.getByTestId(`expense-row-${expenseId(1)}`).props.onAccessibilityAction({
        nativeEvent: { actionName: 'delete' },
      });
    });
    await userEvent.press(screen.getByText(COPY.common.undo));

    expect(requests).toEqual([]);
  });
});

describe('who added each expense, in a shared household', () => {
  const SAM = '0192f5a0-0000-7000-8000-00000000b001';
  const ADA = '0192f5a0-0000-7000-8000-00000000a001';

  async function seedShared(database: SqliteDatabase, members: boolean): Promise<void> {
    await seedOctober(database);
    await database.runAsync('UPDATE expenses SET createdBy = ? WHERE id = ?', [SAM, expenseId(1)]);
    await database.runAsync('UPDATE expenses SET createdBy = ? WHERE id = ?', [ADA, expenseId(2)]);
    if (members) {
      await writeMeta(
        database,
        META_KEYS.householdMembers,
        JSON.stringify([
          { userId: ADA, email: 'ada@example.com' },
          { userId: SAM, email: 'sam@example.com' },
        ]),
      );
    }
  }

  it('says who added a row, by name, and "you" for your own', async () => {
    await mountHome((database) => seedShared(database, true));

    await waitFor(() => expect(screen.queryByText(/Added by Sam/)).not.toBeNull());
    expect(screen.getByText(/Added by you/)).toBeTruthy();
  });

  it('is part of what a screen reader hears for the row', async () => {
    await mountHome((database) => seedShared(database, true));

    await waitFor(() =>
      expect(screen.getByTestId(`expense-row-${expenseId(1)}`).props.accessibilityLabel).toContain(
        'Added by Sam',
      ),
    );
  });

  it('shows nothing extra for an account that is not in a household', async () => {
    await mountHome((database) => seedShared(database, false));

    await waitFor(() => expect(screen.queryByText('Milk, eggs')).not.toBeNull());
    expect(screen.queryByText(/Added by/)).toBeNull();
  });
});

describe('the one-time category review prompt', () => {
  beforeEach(() => {
    resetRouter();
  });

  it('is absent unless a signup asked for it', async () => {
    await mountHome(seedOctober);
    expect(screen.queryByTestId('category-review')).toBeNull();
  });

  it('shows after a signup, and Review opens the category editor and is then gone for good', async () => {
    const mounted = await mountHome(async (database) => {
      await seedOctober(database);
      await markCategoryReviewPending(database);
    });
    expect(await screen.findByTestId('category-review')).toBeTruthy();

    await userEvent.press(screen.getByTestId('category-review-open'));

    await waitFor(() => expect(screen.queryByTestId('category-review')).toBeNull());
    expect(routerRecord.push).toContain('/(app)/settings/categories');
    expect(await readCategoryReviewPending(mounted.database)).toBe(false);
  });

  it('Not now dismisses it for good without navigating anywhere', async () => {
    const mounted = await mountHome(async (database) => {
      await seedOctober(database);
      await markCategoryReviewPending(database);
    });
    await userEvent.press(await screen.findByTestId('category-review-dismiss'));

    await waitFor(() => expect(screen.queryByTestId('category-review')).toBeNull());
    expect(routerRecord.push).toEqual([]);
    expect(await readCategoryReviewPending(mounted.database)).toBe(false);
  });

  it('does not nag on a later visit once answered', async () => {
    await mountHome(async (database) => {
      await seedOctober(database);
      await markCategoryReviewPending(database);
      await clearCategoryReviewPending(database);
    });
    expect(screen.queryByTestId('category-review')).toBeNull();
  });
});
