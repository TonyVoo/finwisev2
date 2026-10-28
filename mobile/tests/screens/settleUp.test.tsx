import type { Household } from '@expense-tracker/shared';
import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { COPY, VALIDATION_COPY } from '@/copy/strings';
import { writeUser } from '@/db/user';
import type { SqliteDatabase } from '@/db/sqlite';
import { AMOUNT_DISPLAY_TEST_ID } from '@/expenses/AmountDisplay';
import { NOTE_DONE_TEST_ID, NOTE_INPUT_TEST_ID } from '@/expenses/NoteSheet';
import { listSettlements } from '@/db/queries';
import SettleUpScreen from '../../app/(app)/settings/settle-up';
import { resetRouter, routerRecord } from '../support/router';
import { mountScreen, ok, typeInto } from '../support/mount';
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
 * Settle up (`docs/design/12-settle-up.md`): record that one member paid another. It starts from
 * what you actually owe - the person, the direction and the amount - because that is nearly always
 * what is being settled, and every part is still yours to change. Nothing is saved until Record.
 */

const NOW = new Date(2026, 9, 14, 9, 0, 0);
const ME = '0192f5a0-0000-7000-8000-00000000a001';
const BAO = '0192f5a0-0000-7000-8000-00000000b001';
const CAM = '0192f5a0-0000-7000-8000-00000000c001';
const GROCERIES = categoryId(1);

