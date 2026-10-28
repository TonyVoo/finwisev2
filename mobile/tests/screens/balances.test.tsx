import type { Household } from '@expense-tracker/shared';
import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { writeUser } from '@/db/user';
import type { SqliteDatabase } from '@/db/sqlite';
import HouseholdScreen from '../../app/(app)/settings/household';
import { resetRouter, routerRecord } from '../support/router';
import { mountScreen, ok } from '../support/mount';
import {
  categoryId,
  expenseId,
  seedCategory,
  seedExpense,
  seedFallbackCategory,
} from '../support/seed';

jest.mock('expo-router');

/**
 * The Balances section on the Household screen (`docs/design/12-settle-up.md`): who owes whom,
 * worded for the person looking, from the household's expenses and the recorded payments. The
 * arithmetic is the engine's and is tested apart; what is pinned here is that the screen hands
 * it the right rows and shows what comes back.
 */

const ME = '0192f5a0-0000-7000-8000-00000000a001';
const BAO = '0192f5a0-0000-7000-8000-00000000b001';
const CAM = '0192f5a0-0000-7000-8000-00000000c001';
const GROCERIES = categoryId(1);

const member = (
  userId: string,
  email: string,
  role: 'owner' | 'member',
  joinedAt = '2026-10-01T09:00:00.000Z',
) => ({ userId, email, displayName: null, role, joinedAt });

function household(members: Household['members']): Household {
  return {
    id: '0192f5a0-0000-7000-8000-00000000d001',
    role: 'member',
    ownerId: BAO,
    currency: 'USD',
    members,
  };
}

const asOwner = (data: Household): Household => ({
  ...data,
  role: 'owner',
  ownerId: ME,
  members: data.members.map((m) => ({ ...m, role: m.userId === ME ? 'owner' : 'member' })),
});
const TWO = household([
  member(BAO, 'bao@example.com', 'owner'),
  member(ME, 'ana@example.com', 'member'),
]);
const THREE = household([
  member(BAO, 'bao@example.com', 'owner'),
  member(ME, 'ana@example.com', 'member'),
  member(CAM, 'cam@example.com', 'member'),
]);

let counter = 0;
async function spend(
  database: SqliteDatabase,
  amountMinor: number,
  createdBy: string,
  extra: { date?: string; paidBy?: string | null; private?: boolean } = {},
): Promise<void> {
  counter += 1;
  const id = expenseId(counter);
  await seedExpense(database, {
    id,
    categoryId: GROCERIES,
    amountMinor,
    date: extra.date ?? '2026-10-10',
  });
  await database.runAsync(
    'UPDATE expenses SET createdBy = ?, paidBy = ?, private = ? WHERE id = ?',
    [createdBy, extra.paidBy ?? null, extra.private === true ? 1 : 0, id],
  );
}

async function paid(
  database: SqliteDatabase,
  from: string,
  to: string,
  amountMinor: number,
): Promise<void> {
  counter += 1;
  await database.runAsync(
    `INSERT INTO settlements (id, fromUserId, toUserId, amountMinor, date, updatedAt, revision)
     VALUES (?, ?, ?, ?, '2026-10-12', '2026-10-12T00:00:00.000Z', ?)`,
    [
      `0192f5a0-0000-7000-8000-9000000000${String(counter).padStart(2, '0')}`,
      from,
      to,
      amountMinor,
      counter,
    ],
  );
}

async function mount(
  data: Household | null,
  seed: (database: SqliteDatabase) => Promise<void> = async () => undefined,
) {
  const mounted = await mountScreen(<HouseholdScreen />, {
    transport: async (request) => {
      if (request.method === 'get' && request.path === '/v1/household') {
        return ok(200, { household: data });
      }
      throw new Error(`unexpected request ${request.method} ${request.path}`);
    },
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
      await seed(database);
    },
  });
  // Members have Leave and the owner has Delete: either means the household has loaded.
  await waitFor(() =>
    expect(
      screen.queryByTestId('household-leave') ?? screen.queryByTestId('household-delete'),
    ).not.toBeNull(),
  );
  return mounted;
}

beforeEach(() => {
  resetRouter();
  counter = 0;
});

describe('whether the section appears', () => {
  it('is absent when you are the only member', async () => {
    await mount(household([member(ME, 'ana@example.com', 'owner')]));

    expect(screen.queryByText(COPY.household.balances.title)).toBeNull();
  });

  it('appears once there are two members', async () => {
    await mount(TWO);

    expect(screen.getByText(COPY.household.balances.title)).toBeTruthy();
  });
});

