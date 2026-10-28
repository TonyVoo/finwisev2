import { act, fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { META_KEYS, writeMeta } from '@/db/meta';
import { writeUser } from '@/db/user';
import type { SqliteDatabase } from '@/db/sqlite';
import { SAVE_TEST_ID } from '@/expenses/ExpenseFormScreen';
import NewExpenseScreen from '../../app/(app)/expense/new';
import EditExpenseScreen from '../../app/(app)/expense/[id]';
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
 * The Paid by row on the expense form (`docs/design/12-settle-up.md`). Household only, hidden on a
 * private expense, and it stores a payer only when that differs from whoever added the expense:
 * choosing the person who would have paid anyway saves nothing extra.
 */

const NOW = new Date(2026, 9, 14, 9, 0, 0);
const GROCERIES = categoryId(1);
const ME = '0192f5a0-0000-7000-8000-00000000a001';
const BAO = '0192f5a0-0000-7000-8000-00000000b001';
const GONE = '0192f5a0-0000-7000-8000-00000000d001';
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
        { userId: BAO, email: 'bao@example.com', displayName: 'Bao' },
      ]),
    );
  }
}

async function typeAmount(keys: string): Promise<void> {
  for (const key of keys) await userEvent.press(screen.getByTestId(`keypad-${key}`));
}

const rowLabel = () =>
  screen.getByTestId('form-paid-by', hidden).props.accessibilityLabel as string;

async function mountAdd(inHousehold = true) {
  const mounted = await mountScreen(<NewExpenseScreen />, {
    clock: () => NOW,
    seed: (db) => seed(db, inHousehold),
  });
  await waitFor(() => expect(screen.queryByTestId('keypad-1')).not.toBeNull());
  return mounted;
}

/** An expense in the household's book, added by `createdBy`, paid by `paidBy` (null: the adder). */
async function mountEdit(createdBy: string | null, paidBy: string | null) {
  setSearchParams({ id: expenseId(1) });
  const mounted = await mountScreen(<EditExpenseScreen />, {
    clock: () => NOW,
    seed: async (db) => {
      await seed(db, true);
      await seedExpense(db, {
        id: expenseId(1),
        categoryId: GROCERIES,
        amountMinor: 1250,
        date: '2026-10-14',
      });
      await db.runAsync('UPDATE expenses SET createdBy = ?, paidBy = ? WHERE id = ?', [
        createdBy,
        paidBy,
        expenseId(1),
      ]);
    },
  });
  await waitFor(() => expect(screen.queryByTestId('form-paid-by', hidden)).not.toBeNull());
  return mounted;
}

const isSaveDisabled = () =>
  (screen.getByTestId(SAVE_TEST_ID).props.accessibilityState as { disabled: boolean }).disabled;

async function lastEntry(database: SqliteDatabase): Promise<Record<string, unknown>> {
  const entries = await outboxEntries(database);
  return JSON.parse(entries[entries.length - 1]!.fields as unknown as string);
}

beforeEach(() => resetRouter());

describe('whether the row is offered', () => {
  it('is absent outside a household', async () => {
    await mountAdd(false);

    expect(screen.queryByTestId('form-paid-by', hidden)).toBeNull();
  });

  it('is offered in a household, naming you by default', async () => {
    await mountAdd();

    await waitFor(() => expect(screen.queryByTestId('form-paid-by', hidden)).not.toBeNull());
    expect(rowLabel()).toBe(`${COPY.form.paidBy.label}, ${COPY.household.you}`);
  });

  it('goes away while the expense is private, and comes back when it is not', async () => {
    await mountAdd();
    await waitFor(() => expect(screen.queryByTestId('form-private-switch', hidden)).not.toBeNull());

    await act(async () => {
      fireEvent(screen.getByTestId('form-private-switch', hidden), 'valueChange', true);
    });
    expect(screen.queryByTestId('form-paid-by', hidden)).toBeNull();

    await act(async () => {
      fireEvent(screen.getByTestId('form-private-switch', hidden), 'valueChange', false);
    });
    expect(screen.queryByTestId('form-paid-by', hidden)).not.toBeNull();
  });
});

