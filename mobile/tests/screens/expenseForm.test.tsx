import { LIMITS } from '@expense-tracker/shared';
import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { CONFIRM_COPY, COPY, SNACK_COPY, VALIDATION_COPY } from '@/copy/strings';
import { spokenDate } from '@/lib/calendar';
import { writeUser } from '@/db/user';
import type { SqliteDatabase } from '@/db/sqlite';
import { AMOUNT_DISPLAY_TEST_ID, AMOUNT_MESSAGE_TEST_ID } from '@/expenses/AmountDisplay';
import {
  CATEGORY_ROW_TEST_ID,
  CLOSE_TEST_ID,
  DATE_ROW_TEST_ID,
  DELETE_TEST_ID,
  NOTE_ROW_TEST_ID,
  NOT_FOUND_TEST_ID,
  SAVE_TEST_ID,
} from '@/expenses/ExpenseFormScreen';
import { KEYPAD_BACKSPACE_TEST_ID, KEYPAD_DECIMAL_TEST_ID } from '@/expenses/Keypad';
import { DATE_CHOOSE_TEST_ID, DATE_YESTERDAY_TEST_ID } from '@/expenses/DateSheet';
import { NOTE_INPUT_TEST_ID } from '@/expenses/NoteSheet';
import NewExpenseScreen from '../../app/(app)/expense/new';
import EditExpenseScreen from '../../app/(app)/expense/[id]';
import { resetRouter, routerRecord, setSearchParams } from '../support/router';
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
 * Add / Edit expense: `docs/design/06-expense-form.md`.
 *
 * Driven over a real container - real SQLite, real migrations, the real write helper. The
 * transport fails the test if it is called, so every case here is also evidence that the
 * form works with the device in airplane mode.
 *
 * The cases are weighted towards the two things the spec is most emphatic about: that
 * **no float arithmetic exists anywhere between the keypad and the database**, and that
 * **every write lands with its outbox entry in one transaction**. Both are invisible on
 * screen when they are wrong.
 */

const NOW = new Date(2026, 9, 14, 9, 0, 0);
const GROCERIES = categoryId(1);
const TRANSPORT = categoryId(2);
const FALLBACK = categoryId(99);

async function seedBasics(database: SqliteDatabase, currency = 'USD'): Promise<void> {
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency,
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  await seedFallbackCategory(database);
  await seedCategory(database, { id: GROCERIES, name: 'Groceries', color: '#2F8044' });
  await seedCategory(database, { id: TRANSPORT, name: 'Transport', color: '#2F6FD0' });
}

async function mountAdd(
  seed: (database: SqliteDatabase) => Promise<void> = seedBasics,
): Promise<MountedScreen> {
  const mounted = await mountScreen(<NewExpenseScreen />, { clock: () => NOW, seed });
  await waitFor(() => expect(screen.queryByTestId(AMOUNT_DISPLAY_TEST_ID)).not.toBeNull());
  return mounted;
}

async function mountEdit(
  id: string,
  seed: (database: SqliteDatabase) => Promise<void>,
): Promise<MountedScreen> {
  setSearchParams({ id });
  return await mountScreen(<EditExpenseScreen />, { clock: () => NOW, seed });
}

/**
 * The screen's title, which `AppBar` renders as a `header` rather than giving it a label.
 */
function title(name: string) {
  return screen.getByRole('header', { name });
}

/** The amount as the user sees it, which is also what a screen reader announces. */
function displayed(): string {
  return screen.getByTestId(AMOUNT_DISPLAY_TEST_ID).props.children as string;
}

function message(): string {
  return screen.getByTestId(AMOUNT_MESSAGE_TEST_ID).props.children as string;
}

/** Press keypad digits in order, as a thumb would. */
async function typeAmount(keys: string): Promise<void> {
  for (const key of keys) {
    await userEvent.press(screen.getByTestId(`keypad-${key}`));
  }
}

beforeEach(() => {
  resetRouter();
});

