import { migrate } from '../../src/db/migrations';
import {
  planReminders,
  reminderTime,
  syncBillReminders,
} from '../../src/notifications/billReminders';
import type { RecurringListItem } from '../../src/db/queries';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

function rule(overrides: Partial<RecurringListItem> = {}): RecurringListItem {
  return {
    id: 'r1',
    categoryId: 'c1',
    categoryName: 'Bills',
    categoryColor: '#000000',
    amountMinor: 1299,
    currency: 'USD',
    note: 'Netflix',
    frequency: 'monthly',
    startDate: '2026-09-05',
    endDate: null,
    pending: false,
    ...overrides,
  };
}

// 27 Oct 2026, 10:00 local.
const NOW = new Date(2026, 9, 27, 10, 0, 0);

describe('reminderTime', () => {
  it('is 09:00 local on the day before', () => {
    expect(reminderTime('2026-11-05')).toEqual(new Date(2026, 10, 4, 9, 0, 0));
  });

  it('crosses a month boundary', () => {
    expect(reminderTime('2026-11-01')).toEqual(new Date(2026, 9, 31, 9, 0, 0));
  });
});

describe('planReminders', () => {
  it('plans the next occurrence with the name and amount', () => {
    const [reminder] = planReminders([rule()], NOW);
    expect(reminder).toMatchObject({
      id: 'bill-reminder:r1',
      dueDate: '2026-11-05',
      title: 'Due tomorrow',
      body: 'Netflix · $12.99',
    });
    expect(reminder?.at).toEqual(new Date(2026, 10, 4, 9, 0, 0));
  });

  it('skips a rule that has ended', () => {
    expect(planReminders([rule({ endDate: '2026-10-01' })], NOW)).toEqual([]);
  });

  it('skips a reminder whose time has already passed', () => {
    // Due tomorrow (28 Oct): its 09:00 reminder was today, and it is already 10:00.
    expect(planReminders([rule({ startDate: '2026-09-28' })], NOW)).toEqual([]);
  });

  it('falls back to the category name when there is no note', () => {
    const [reminder] = planReminders([rule({ note: null })], NOW);
    expect(reminder?.body).toBe('Bills · $12.99');
  });
});

describe('syncBillReminders', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Notifications = require('expo-notifications') as {
    scheduleNotificationAsync: jest.Mock;
    cancelScheduledNotificationAsync: jest.Mock;
    getAllScheduledNotificationsAsync: jest.Mock;
    getPermissionsAsync: jest.Mock;
  };
  let database: TestDatabase;

  beforeEach(async () => {
    jest.clearAllMocks();
    Notifications.getPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
    Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
    database = createTestDatabase();
    await migrate(database);
    await database.runAsync(
      `INSERT INTO categories (id, name, color, isDefault, updatedAt, revision)
       VALUES ('c1', 'Bills', '#000000', 0, '2026-10-01T00:00:00.000Z', 1)`,
      [],
    );
    await database.runAsync(
      `INSERT INTO recurring (id, categoryId, amountMinor, currency, note, frequency, startDate, updatedAt, revision)
       VALUES ('r1', 'c1', 1299, 'USD', 'Netflix', 'monthly', '2026-09-05', '2026-10-01T00:00:00.000Z', 1)`,
      [],
    );
  });

  afterEach(() => database.close());

  it('schedules one reminder per rule', async () => {
    expect(await syncBillReminders(database, NOW)).toBe(1);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.scheduleNotificationAsync.mock.calls[0][0].identifier).toBe(
      'bill-reminder:r1',
    );
  });

  it('cancels stale reminders but leaves other notifications alone', async () => {
    Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'bill-reminder:gone' },
      { identifier: 'something-else' },
    ]);
    await syncBillReminders(database, NOW);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(
      'bill-reminder:gone',
    );
  });

  it('schedules nothing, and does not prompt, without permission', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    expect(await syncBillReminders(database, NOW)).toBe(0);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});
