import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { META_KEYS, writeMeta } from '@/db/meta';
import { listSettlements } from '@/db/queries';
import { writeUser } from '@/db/user';
import type { SqliteDatabase } from '@/db/sqlite';
import SettlementHistoryScreen from '../../app/(app)/settings/settlements';
import { resetRouter, routerRecord } from '../support/router';
import { mountScreen } from '../support/mount';
import { seedFallbackCategory } from '../support/seed';

jest.mock('expo-router');

/**
 * The payment history (`docs/design/12-settle-up.md`): every recorded payment, newest first, worded
 * for the person looking. Only the two people a payment names can delete it, which is also what the
 * server allows, so everyone else's rows are read-only here rather than offering what would be
 * refused.
 */

const ME = '0192f5a0-0000-7000-8000-00000000a001';
const BAO = '0192f5a0-0000-7000-8000-00000000b001';
const CAM = '0192f5a0-0000-7000-8000-00000000c001';
const GONE = '0192f5a0-0000-7000-8000-00000000d001';
const hidden = { includeHiddenElements: true };

async function seed(database: SqliteDatabase): Promise<void> {
  await writeUser(database, {
    id: ME,
    email: 'ana@example.com',
    displayName: null,
    currency: 'USD',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  await seedFallbackCategory(database);
  await writeMeta(
    database,
    META_KEYS.householdMembers,
    JSON.stringify([
      { userId: ME, email: 'ana@example.com', displayName: null },
      { userId: BAO, email: 'bao@example.com', displayName: null },
      { userId: CAM, email: 'cam@example.com', displayName: 'Cam' },
    ]),
  );
}

let counter = 0;
const idOf = (n: number) => `0192f5a0-0000-7000-8000-9000000000${String(n).padStart(2, '0')}`;

async function paid(
  database: SqliteDatabase,
  from: string,
  to: string,
  amountMinor: number,
  extra: { date?: string; note?: string | null } = {},
): Promise<string> {
  counter += 1;
  await database.runAsync(
    `INSERT INTO settlements (id, fromUserId, toUserId, amountMinor, date, note, updatedAt, revision)
     VALUES (?, ?, ?, ?, ?, ?, '2026-10-12T00:00:00.000Z', ?)`,
    [idOf(counter), from, to, amountMinor, extra.date ?? '2026-10-12', extra.note ?? null, counter],
  );
  return idOf(counter);
}

async function mount(rows: (database: SqliteDatabase) => Promise<void> = async () => undefined) {
  const mounted = await mountScreen(<SettlementHistoryScreen />, {
    seed: async (database) => {
      await seed(database);
      await rows(database);
    },
  });
  await waitFor(() => expect(screen.queryByTestId('history-list')).not.toBeNull());
  return mounted;
}

const rowOf = (id: string) => screen.getByTestId(`settlement-row-${id}`, hidden);

beforeEach(() => {
  resetRouter();
  counter = 0;
});

describe('the list', () => {
  it('says there is nothing yet, kindly', async () => {
    await mount();

    await waitFor(() => expect(screen.queryByTestId('history-empty')).not.toBeNull());
    expect(screen.getByText(COPY.household.history.emptyHeadline)).toBeTruthy();
    expect(screen.getByText(COPY.household.history.emptyBody)).toBeTruthy();
  });

  it('words each payment for the person looking', async () => {
    await mount(async (db) => {
      await paid(db, ME, BAO, 4200);
      await paid(db, BAO, ME, 1250);
      await paid(db, CAM, BAO, 300);
    });

    await waitFor(() => expect(screen.queryByText('You paid Bao')).not.toBeNull());
    expect(screen.getByText('Bao paid you')).toBeTruthy();
    expect(screen.getByText('Cam paid Bao')).toBeTruthy();
  });

  it('shows the amount, and the date with any note', async () => {
    const { database } = await mount(async (db) => {
      await paid(db, ME, BAO, 4200, { date: '2026-10-09', note: 'cash at lunch' });
    });

    await waitFor(() => expect(screen.queryByText('$42.00')).not.toBeNull());
    expect(screen.getByText(/cash at lunch/)).toBeTruthy();
    expect((await listSettlements(database))[0]?.note).toBe('cash at lunch');
  });

  it('lists the newest first', async () => {
    await mount(async (db) => {
      await paid(db, ME, BAO, 100, { date: '2026-10-01' });
      await paid(db, ME, CAM, 200, { date: '2026-10-20' });
    });

    await waitFor(() => expect(screen.queryByText('You paid Cam')).not.toBeNull());
    const rows = screen.getAllByTestId(/^settlement-row-/, hidden).map((row) => row.props.testID);
    expect(rows).toEqual([`settlement-row-${idOf(2)}`, `settlement-row-${idOf(1)}`]);
  });

  it('names someone who has left as a former member', async () => {
    await mount((db) => paid(db, GONE, ME, 500).then(() => undefined));

    await waitFor(() =>
      expect(screen.queryByText(`${COPY.household.formerMember} paid you`)).not.toBeNull(),
    );
  });
});

describe('deleting a payment', () => {
  const act_ = async (id: string, name: string) => {
    await act(async () => {
      rowOf(id).props.onAccessibilityAction({ nativeEvent: { actionName: name } });
    });
  };

  it('lets either person it names delete it, with an Undo', async () => {
    const { database } = await mount((db) => paid(db, ME, BAO, 4200).then(() => undefined));
    await waitFor(() => expect(screen.queryByText('You paid Bao')).not.toBeNull());

    await act_(idOf(1), 'delete');

    await waitFor(async () => expect(await listSettlements(database)).toEqual([]));
    expect(screen.getByText(COPY.household.history.deleted)).toBeTruthy();
  });

  it('brings it back with Undo', async () => {
    const { database } = await mount((db) => paid(db, BAO, ME, 900).then(() => undefined));
    await waitFor(() => expect(screen.queryByText('Bao paid you')).not.toBeNull());
    await act_(idOf(1), 'delete');
    await waitFor(async () => expect(await listSettlements(database)).toEqual([]));

    await userEvent.press(screen.getByText(COPY.common.undo));

    await waitFor(async () => expect((await listSettlements(database)).length).toBe(1));
  });

  it('is not offered for a payment between two other people', async () => {
    await mount((db) => paid(db, CAM, BAO, 300).then(() => undefined));
    await waitFor(() => expect(screen.queryByText('Cam paid Bao')).not.toBeNull());

    const names = ((rowOf(idOf(1)).props.accessibilityActions ?? []) as { name: string }[]).map(
      (action) => action.name,
    );

    expect(names).not.toContain('delete');
  });
});

describe('leaving', () => {
  it('has a back button', async () => {
    await mount();

    await userEvent.press(screen.getByTestId('history-back'));

    expect(routerRecord.back).toBe(1);
  });
});
