import { act, fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { META_KEYS, writeMeta } from '@/db/meta';
import { writeUser } from '@/db/user';
import type { SqliteDatabase } from '@/db/sqlite';
import { MONTH_TOTAL_TEST_ID } from '@/expenses/MonthTotal';
import { SAVE_TEST_ID } from '@/expenses/ExpenseFormScreen';
import NewExpenseScreen from '../../app/(app)/expense/new';
import EditExpenseScreen from '../../app/(app)/expense/[id]';
import ExpenseListScreen from '../../app/(app)/(tabs)/index';
import { resetRouter, setSearchParams } from '../support/router';
import { mountScreen } from '../support/mount';
import {
  categoryId,
  expenseId,
  outboxEntries,
  seedCategory,
  seedExpense,
  seedFallbackCategory,
} from '../support/seed';

jest.mock('expo-router');

/**
 * Private expenses on screen. Only a household has anyone to hide an expense from, so the switch
 * appears only there; the author's own lists mark a private expense with a lock, and say how
 * much of the month is private.
 */

const NOW = new Date(2026, 9, 14, 9, 0, 0);
const GROCERIES = categoryId(1);
const ME = '0192f5a0-0000-7000-8000-00000000a001';
const BAO = '0192f5a0-0000-7000-8000-00000000b001';
const hidden = { includeHiddenElements: true };

async function seed(database: SqliteDatabase, inHousehold: boolean): Promise<void> {
  await writeUser(database, {
    id: ME,
    email: 'ada@example.com',
    displayName: null,
    currency: 'USD',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  await seedFallbackCategory(database);
  await seedCategory(database, { id: GROCERIES, name: 'Groceries', color: '#2F8044' });
  if (inHousehold) {
    await writeMeta(
      database,
      META_KEYS.householdMembers,
      JSON.stringify([
        { userId: ME, email: 'ada@example.com', displayName: null },
        { userId: BAO, email: 'bao@example.com', displayName: null },
      ]),
    );
  }
}

async function typeAmount(keys: string): Promise<void> {
  for (const key of keys) await userEvent.press(screen.getByTestId(`keypad-${key}`));
}

beforeEach(() => resetRouter());

describe('the add form', () => {
  it('has no private switch for an account that is not in a household', async () => {
    await mountScreen(<NewExpenseScreen />, { clock: () => NOW, seed: (db) => seed(db, false) });
    await waitFor(() => expect(screen.queryByTestId('keypad-1')).not.toBeNull());

    expect(screen.queryByTestId('form-private')).toBeNull();
  });

  it('offers it in a household, off by default, with what it means', async () => {
    await mountScreen(<NewExpenseScreen />, { clock: () => NOW, seed: (db) => seed(db, true) });

    await waitFor(() => expect(screen.queryByTestId('form-private')).not.toBeNull());
    expect(screen.getByTestId('form-private-switch', hidden).props.value).toBe(false);
    expect(screen.getByText(COPY.form.private.label)).toBeTruthy();
    expect(screen.getByText(COPY.form.private.hint)).toBeTruthy();
  });

  it('saves a private expense with the flag in its outbox entry', async () => {
    const { database } = await mountScreen(<NewExpenseScreen />, {
      clock: () => NOW,
      seed: (db) => seed(db, true),
    });
    await waitFor(() => expect(screen.queryByTestId('form-private-switch', hidden)).not.toBeNull());

    await act(async () => {
      fireEvent(screen.getByTestId('form-private-switch', hidden), 'valueChange', true);
    });
    await typeAmount('500');
    await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

    await waitFor(async () => expect(await outboxEntries(database)).toHaveLength(1));
    const [entry] = await outboxEntries(database);
    expect(JSON.parse(entry!.fields as unknown as string)).toMatchObject({
      amountMinor: 500,
      private: true,
    });
  });

  it('saves an ordinary expense without the flag, exactly as before', async () => {
    const { database } = await mountScreen(<NewExpenseScreen />, {
      clock: () => NOW,
      seed: (db) => seed(db, true),
    });
    await waitFor(() => expect(screen.queryByTestId('form-private-switch', hidden)).not.toBeNull());

    await typeAmount('500');
    await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

    await waitFor(async () => expect(await outboxEntries(database)).toHaveLength(1));
    const [entry] = await outboxEntries(database);
    expect(JSON.parse(entry!.fields as unknown as string)).not.toHaveProperty('private');
  });
});

describe('the edit form', () => {
  async function mountEdit(isPrivate: boolean) {
    setSearchParams({ id: expenseId(1) });
    return await mountScreen(<EditExpenseScreen />, {
      clock: () => NOW,
      seed: async (db) => {
        await seed(db, true);
        await seedExpense(db, {
          id: expenseId(1),
          categoryId: GROCERIES,
          amountMinor: 1250,
          date: '2026-10-14',
        });
        await db.runAsync('UPDATE expenses SET private = ? WHERE id = ?', [
          isPrivate ? 1 : 0,
          expenseId(1),
        ]);
      },
    });
  }

  it('shows whether the expense is private', async () => {
    await mountEdit(true);

    await waitFor(() => expect(screen.queryByTestId('form-private-switch', hidden)).not.toBeNull());
    expect(screen.getByTestId('form-private-switch', hidden).props.value).toBe(true);
  });

  it('sends only the flag when it is the one thing that changed', async () => {
    const { database } = await mountEdit(false);
    await waitFor(() => expect(screen.queryByTestId('form-private-switch', hidden)).not.toBeNull());

    await act(async () => {
      fireEvent(screen.getByTestId('form-private-switch', hidden), 'valueChange', true);
    });
    await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

    await waitFor(async () => expect(await outboxEntries(database)).toHaveLength(1));
    const [entry] = await outboxEntries(database);
    expect(JSON.parse(entry!.fields as unknown as string)).toEqual({ private: true });
  });
});

describe('Home', () => {
  async function mountHome(inHousehold: boolean, withPrivate = true) {
    const mounted = await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: async (db) => {
        await seed(db, inHousehold);
        await seedExpense(db, {
          id: expenseId(1),
          categoryId: GROCERIES,
          amountMinor: 1250,
          date: '2026-10-14',
          note: 'Shared milk',
        });
        await seedExpense(db, {
          id: expenseId(2),
          categoryId: GROCERIES,
          amountMinor: 4000,
          date: '2026-10-14',
          note: 'Surprise gift',
        });
        if (withPrivate) {
          await db.runAsync('UPDATE expenses SET private = 1 WHERE id = ?', [expenseId(2)]);
        }
      },
    });
    await waitFor(() => expect(screen.queryByTestId(MONTH_TOTAL_TEST_ID)).not.toBeNull());
    return mounted;
  }

  it('marks a private expense with a lock, and only that one', async () => {
    await mountHome(true);

    await waitFor(() =>
      expect(screen.queryByTestId(`expense-private-${expenseId(2)}`, hidden)).not.toBeNull(),
    );
    expect(screen.queryByTestId(`expense-private-${expenseId(1)}`, hidden)).toBeNull();
  });

  it('says it in the row label, so a screen reader hears it too', async () => {
    await mountHome(true);

    await waitFor(() =>
      expect(screen.getByTestId(`expense-row-${expenseId(2)}`).props.accessibilityLabel).toContain(
        COPY.a11y.private,
      ),
    );
  });

  it("includes it in the author's total, and says how much of the month is private", async () => {
    await mountHome(true);

    await waitFor(() => expect(screen.queryByTestId('month-total-private')).not.toBeNull());
    expect(screen.getByTestId('month-total-private').props.children).toBe(
      COPY.home.private.replace('{amount}', '$40.00'),
    );
    // The total is the whole month, private included: $12.50 + $40.00.
    expect(screen.getByTestId(MONTH_TOTAL_TEST_ID).props.accessibilityLabel).toContain('$52.50');
  });

  it('shows nothing about private for an account that has none to report', async () => {
    await mountHome(true, false);

    expect(screen.queryByTestId('month-total-private')).toBeNull();
  });
});