const member = (userId: string, email: string, role: 'owner' | 'member') => ({
  userId,
  email,
  displayName: null,
  role,
  joinedAt: '2026-10-01T09:00:00.000Z',
});
const household = (members: Household['members']): Household => ({
  id: '0192f5a0-0000-7000-8000-00000000d001',
  role: 'member',
  ownerId: BAO,
  currency: 'USD',
  members,
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

async function mount(
  data: Household,
  seed: (database: SqliteDatabase) => Promise<void> = async () => undefined,
) {
  const mounted = await mountScreen(<SettleUpScreen />, {
    clock: () => NOW,
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
  await waitFor(() => expect(screen.queryByTestId('settle-person')).not.toBeNull());
  return mounted;
}

const amountLabel = () =>
  screen.getByTestId(AMOUNT_DISPLAY_TEST_ID).props.accessibilityLabel as string;
const personLabel = () => screen.getByTestId('settle-person').props.accessibilityLabel as string;
const selected = (testID: string) =>
  (screen.getByTestId(testID).props.accessibilityState as { selected?: boolean }).selected === true;
const recordDisabled = () =>
  (screen.getByTestId('settle-record').props.accessibilityState as { disabled?: boolean })
    .disabled === true;

async function lastSettlementFields(database: SqliteDatabase): Promise<Record<string, unknown>> {
  const entries = (await outboxEntries(database)).filter((entry) => entry.entity === 'settlement');
  return JSON.parse(entries[entries.length - 1]!.fields as unknown as string);
}

beforeEach(() => {
  resetRouter();
  counter = 0;
});

describe('where it starts', () => {
  it('begins with what you owe: that person, "I paid", and the amount', async () => {
    await mount(TWO, (db) => spend(db, 10000, BAO));

    await waitFor(() => expect(amountLabel()).toContain('50.00'));
    expect(personLabel()).toContain('Bao');
    expect(selected('settle-direction-i-paid')).toBe(true);
    expect(selected('settle-direction-they-paid')).toBe(false);
    expect(recordDisabled()).toBe(false);
  });

  it('begins with what you are owed: that person, "They paid me", and the amount', async () => {
    await mount(TWO, (db) => spend(db, 10000, ME));

    await waitFor(() => expect(amountLabel()).toContain('50.00'));
    expect(selected('settle-direction-they-paid')).toBe(true);
  });

  it('begins empty when nobody owes anything, and cannot be recorded yet', async () => {
    await mount(TWO);

    expect(amountLabel()).toContain('0.00');
    expect(selected('settle-direction-i-paid')).toBe(true);
    expect(personLabel()).toContain('Bao');
    expect(recordDisabled()).toBe(true);
    expect(screen.getByText(VALIDATION_COPY.amount.zero)).toBeTruthy();
  });

  it('shows today as the date', async () => {
    await mount(TWO, (db) => spend(db, 10000, BAO));

    expect(screen.getByTestId('settle-date').props.accessibilityLabel).toContain('Today');
  });
});

describe('recording it', () => {
  it('records that you paid, and leaves', async () => {
    const { database } = await mount(TWO, (db) => spend(db, 10000, BAO));
    await waitFor(() => expect(amountLabel()).toContain('50.00'));

    await userEvent.press(screen.getByTestId('settle-record'));

    await waitFor(async () => expect((await listSettlements(database)).length).toBe(1));
    expect(await lastSettlementFields(database)).toEqual({
      fromUserId: ME,
      toUserId: BAO,
      amountMinor: 5000,
      date: '2026-10-14',
    });
    expect(routerRecord.back).toBe(1);
    expect(screen.getByText(COPY.household.settle.recorded)).toBeTruthy();
  });

  it('records that they paid you', async () => {
    const { database } = await mount(TWO, (db) => spend(db, 10000, ME));
    await waitFor(() => expect(amountLabel()).toContain('50.00'));

    await userEvent.press(screen.getByTestId('settle-record'));

    await waitFor(async () => expect((await listSettlements(database)).length).toBe(1));
    expect(await lastSettlementFields(database)).toMatchObject({
      fromUserId: BAO,
      toUserId: ME,
      amountMinor: 5000,
    });
  });

  it('can be undone from the snackbar', async () => {
    const { database } = await mount(TWO, (db) => spend(db, 10000, BAO));
    await waitFor(() => expect(amountLabel()).toContain('50.00'));
    await userEvent.press(screen.getByTestId('settle-record'));
    await waitFor(async () => expect((await listSettlements(database)).length).toBe(1));

    await userEvent.press(screen.getByText(COPY.common.undo));

    await waitFor(async () => expect(await listSettlements(database)).toEqual([]));
  });

  it('saves nothing, and just leaves, on close', async () => {
    const { database } = await mount(TWO, (db) => spend(db, 10000, BAO));

    await userEvent.press(screen.getByTestId('settle-close'));

    expect(routerRecord.back).toBe(1);
    expect(await outboxEntries(database)).toEqual([]);
  });
});

describe('changing it', () => {
  it('replaces the starting amount with whatever is typed', async () => {
    const { database } = await mount(TWO, (db) => spend(db, 10000, BAO));
    await waitFor(() => expect(amountLabel()).toContain('50.00'));

    for (const key of '3000') await userEvent.press(screen.getByTestId(`keypad-${key}`));
    expect(amountLabel()).toContain('30.00');
    await userEvent.press(screen.getByTestId('settle-record'));

    await waitFor(async () => expect((await listSettlements(database)).length).toBe(1));
    expect(await lastSettlementFields(database)).toMatchObject({ amountMinor: 3000 });
  });

  it('flips who paid', async () => {
    const { database } = await mount(TWO, (db) => spend(db, 10000, BAO));
    await waitFor(() => expect(amountLabel()).toContain('50.00'));

    await userEvent.press(screen.getByTestId('settle-direction-they-paid'));
    expect(selected('settle-direction-they-paid')).toBe(true);
    await userEvent.press(screen.getByTestId('settle-record'));

    await waitFor(async () => expect((await listSettlements(database)).length).toBe(1));
    expect(await lastSettlementFields(database)).toMatchObject({ fromUserId: BAO, toUserId: ME });
  });

  it('picks another member, starting from what is owed with them', async () => {
    await mount(THREE, async (db) => {
      await spend(db, 9000, BAO);
      await spend(db, 3000, ME);
    });
    // You owe Bao 10.00; Cam owes Bao and has nothing to do with you.
    await waitFor(() => expect(amountLabel()).toContain('10.00'));

    await userEvent.press(screen.getByTestId('settle-person'));
    expect(screen.queryByTestId(`paid-by-option-${ME}`)).toBeNull();
    await userEvent.press(screen.getByTestId(`paid-by-option-${CAM}`));

    expect(personLabel()).toContain('Cam');
    expect(amountLabel()).toContain('0.00');
    expect(recordDisabled()).toBe(true);
  });

  it('keeps an amount you typed when you pick someone else', async () => {
    await mount(THREE, (db) => spend(db, 9000, BAO));
    // 90.00 between three: you owe Bao 30.00.
    await waitFor(() => expect(amountLabel()).toContain('30.00'));

    for (const key of '700') await userEvent.press(screen.getByTestId(`keypad-${key}`));
    await userEvent.press(screen.getByTestId('settle-person'));
    await userEvent.press(screen.getByTestId(`paid-by-option-${CAM}`));

    expect(amountLabel()).toContain('7.00');
  });

  it('records a note, trimmed', async () => {
    const { database } = await mount(TWO, (db) => spend(db, 10000, BAO));
    await waitFor(() => expect(amountLabel()).toContain('50.00'));

    await userEvent.press(screen.getByTestId('settle-note'));
    await typeInto(NOTE_INPUT_TEST_ID, '  cash at lunch ');
    await userEvent.press(screen.getByTestId(NOTE_DONE_TEST_ID));
    await userEvent.press(screen.getByTestId('settle-record'));

    await waitFor(async () => expect((await listSettlements(database)).length).toBe(1));
    expect(await lastSettlementFields(database)).toMatchObject({ note: 'cash at lunch' });
  });
});
