import { fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { META_KEYS, writeMeta } from '@/db/meta';
import { writeUser } from '@/db/user';
import type { SqliteDatabase } from '@/db/sqlite';
import { MONTH_TOTAL_TEST_ID } from '@/expenses/MonthTotal';
import ExpenseListScreen from '../../app/(app)/(tabs)/index';
import { resetRouter, routerRecord } from '../support/router';
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
 * Selecting several of your own expenses on Home and changing whether they are private. Only a
 * household has anyone to hide them from, so only a household can start it; and only your own
 * can be picked, because only an author may change an expense's privacy.
 */

const NOW = new Date(2026, 9, 14, 9, 0, 0);
const GROCERIES = categoryId(1);
const ME = '0192f5a0-0000-7000-8000-00000000a001';
const BAO = '0192f5a0-0000-7000-8000-00000000b001';
const MINE = expenseId(1);
const MINE_UNSYNCED = expenseId(2);
const BAOS = expenseId(3);
const row = (id: string) => screen.getByTestId(`expense-row-${id}`);

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
  for (const [index, id] of [MINE, MINE_UNSYNCED, BAOS].entries()) {
    await seedExpense(database, {
      id,
      categoryId: GROCERIES,
      amountMinor: 1000 * (index + 1),
      date: '2026-10-14',
    });
  }
  await database.runAsync('UPDATE expenses SET createdBy = ? WHERE id = ?', [ME, MINE]);
  await database.runAsync('UPDATE expenses SET createdBy = ? WHERE id = ?', [BAO, BAOS]);
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

async function mountHome(inHousehold = true) {
  const mounted = await mountScreen(<ExpenseListScreen />, {
    clock: () => NOW,
    seed: (db) => seed(db, inHousehold),
  });
  await waitFor(() => expect(screen.queryByTestId(MONTH_TOTAL_TEST_ID)).not.toBeNull());
  await waitFor(() => expect(screen.queryByTestId(`expense-row-${MINE}`)).not.toBeNull());
  // The member list is read a moment after the rows; "Added by you" shows once it has been.
  if (inHousehold) await screen.findByText(COPY.household.addedByYou);
  return mounted;
}

const locks = () => screen.queryAllByTestId(/^expense-private-/, { includeHiddenElements: true });

beforeEach(() => resetRouter());

describe('starting a selection', () => {
  it('is not offered outside a household', async () => {
    await mountHome(false);

    fireEvent(row(MINE), 'longPress');

    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  it('starts with a long press on your own expense', async () => {
    await mountHome();

    fireEvent(row(MINE), 'longPress');

    await waitFor(() => expect(screen.queryByTestId('selection-bar')).not.toBeNull());
    expect(screen.getByTestId('selection-count').props.children).toBe(
      COPY.household.bulk.selectedOne,
    );
    expect(row(MINE).props.accessibilityState).toMatchObject({ selected: true });
  });

  it('treats an expense not yet synced as your own', async () => {
    await mountHome();

    fireEvent(row(MINE_UNSYNCED), 'longPress');

    await waitFor(() => expect(screen.queryByTestId('selection-bar')).not.toBeNull());
  });

  it("does not start on someone else's expense", async () => {
    await mountHome();

    fireEvent(row(BAOS), 'longPress');

    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });
});

describe('while selecting', () => {
  async function select(): Promise<void> {
    fireEvent(row(MINE), 'longPress');
    await waitFor(() => expect(screen.queryByTestId('selection-bar')).not.toBeNull());
  }

  it('toggles your own expenses on a press and counts them', async () => {
    await mountHome();
    await select();

    await userEvent.press(row(MINE_UNSYNCED));
    expect(screen.getByTestId('selection-count').props.children).toBe(
      COPY.household.bulk.selectedMany.replace('{count}', '2'),
    );

    await userEvent.press(row(MINE_UNSYNCED));
    expect(screen.getByTestId('selection-count').props.children).toBe(
      COPY.household.bulk.selectedOne,
    );
    expect(routerRecord.push).toEqual([]);
  });

  it("ignores a press on someone else's expense instead of opening it", async () => {
    await mountHome();
    await select();

    await userEvent.press(row(BAOS));

    expect(screen.getByTestId('selection-count').props.children).toBe(
      COPY.household.bulk.selectedOne,
    );
    expect(routerRecord.push).toEqual([]);
  });

  it('ends when the last one is deselected, or on cancel', async () => {
    await mountHome();
    await select();

    await userEvent.press(row(MINE));
    expect(screen.queryByTestId('selection-bar')).toBeNull();

    await select();
    await userEvent.press(screen.getByTestId('selection-cancel'));
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(locks()).toHaveLength(0);
  });
});

describe('making them private or shared', () => {
  it('makes the selection private, says so, and queues the change', async () => {
    const { database } = await mountHome();
    fireEvent(row(MINE), 'longPress');
    await waitFor(() => expect(screen.queryByTestId('selection-bar')).not.toBeNull());
    await userEvent.press(row(MINE_UNSYNCED));

    await userEvent.press(screen.getByTestId('selection-make-private'));

    await waitFor(() => expect(locks()).toHaveLength(2));
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(
      screen.getByText(COPY.household.bulk.madePrivateMany.replace('{count}', '2')),
    ).toBeTruthy();
    const queued = (await outboxEntries(database)).filter((entry) => entry.entity === 'expense');
    expect(queued.map((entry) => JSON.parse(entry.fields))).toEqual([
      expect.objectContaining({ private: true }),
      expect.objectContaining({ private: true }),
    ]);
  });

  it('puts it back with Undo', async () => {
    await mountHome();
    fireEvent(row(MINE), 'longPress');
    await waitFor(() => expect(screen.queryByTestId('selection-bar')).not.toBeNull());
    await userEvent.press(screen.getByTestId('selection-make-private'));
    await waitFor(() => expect(locks()).toHaveLength(1));

    await userEvent.press(screen.getByText(COPY.common.undo));

    await waitFor(() => expect(locks()).toHaveLength(0));
  });

  it('makes private ones shared again', async () => {
    await mountHome();
    fireEvent(row(MINE), 'longPress');
    await waitFor(() => expect(screen.queryByTestId('selection-bar')).not.toBeNull());
    await userEvent.press(screen.getByTestId('selection-make-private'));
    await waitFor(() => expect(locks()).toHaveLength(1));

    fireEvent(row(MINE), 'longPress');
    await waitFor(() => expect(screen.queryByTestId('selection-bar')).not.toBeNull());
    await userEvent.press(screen.getByTestId('selection-make-shared'));

    await waitFor(() => expect(locks()).toHaveLength(0));
    expect(screen.getByText(COPY.household.bulk.madeSharedOne)).toBeTruthy();
  });
});