describe('what it says', () => {
  it('says all settled up when nothing has been spent', async () => {
    await mount(TWO);

    expect(screen.getByText(COPY.household.balances.settled)).toBeTruthy();
  });

  it('says who owes you, when you paid', async () => {
    await mount(TWO, (db) => spend(db, 10000, ME));

    await waitFor(() => expect(screen.queryByText('Bao owes you $50.00')).not.toBeNull());
  });

  it('says what you owe, when they paid', async () => {
    await mount(TWO, (db) => spend(db, 10000, BAO));

    await waitFor(() => expect(screen.queryByText('You owe Bao $50.00')).not.toBeNull());
  });

  it('counts who paid, not only who added it', async () => {
    await mount(TWO, (db) => spend(db, 10000, ME, { paidBy: BAO }));

    await waitFor(() => expect(screen.queryByText('You owe Bao $50.00')).not.toBeNull());
  });

  it('does not count a private expense', async () => {
    await mount(TWO, async (db) => {
      await spend(db, 10000, ME, { private: true });
    });

    expect(screen.getByText(COPY.household.balances.settled)).toBeTruthy();
  });

  it('takes recorded payments off what is owed', async () => {
    await mount(TWO, async (db) => {
      await spend(db, 10000, ME);
      await paid(db, BAO, ME, 2000);
    });

    await waitFor(() => expect(screen.queryByText('Bao owes you $30.00')).not.toBeNull());
  });

  it('says all settled up once a payment covers it', async () => {
    await mount(TWO, async (db) => {
      await spend(db, 10000, ME);
      await paid(db, BAO, ME, 5000);
    });

    await waitFor(() => expect(screen.queryByText(COPY.household.balances.settled)).not.toBeNull());
    expect(screen.queryByText(/owes/)).toBeNull();
  });

  it('does not charge someone for an expense dated before they joined', async () => {
    await mount(
      household([
        member(BAO, 'bao@example.com', 'owner'),
        member(ME, 'ana@example.com', 'member', '2026-10-20T09:00:00.000Z'),
      ]),
      (db) => spend(db, 10000, BAO, { date: '2026-10-10' }),
    );

    expect(screen.getByText(COPY.household.balances.settled)).toBeTruthy();
  });

  it('shows what two other members owe each other, after your own lines', async () => {
    await mount(THREE, async (db) => {
      await spend(db, 9000, BAO);
      await spend(db, 3000, ME);
    });

    // 120.00 between three is 40.00 each: Ana fronted 30.00 and Bao 90.00, Cam nothing.
    await waitFor(() => expect(screen.queryByText('You owe Bao $10.00')).not.toBeNull());
    expect(screen.getByText('Cam owes Bao $40.00')).toBeTruthy();
    const lines = screen.getAllByTestId(/^balance-line-/).map((line) => line.props.testID);
    expect(lines[0]).toContain(ME);
    expect(lines[1]).toContain(CAM);
  });
});

describe('the actions', () => {
  it('opens Settle up', async () => {
    await mount(TWO);

    await userEvent.press(screen.getByTestId('balances-settle'));

    expect(routerRecord.push).toContain('/(app)/settings/settle-up');
  });

  it('opens the history', async () => {
    await mount(TWO);

    await userEvent.press(screen.getByTestId('balances-history'));

    expect(routerRecord.push).toContain('/(app)/settings/settlements');
  });
});

describe('leaving or removing someone while balances are open', () => {
  const partOf = { exact: false };

  it('warns before you leave, and still lets you', async () => {
    await mount(TWO, (db) => spend(db, 10000, BAO));
    await waitFor(() => expect(screen.queryByText('You owe Bao $50.00')).not.toBeNull());

    await userEvent.press(screen.getByTestId('household-leave'));

    expect(screen.getByText(COPY.household.balances.unsettledLeave, partOf)).toBeTruthy();
    // The usual words are still there, and the confirm button is not taken away.
    expect(screen.getByText(COPY.household.leave.body, partOf)).toBeTruthy();
    expect(screen.getByTestId('household-leave-dialog-confirm')).toBeTruthy();
  });

  it('says nothing extra when everyone is settled up', async () => {
    await mount(TWO);

    await userEvent.press(screen.getByTestId('household-leave'));

    expect(screen.queryByText(COPY.household.balances.unsettledLeave)).toBeNull();
    expect(screen.getByText(COPY.household.leave.body)).toBeTruthy();
  });

  it('warns the owner before removing someone', async () => {
    await mount(asOwner(TWO), (db) => spend(db, 10000, ME));
    await waitFor(() => expect(screen.queryByText('Bao owes you $50.00')).not.toBeNull());

    await userEvent.press(screen.getByTestId(`household-member-${BAO}`));
    await userEvent.press(screen.getByTestId('household-member-remove'));

    expect(screen.getByText(COPY.household.balances.unsettledRemove, partOf)).toBeTruthy();
    expect(screen.getByText(COPY.household.remove.body, partOf)).toBeTruthy();
  });

  it('does not warn the owner when everyone is settled up', async () => {
    await mount(asOwner(TWO));

    await userEvent.press(screen.getByTestId(`household-member-${BAO}`));
    await userEvent.press(screen.getByTestId('household-member-remove'));

    expect(screen.queryByText(COPY.household.balances.unsettledRemove)).toBeNull();
  });
});