describe('choosing who paid, on a new expense', () => {
  it('lists the members, with you ticked', async () => {
    await mountAdd();
    await waitFor(() => expect(screen.queryByTestId('form-paid-by', hidden)).not.toBeNull());

    await userEvent.press(screen.getByTestId('form-paid-by', hidden));

    expect(screen.getByText(COPY.form.paidBy.title)).toBeTruthy();
    expect(screen.getByTestId(`paid-by-option-${ME}`).props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByTestId(`paid-by-option-${BAO}`).props.accessibilityState).toMatchObject({
      selected: false,
    });
    expect(screen.getByText('Bao')).toBeTruthy();
  });

  it('saves the payer when it is someone else, and shows their name', async () => {
    const { database } = await mountAdd();
    await waitFor(() => expect(screen.queryByTestId('form-paid-by', hidden)).not.toBeNull());

    await userEvent.press(screen.getByTestId('form-paid-by', hidden));
    await userEvent.press(screen.getByTestId(`paid-by-option-${BAO}`));
    expect(rowLabel()).toBe(`${COPY.form.paidBy.label}, Bao`);
    await typeAmount('500');
    await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

    await waitFor(async () => expect(await outboxEntries(database)).toHaveLength(1));
    expect(await lastEntry(database)).toMatchObject({ amountMinor: 500, paidBy: BAO });
  });

  it('saves nothing extra when you pay, which is the default', async () => {
    const { database } = await mountAdd();
    await waitFor(() => expect(screen.queryByTestId('form-paid-by', hidden)).not.toBeNull());

    await userEvent.press(screen.getByTestId('form-paid-by', hidden));
    await userEvent.press(screen.getByTestId(`paid-by-option-${ME}`));
    await typeAmount('500');
    await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

    await waitFor(async () => expect(await outboxEntries(database)).toHaveLength(1));
    expect(await lastEntry(database)).not.toHaveProperty('paidBy');
  });

  it('can be changed back after choosing someone else', async () => {
    const { database } = await mountAdd();
    await waitFor(() => expect(screen.queryByTestId('form-paid-by', hidden)).not.toBeNull());

    await userEvent.press(screen.getByTestId('form-paid-by', hidden));
    await userEvent.press(screen.getByTestId(`paid-by-option-${BAO}`));
    await userEvent.press(screen.getByTestId('form-paid-by', hidden));
    await userEvent.press(screen.getByTestId(`paid-by-option-${ME}`));
    await typeAmount('500');
    await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

    await waitFor(async () => expect(await outboxEntries(database)).toHaveLength(1));
    expect(await lastEntry(database)).not.toHaveProperty('paidBy');
  });
});

describe('editing an expense', () => {
  it('names whoever added it when no payer was set', async () => {
    await mountEdit(BAO, null);

    expect(rowLabel()).toBe(`${COPY.form.paidBy.label}, Bao`);
    expect(isSaveDisabled()).toBe(true);
  });

  it('names you when you added it and no payer was set', async () => {
    await mountEdit(ME, null);

    expect(rowLabel()).toBe(`${COPY.form.paidBy.label}, ${COPY.household.you}`);
  });

  it('names an expense with no recorded author as yours, which is who it was made by', async () => {
    await mountEdit(null, null);

    expect(rowLabel()).toBe(`${COPY.form.paidBy.label}, ${COPY.household.you}`);
  });

  it("records you as the payer of someone else's expense, and enables Save", async () => {
    const { database } = await mountEdit(BAO, null);

    await userEvent.press(screen.getByTestId('form-paid-by', hidden));
    await userEvent.press(screen.getByTestId(`paid-by-option-${ME}`));
    expect(isSaveDisabled()).toBe(false);
    await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

    await waitFor(async () => expect(await outboxEntries(database)).toHaveLength(1));
    expect(await lastEntry(database)).toEqual({ paidBy: ME });
  });

  it('clears the payer when the person who added it is chosen again', async () => {
    const { database } = await mountEdit(BAO, ME);
    expect(rowLabel()).toBe(`${COPY.form.paidBy.label}, ${COPY.household.you}`);

    await userEvent.press(screen.getByTestId('form-paid-by', hidden));
    await userEvent.press(screen.getByTestId(`paid-by-option-${BAO}`));
    await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

    await waitFor(async () => expect(await outboxEntries(database)).toHaveLength(1));
    expect(await lastEntry(database)).toEqual({ paidBy: null });
  });

  it('shows a payer who has left as a former member', async () => {
    await mountEdit(ME, GONE);

    expect(rowLabel()).toBe(`${COPY.form.paidBy.label}, ${COPY.household.formerMember}`);
  });
});