describe('the expense form', () => {
  describe('add mode, as it opens', () => {
    it('renders complete on the first frame, with no spinner', async () => {
      // State `loading:first-paint`, add mode: "none - there is nothing to load".
      await mountAdd();

      expect(title(COPY.form.title.add)).toBeTruthy();
      expect(screen.queryByTestId('form-skeleton')).toBeNull();
      expect(displayed()).toBe('$0.00');
    });

    it('offers Save disabled, with the reason stated', async () => {
      // Rule 6: a disabled button must state its reason, and the reason sits on the
      // amount's reserved line, which is part of the reading order.
      await mountAdd();

      expect(screen.getByTestId(SAVE_TEST_ID).props.accessibilityState).toEqual({
        disabled: true,
      });
      expect(message()).toBe(VALIDATION_COPY.amount.zero);
    });

    it('prefills the date as today', async () => {
      await mountAdd();

      // The spec's structure - relative word *and* absolute date (element 7) - with the
      // absolute half composed by the same helper the screen uses. `spokenDate` follows
      // the device locale, and `tests/lib/calendar.test.ts` is where its format is pinned;
      // hardcoding `14 October 2026` here would make this case fail under `en-US`.
      expect(screen.getByTestId(DATE_ROW_TEST_ID).props.accessibilityLabel).toBe(
        `Date, Today, ${spokenDate('2026-10-14')}`,
      );
    });

    it('prefills the last-used category', async () => {
      // Rule 1: "the `categoryId` of the most recently created expense, read from SQLite,
      // not a separate persisted preference - so it is correct after a sync".
      await mountAdd(async (database) => {
        await seedBasics(database);
        await seedExpense(database, {
          id: expenseId(1),
          categoryId: TRANSPORT,
          amountMinor: 500,
          date: '2026-10-10',
        });
      });

      expect(screen.getByTestId(CATEGORY_ROW_TEST_ID).props.accessibilityLabel).toBe(
        'Category, Transport',
      );
    });

    it('falls back to the default category on the very first expense', async () => {
      await mountAdd();

      expect(screen.getByTestId(CATEGORY_ROW_TEST_ID).props.accessibilityLabel).toBe(
        'Category, Uncategorized',
      );
    });

    it('falls back to the default when the last-used category was deleted', async () => {
      // The join in `lastUsedCategoryId` is what implements this: a deleted category is
      // not a live row, so the expense under it is skipped rather than answered with an
      // id the picker cannot show.
      await mountAdd(async (database) => {
        await seedBasics(database);
        await database.runAsync('UPDATE categories SET deletedAt = ? WHERE id = ?', [
          '2026-10-12T00:00:00.000Z',
          TRANSPORT,
        ]);
        await seedExpense(database, {
          id: expenseId(1),
          categoryId: TRANSPORT,
          amountMinor: 500,
          date: '2026-10-10',
        });
      });

      expect(screen.getByTestId(CATEGORY_ROW_TEST_ID).props.accessibilityLabel).toBe(
        'Category, Uncategorized',
      );
    });
  });

  describe('the amount, which is an integer throughout', () => {
    it('shifts digits in from the right like a cash register', async () => {
      // Rule 2's own table, pressed key by key. This is the behaviour that makes a
      // malformed amount unrepresentable rather than validated.
      await mountAdd();

      await typeAmount('1');
      expect(displayed()).toBe('$0.01');
      await typeAmount('2');
      expect(displayed()).toBe('$0.12');
      await typeAmount('5');
      expect(displayed()).toBe('$1.25');
      await typeAmount('0');
      expect(displayed()).toBe('$12.50');
    });

    it('takes digits off the right again', async () => {
      await mountAdd();
      await typeAmount('1250');

      await userEvent.press(screen.getByTestId(KEYPAD_BACKSPACE_TEST_ID));
      expect(displayed()).toBe('$1.25');

      for (let index = 0; index < 3; index += 1) {
        await userEvent.press(screen.getByTestId(KEYPAD_BACKSPACE_TEST_ID));
      }
      expect(displayed()).toBe('$0.00');
    });

    it('announces the running amount, not the digit pressed', async () => {
      // §Accessibility rule 2: "a keypad that announces only the digit pressed leaves a
      // non-sighted user unable to tell what the running value is".
      await mountAdd();

      await typeAmount('125');

      const display = screen.getByTestId(AMOUNT_DISPLAY_TEST_ID);
      expect(display.props.accessibilityLabel).toBe('Amount, $1.25');
      expect(display.props.accessibilityLiveRegion).toBe('polite');
    });

    it('caps at the maximum rather than rejecting, and says so once', async () => {
      // Rule 5: "further digit presses are ignored and the display is unchanged", with a
      // snackbar. The user never ends up with a value they must manually trim back.
      await mountAdd();
      await typeAmount('999999999999');
      expect(displayed()).toBe('$9,999,999,999.99');

      await typeAmount('9');

      expect(displayed()).toBe('$9,999,999,999.99');
      expect(screen.getByText(SNACK_COPY.amount.max)).toBeTruthy();
    });

    it('cannot take two decimal points', async () => {
      // Rule 3: not by validating a second one, but by there being nothing for it to do.
      await mountAdd();

      await userEvent.press(screen.getByTestId(KEYPAD_DECIMAL_TEST_ID));
      await userEvent.press(screen.getByTestId(KEYPAD_DECIMAL_TEST_ID));
      await typeAmount('12');

      expect(displayed()).toBe('$0.12');
    });

    it('stops accepting minor digits once the currency is satisfied', async () => {
      await mountAdd();

      await typeAmount('5');
      await userEvent.press(screen.getByTestId(KEYPAD_DECIMAL_TEST_ID));
      await typeAmount('123');

      // Two decimals for USD: the third digit is ignored.
      expect(displayed()).toBe('$5.12');
    });

    it('hides the decimal key entirely for a zero-decimal currency', async () => {
      // Rule 3: hidden, not disabled. "A decimal key on a currency without a minor unit
      // is a control that can only confuse", and a disabled one would owe a reason.
      await mountAdd((database) => seedBasics(database, 'JPY'));

      expect(screen.queryByTestId(KEYPAD_DECIMAL_TEST_ID)).toBeNull();
      await typeAmount('1200');
      expect(displayed()).toBe('¥1,200');
    });

    it('never puts a separator or a symbol into the value', async () => {
      // They exist only in the formatted output (rule 2). The stored integer is what
      // proves it, and the save case below asserts that; here it is the display agreeing.
      await mountAdd();

      await typeAmount('128450');

      expect(displayed()).toBe('$1,284.50');
    });
  });

  describe('saving an expense', () => {
    it('writes the row and its outbox entry, and stores an integer', async () => {
      // Rule 13, and the acceptance criterion: one transaction containing both writes.
      // "A row written without its outbox entry is a change that never syncs."
      const { database } = await mountAdd();
      await typeAmount('1250');

      await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

      await waitFor(async () => expect(await outboxEntries(database)).toHaveLength(1));
      const rows = await database.getAllAsync<{
        amountMinor: number;
        categoryId: string;
        date: string;
        note: string | null;
        updatedAt: string;
      }>('SELECT amountMinor, categoryId, date, note, updatedAt FROM expenses', []);
      expect(rows).toHaveLength(1);
      // The integer, exactly - not 12.5, and not 1250.0000001.
      expect(rows[0]?.amountMinor).toBe(1250);
      expect(Number.isInteger(rows[0]?.amountMinor)).toBe(true);
      expect(rows[0]?.date).toBe('2026-10-14');
      expect(rows[0]?.categoryId).toBe(FALLBACK);
      // `updatedAt` is stamped, which is what last-write-wins orders on.
      expect(rows[0]?.updatedAt).not.toBeUndefined();

      const queued = await outboxEntries(database);
      expect(entryAt(queued, 0).entity).toBe('expense');
      expect(JSON.parse(entryAt(queued, 0).fields)).toEqual({
        categoryId: FALLBACK,
        kind: 'expense',
        amountMinor: 1250,
        currency: 'USD',
        date: '2026-10-14',
        note: null,
      });
    });

    it('pops back and confirms, with no spinner in between', async () => {
      // State `loading` on save: "none". A save is as fast offline as online.
      await mountAdd();
      await typeAmount('500');

      await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

      await waitFor(() => expect(routerRecord.back).toBe(1));
      expect(screen.getByText(SNACK_COPY.expense.saved)).toBeTruthy();
    });

    it('names the month when the expense lands outside the one Home is showing', async () => {
      // Rule 9: the row will not appear in the list the user returns to, and that would be
      // silently confusing, so the snackbar carries the month and offers to switch.
      await mountAdd();
      await userEvent.press(screen.getByTestId(DATE_ROW_TEST_ID));
      await userEvent.press(screen.getByTestId(DATE_CHOOSE_TEST_ID));
      await userEvent.press(screen.getByTestId('date-grid-previous'));
      await userEvent.press(screen.getByTestId('date-day-2026-09-20'));
      await typeAmount('400');

      await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

      await waitFor(() =>
        expect(screen.queryByText('Expense saved to September 2026.')).not.toBeNull(),
      );
      expect(screen.getByText(COPY.common.view)).toBeTruthy();
    });

    it('does not save a zero amount', async () => {
      const { database } = await mountAdd();

      await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

      // Zero is not a valid expense: the contract permits it, the client refuses it, and
      // that asymmetry is deliberate (rule 6).
      expect(await outboxEntries(database)).toHaveLength(0);
      expect(routerRecord.back).toBe(0);
    });
  });

  describe('editing an expense', () => {
    const seedEditable = async (database: SqliteDatabase): Promise<void> => {
      await seedBasics(database);
      await seedExpense(database, {
        id: expenseId(1),
        categoryId: GROCERIES,
        amountMinor: 1250,
        date: '2026-10-13',
        note: 'Milk',
      });
    };

    it('prefills every field from the row', async () => {
      await mountEdit(expenseId(1), seedEditable);
      await waitFor(() => expect(screen.queryByTestId(AMOUNT_DISPLAY_TEST_ID)).not.toBeNull());

      expect(title(COPY.form.title.edit)).toBeTruthy();
      expect(displayed()).toBe('$12.50');
      expect(screen.getByTestId(CATEGORY_ROW_TEST_ID).props.accessibilityLabel).toBe(
        'Category, Groceries',
      );
      expect(screen.getByTestId(DATE_ROW_TEST_ID).props.accessibilityLabel).toBe(
        `Date, Yesterday, ${spokenDate('2026-10-13')}`,
      );
      expect(screen.getByTestId(NOTE_ROW_TEST_ID).props.accessibilityLabel).toBe('Note, Milk');
    });

    it('holds Save until something actually changes', async () => {
      await mountEdit(expenseId(1), seedEditable);
      await waitFor(() => expect(screen.queryByTestId(AMOUNT_DISPLAY_TEST_ID)).not.toBeNull());

      expect(screen.getByTestId(SAVE_TEST_ID).props.accessibilityState).toEqual({
        disabled: true,
      });
      expect(message()).toBe(VALIDATION_COPY.nochange);

      await userEvent.press(screen.getByTestId(KEYPAD_BACKSPACE_TEST_ID));

      expect(screen.getByTestId(SAVE_TEST_ID).props.accessibilityState).toEqual({
        disabled: false,
      });
    });

    it('sends only the fields that changed', async () => {
      // A push is a merge, so including an unchanged field would overwrite whatever
      // another device wrote there in the meantime.
      const { database } = await mountEdit(expenseId(1), seedEditable);
      await waitFor(() => expect(screen.queryByTestId(AMOUNT_DISPLAY_TEST_ID)).not.toBeNull());

      await typeAmount('9');
      await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

      await waitFor(async () => expect(await outboxEntries(database)).toHaveLength(1));
      const queued = await outboxEntries(database);
      // Only the amount - not the category, the date or the note.
      expect(JSON.parse(entryAt(queued, 0).fields)).toEqual({ amountMinor: 12509 });
      expect((await storedExpense(database, expenseId(1)))?.amountMinor).toBe(12509);
      expect(screen.getByText(SNACK_COPY.expense.updated)).toBeTruthy();
    });

    it('changes the date from the quick options', async () => {
      const { database } = await mountEdit(expenseId(1), seedEditable);
      await waitFor(() => expect(screen.queryByTestId(AMOUNT_DISPLAY_TEST_ID)).not.toBeNull());

      await userEvent.press(screen.getByTestId(DATE_ROW_TEST_ID));
      await userEvent.press(screen.getByTestId(DATE_YESTERDAY_TEST_ID));
      // The row was already dated yesterday, so pick a different day to make a change.
      await userEvent.press(screen.getByTestId(DATE_ROW_TEST_ID));
      await userEvent.press(screen.getByTestId('date-today'));
      await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

      await waitFor(async () =>
        expect((await storedExpense(database, expenseId(1)))?.date).toBe('2026-10-14'),
      );
      const queued = await outboxEntries(database);
      expect(JSON.parse(entryAt(queued, 0).fields)).toEqual({ date: '2026-10-14' });
    });

    it('changes the category from the picker', async () => {
      const { database } = await mountEdit(expenseId(1), seedEditable);
      await waitFor(() => expect(screen.queryByTestId(AMOUNT_DISPLAY_TEST_ID)).not.toBeNull());

      await userEvent.press(screen.getByTestId(CATEGORY_ROW_TEST_ID));
      await userEvent.press(screen.getByTestId(`category-option-${TRANSPORT}`));
      await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

      await waitFor(async () =>
        expect((await storedExpense(database, expenseId(1)))?.categoryId).toBe(TRANSPORT),
      );
    });

    it('stores a note as null rather than an empty string', async () => {
      // Rule 10: `''` and `null` would render differently - an empty subtitle line versus
      // no line - so only one of them must be reachable.
      const { database } = await mountEdit(expenseId(1), seedEditable);
      await waitFor(() => expect(screen.queryByTestId(AMOUNT_DISPLAY_TEST_ID)).not.toBeNull());

      await userEvent.press(screen.getByTestId(NOTE_ROW_TEST_ID));
      await act(async () => {
        screen.getByTestId(NOTE_INPUT_TEST_ID).props.onChangeText('   ');
      });
      await userEvent.press(screen.getByTestId('note-done'));
      await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

      await waitFor(async () =>
        expect((await storedExpense(database, expenseId(1)))?.note).toBeNull(),
      );
    });

    it('deletes softly, from the button a screen reader can reach', async () => {
      // §Accessibility rule 3 of `04-expense-list.md`: the swipe is invisible to a screen
      // reader, so Delete is also here. Rule 12: no confirmation dialog, matching the
      // swipe path - "two different confirmation models for one action would be worse".
      const { database } = await mountEdit(expenseId(1), seedEditable);
      await waitFor(() => expect(screen.queryByTestId(AMOUNT_DISPLAY_TEST_ID)).not.toBeNull());

      await userEvent.press(screen.getByTestId(DELETE_TEST_ID));

      await waitFor(() => expect(routerRecord.back).toBe(1));
      const stored = await storedExpense(database, expenseId(1));
      expect(stored?.deletedAt).not.toBeNull();
      // Still there, so sync can carry the delete.
      expect(stored?.amountMinor).toBe(1250);
      expect(screen.getByText(SNACK_COPY.expense.deleted)).toBeTruthy();
      expect(screen.getByText(COPY.common.undo)).toBeTruthy();
    });

    it('offers no Delete button in add mode', async () => {
      await mountAdd();

      expect(screen.queryByTestId(DELETE_TEST_ID)).toBeNull();
    });

    it('shows Expense not found for an id that is gone', async () => {
      // State `error` (b): a deep link, or the row was deleted on another device. A
      // tombstoned row answers the same as an absent one - it is gone either way.
      await mountEdit(expenseId(1), async (database) => {
        await seedBasics(database);
        await seedExpense(database, {
          id: expenseId(1),
          categoryId: GROCERIES,
          amountMinor: 1250,
          date: '2026-10-13',
          deletedAt: '2026-10-13T10:00:00.000Z',
        });
      });

      await waitFor(() => expect(screen.queryByTestId(NOT_FOUND_TEST_ID)).not.toBeNull());
      expect(screen.getByText(COPY.form.notFound.headline)).toBeTruthy();
      expect(screen.getByText(COPY.form.notFound.body)).toBeTruthy();
    });
  });

  describe('discarding', () => {
    it('closes immediately when nothing has been edited', async () => {
      // Rule 11. A user who opens Add and backs straight out must not be asked about a
      // form they never touched.
      await mountAdd();

      await userEvent.press(screen.getByTestId(CLOSE_TEST_ID));

      expect(routerRecord.back).toBe(1);
      expect(screen.queryByText(CONFIRM_COPY.discard.title)).toBeNull();
    });

    it('asks before throwing away an edit', async () => {
      await mountAdd();
      await typeAmount('500');

      await userEvent.press(screen.getByTestId(CLOSE_TEST_ID));

      expect(screen.getByText(CONFIRM_COPY.discard.title)).toBeTruthy();
      expect(screen.getByText(CONFIRM_COPY.discard.body)).toBeTruthy();
      expect(routerRecord.back).toBe(0);
    });

    it('keeps editing when the dialog is dismissed', async () => {
      // `Keep editing`, not `Cancel`: in a dialog whose other button is `Discard`,
      // "Cancel" is ambiguous about which thing it cancels.
      await mountAdd();
      await typeAmount('500');
      await userEvent.press(screen.getByTestId(CLOSE_TEST_ID));

      await userEvent.press(screen.getByTestId('discard-dialog-cancel'));

      expect(routerRecord.back).toBe(0);
      expect(displayed()).toBe('$5.00');
    });

    it('discards when the user says so', async () => {
      const { database } = await mountAdd();
      await typeAmount('500');
      await userEvent.press(screen.getByTestId(CLOSE_TEST_ID));

      await userEvent.press(screen.getByTestId('discard-dialog-confirm'));

      expect(routerRecord.back).toBe(1);
      expect(await outboxEntries(database)).toHaveLength(0);
    });

    it('asks after a category change, even with the amount untouched', async () => {
      // The case a rule written only about the amount would miss: the user picked a
      // category, pressed back, and silently lost the choice.
      await mountAdd();

      await userEvent.press(screen.getByTestId(CATEGORY_ROW_TEST_ID));
      await userEvent.press(screen.getByTestId(`category-option-${GROCERIES}`));
      await userEvent.press(screen.getByTestId(CLOSE_TEST_ID));

      expect(screen.getByText(CONFIRM_COPY.discard.title)).toBeTruthy();
    });
  });

  describe('when no category exists at all', () => {
    it('still renders, and says what is missing', async () => {
      // Rule 4's last bullet. Reachable when the post-signup category fetch failed and no
      // sync has succeeded since; it self-repairs on the next successful sync, so the form
      // offers creation rather than an explanation.
      await mountAdd(async (database) => {
        await writeUser(database, {
          id: '0192f5a0-0000-7000-8000-00000000a001',
          email: 'ada@example.com',
          currency: 'USD',
          createdAt: '2026-10-01T00:00:00.000Z',
        });
      });

      await typeAmount('500');

      expect(message()).toBe(VALIDATION_COPY.nocategories);
      expect(screen.getByTestId(SAVE_TEST_ID).props.accessibilityState).toEqual({
        disabled: true,
      });
    });

    it('lets the user create one from the picker and selects it', async () => {
      // Rule 4: "On create, the new category is selected automatically and both sheets
      // dismiss - the user came here to pick a category, not to manage them."
      const { database } = await mountAdd(async (db) => {
        await writeUser(db, {
          id: '0192f5a0-0000-7000-8000-00000000a001',
          email: 'ada@example.com',
          currency: 'USD',
          createdAt: '2026-10-01T00:00:00.000Z',
        });
      });

      await userEvent.press(screen.getByTestId(CATEGORY_ROW_TEST_ID));
      await userEvent.press(screen.getByTestId('category-picker-create-first'));
      await act(async () => {
        screen.getByTestId('category-name').props.onChangeText('Coffee');
      });
      await userEvent.press(screen.getByTestId('category-submit'));

      await waitFor(() =>
        expect(screen.getByTestId(CATEGORY_ROW_TEST_ID).props.accessibilityLabel).toBe(
          'Category, Coffee',
        ),
      );
      // Both sheets are gone, and the category is a real row with a real outbox entry.
      expect(screen.queryByTestId('category-sheet')).toBeNull();
      const queued = await outboxEntries(database);
      expect(queued).toHaveLength(1);
      expect(entryAt(queued, 0).entity).toBe('category');
      expect(screen.getByText('Coffee created.')).toBeTruthy();
    });
  });

  it('never reaches the network', async () => {
    const { requests } = await mountAdd();

    await typeAmount('1250');
    await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

    await waitFor(() => expect(routerRecord.back).toBe(1));
    expect(requests).toEqual([]);
  });

  it('keeps the amount within what the contract accepts', async () => {
    // The cap is `LIMITS.AMOUNT_MINOR_MAX`, read from the contract rather than retyped,
    // so the client and the server agree on the boundary.
    await mountAdd();

    await typeAmount('999999999999');

    expect(displayed()).toBe('$9,999,999,999.99');
    expect(String(LIMITS.AMOUNT_MINOR_MAX)).toBe('999999999999');
  });
});
