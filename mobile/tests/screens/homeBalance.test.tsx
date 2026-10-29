import { screen, userEvent, waitFor } from '@testing-library/react-native';
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
  seedCategory,
  seedExpense,
  seedFallbackCategory,
} from '../support/seed';

jest.mock('expo-router');

/**
 * The household balance on Home (`docs/design/12-settle-up.md`): one line under the month total
 * saying what you owe or are owed, from this phone's own rows, so it works offline. It speaks only
 * about you - what two other members owe each other is not Home's business - and says nothing at
 * all when you are settled up or not in a household.
 */

const NOW = new Date(2026, 9, 14, 9, 0, 0);
const ME = '0192f5a0-0000-7000-8000-00000000a001';
const BAO = '0192f5a0-0000-7000-8000-00000000b001';
const CAM = '0192f5a0-0000-7000-8000-00000000c001';
const GROCERIES = categoryId(1);
const LINE = 'home-balance';

const member = (userId: string, email: string) => ({
  userId,
  email,
  displayName: null,
  joinedAt: '2026-10-01T09:00:00.000Z',
});

let counter = 0;
async function spend(database: SqliteDatabase, amountMinor: number, createdBy: string) {
  counter += 1;
  await seedExpense(database, {
    id: expenseId(counter),
    categoryId: GROCERIES,
    amountMinor,
    date: '2026-10-10',
  });
  await database.runAsync('UPDATE expenses SET createdBy = ? WHERE id = ?', [
    createdBy,
    expenseId(counter),
  ]);
}

async function mountHome(
  members: readonly ReturnType<typeof member>[] | null,
  seed: (database: SqliteDatabase) => Promise<void> = async () => undefined,
) {
  const mounted = await mountScreen(<ExpenseListScreen />, {
    clock: () => NOW,
    seed: async (database) => {
      await writeUser(database, {
        id: ME,
        email: 'ana@example.com',
        displayName: null,
        currency: 'USD',
        createdAt: '2026-10-01T00:00:00.000Z',
      });
      await seedFallbackCategory(database);
      await seedCategory(database, { id: GROCERIES, name: 'Groceries', color: '#2F8044' });
      if (members !== null) {
        await writeMeta(database, META_KEYS.householdMembers, JSON.stringify(members));
      }
      await seed(database);
    },
  });
  await waitFor(() => expect(screen.queryByTestId(MONTH_TOTAL_TEST_ID)).not.toBeNull());
  return mounted;
}

const text = () => screen.getByTestId(LINE).props.accessibilityLabel as string;

beforeEach(() => {
  resetRouter();
  counter = 0;
});

const TWO = [member(ME, 'ana@example.com'), member(BAO, 'bao@example.com')];
const THREE = [...TWO, member(CAM, 'cam@example.com')];

describe('when there is nothing to say', () => {
  it('is absent outside a household', async () => {
    await mountHome(null, (db) => spend(db, 10000, BAO));

    expect(screen.queryByTestId(LINE)).toBeNull();
  });

  it('is absent when everyone is settled up', async () => {
    // Some row has to exist, or Home is still waiting for its first sync; income is never split.
    await mountHome(TWO, async (db) => {
      await seedExpense(db, {
        id: expenseId(99),
        categoryId: GROCERIES,
        kind: 'income',
        amountMinor: 5000,
        date: '2026-10-10',
      });
    });

    expect(screen.queryByTestId(LINE)).toBeNull();
  });

  it('is absent when only two other members owe each other', async () => {
    // 90.00 is 30.00 each: you paid your share, Cam paid 60.00, so only Bao owes Cam.
    await mountHome(THREE, async (db) => {
      await spend(db, 6000, CAM);
      await spend(db, 3000, ME);
    });

    await waitFor(() => expect(screen.queryByTestId(LINE)).toBeNull());
  });
});

describe('what it says', () => {
  it('says what you owe', async () => {
    await mountHome(TWO, (db) => spend(db, 10000, BAO));

    await waitFor(() => expect(screen.queryByTestId(LINE)).not.toBeNull());
    expect(text()).toContain('You owe Bao $50.00');
  });

  it('says what you are owed', async () => {
    await mountHome(TWO, (db) => spend(db, 10000, ME));

    await waitFor(() => expect(screen.queryByTestId(LINE)).not.toBeNull());
    expect(text()).toContain('Bao owes you $50.00');
  });

  it('shows the first of several lines about you, and how many more there are', async () => {
    // Bao and Cam each paid 60.00 for three: you owe each of them 20.00.
    await mountHome(THREE, async (db) => {
      await spend(db, 6000, BAO);
      await spend(db, 6000, CAM);
    });

    await waitFor(() => expect(screen.queryByTestId(LINE)).not.toBeNull());
    expect(text()).toContain('You owe');
    expect(text()).toContain(COPY.home.balanceMore.replace('{count}', '1'));
  });

  it('does not count a private expense', async () => {
    await mountHome(TWO, async (db) => {
      await spend(db, 10000, BAO);
      await db.runAsync('UPDATE expenses SET private = 1', []);
    });

    await waitFor(() => expect(screen.queryByTestId(LINE)).toBeNull());
  });
});

describe('opening it', () => {
  it('goes to the Household screen', async () => {
    await mountHome(TWO, (db) => spend(db, 10000, BAO));
    await waitFor(() => expect(screen.queryByTestId(LINE)).not.toBeNull());

    await userEvent.press(screen.getByTestId(LINE));

    expect(routerRecord.push).toContain('/(app)/settings/household');
  });
});
