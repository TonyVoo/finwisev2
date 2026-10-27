import { migrate } from '../../src/db/migrations';
import { createGoal } from '../../src/db/mutations';
import type { GoalListItem } from '../../src/db/queries';
import {
  goalReminderTimes,
  planGoalReminders,
  syncGoalReminders,
} from '../../src/notifications/goalReminders';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

function goal(overrides: Partial<GoalListItem> = {}): GoalListItem {
  return {
    id: 'g1',
    name: 'Holiday',
    targetMinor: 100000,
    savedMinor: 40000,
    currency: 'USD',
    deadline: '2026-11-20',
    pending: false,
    ...overrides,
  };
}

// 27 Oct 2026, 10:00 local.
const NOW = new Date(2026, 9, 27, 10, 0, 0);

describe('goalReminderTimes', () => {
  it('is 09:00 local, a week and a day before the deadline', () => {
    expect(goalReminderTimes('2026-11-20')).toEqual({
      week: new Date(2026, 10, 13, 9, 0, 0),
      day: new Date(2026, 10, 19, 9, 0, 0),
    });
  });

  it('crosses a month boundary', () => {
    expect(goalReminderTimes('2026-11-03')).toEqual({
      week: new Date(2026, 9, 27, 9, 0, 0),
      day: new Date(2026, 10, 2, 9, 0, 0),
    });
  });
});

describe('planGoalReminders', () => {
  it('plans a week-before and a day-before reminder with the name and what is left', () => {
    const plan = planGoalReminders([goal()], NOW);

    expect(plan.map((p) => p.id)).toEqual(['goal-reminder:g1:week', 'goal-reminder:g1:day']);
    expect(plan[0]).toMatchObject({
      title: 'Goal due in a week',
      body: 'Holiday · $600.00 to go',
    });
    expect(plan[1]).toMatchObject({
      title: 'Goal due tomorrow',
      body: 'Holiday · $600.00 to go',
    });
    expect(plan[0]?.at).toEqual(new Date(2026, 10, 13, 9, 0, 0));
    expect(plan[1]?.at).toEqual(new Date(2026, 10, 19, 9, 0, 0));
  });

  it('drops a reminder whose time has passed but keeps the later one', () => {
    // Deadline 1 Nov: the week-before time was 25 Oct (gone), the day-before is 31 Oct.
    const plan = planGoalReminders([goal({ deadline: '2026-11-01' })], NOW);
    expect(plan.map((p) => p.id)).toEqual(['goal-reminder:g1:day']);
  });

  it('plans nothing once the goal is reached', () => {
    expect(planGoalReminders([goal({ savedMinor: 100000 })], NOW)).toEqual([]);
    expect(planGoalReminders([goal({ savedMinor: 150000 })], NOW)).toEqual([]);
  });

  it('plans nothing without a deadline, or after it', () => {
    expect(planGoalReminders([goal({ deadline: null })], NOW)).toEqual([]);
    expect(planGoalReminders([goal({ deadline: '2026-10-01' })], NOW)).toEqual([]);
  });

  it('plans nothing when the deadline is today or tomorrow and both times have passed', () => {
    expect(planGoalReminders([goal({ deadline: '2026-10-28' })], NOW)).toEqual([]);
  });
});

describe('syncGoalReminders', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Notifications = require('expo-notifications') as {
    scheduleNotificationAsync: jest.Mock;
    cancelScheduledNotificationAsync: jest.Mock;
    getAllScheduledNotificationsAsync: jest.Mock;
    getPermissionsAsync: jest.Mock;
  };
  let database: TestDatabase;

  async function seedGoal(deadline: string | null, savedMinor = 0): Promise<void> {
    await createGoal(
      database,
      { name: 'Holiday', targetMinor: 100000, savedMinor, currency: 'USD', deadline },
      { id: '0192f5a0-0000-7000-8000-0000000000a1' },
    );
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    Notifications.getPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
    Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
    database = await createTestDatabase();
    await migrate(database);
  });
  afterEach(() => database.close());

  it('schedules both reminders for a goal with a future deadline', async () => {
    await seedGoal('2026-11-20');

    expect(await syncGoalReminders(database, NOW)).toBe(2);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
    const ids = Notifications.scheduleNotificationAsync.mock.calls.map((c) => c[0].identifier);
    expect(ids).toEqual([
      'goal-reminder:0192f5a0-0000-7000-8000-0000000000a1:week',
      'goal-reminder:0192f5a0-0000-7000-8000-0000000000a1:day',
    ]);
  });

  it('cancels its own stale reminders and leaves other notifications alone', async () => {
    Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'goal-reminder:old:week' },
      { identifier: 'bill-reminder:r1' },
    ]);
    await seedGoal(null);

    await syncGoalReminders(database, NOW);

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(
      'goal-reminder:old:week',
    );
  });

  it('schedules nothing, and never prompts, without permission', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    await seedGoal('2026-11-20');

    expect(await syncGoalReminders(database, NOW)).toBe(0);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('schedules nothing for a goal that is already reached', async () => {
    await seedGoal('2026-11-20', 100000);

    expect(await syncGoalReminders(database, NOW)).toBe(0);
  });
});
