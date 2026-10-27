import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { COPY } from '../copy/strings';
import { listLiveGoals, type GoalListItem } from '../db/queries';
import type { SqliteDatabase } from '../db/sqlite';
import { type CalendarDate, dateParts, stepDay } from '../lib/calendar';
import { formatMoney } from '../lib/money';
import { goalProgress } from '../goals/goalModel';
import { ensureChannel } from './budgetNotifier';

/**
 * Two reminders for each unfinished savings goal that has a deadline: a week before, and the
 * day before, both at 09:00 local.
 *
 * Built the same way as the bill reminders: local notifications, scheduled on the device, so
 * they work offline with no push server, and the whole set is rebuilt on every pass. An
 * edited, reached, deleted or re-dated goal therefore cannot leave a stale reminder behind.
 * A goal that is already reached, has no deadline, or is past it gets none.
 */

export const GOAL_REMINDER_CHANNEL = 'goal-reminders';
const ID_PREFIX = 'goal-reminder:';
const REMINDER_HOUR = 9;

export interface PlannedGoalReminder {
  readonly id: string;
  readonly at: Date;
  readonly title: string;
  readonly body: string;
}

function at9(date: CalendarDate): Date {
  const { year, month, day } = dateParts(date);
  return new Date(year, month - 1, day, REMINDER_HOUR, 0, 0, 0);
}

/** 09:00 local, 7 days and 1 day before `deadline`. */
export function goalReminderTimes(deadline: CalendarDate): { week: Date; day: Date } {
  return { week: at9(stepDay(deadline, -7)), day: at9(stepDay(deadline, -1)) };
}

/** The reminders still worth scheduling: only those whose time is in the future. */
export function planGoalReminders(
  goals: readonly GoalListItem[],
  now: Date,
): readonly PlannedGoalReminder[] {
  const planned: PlannedGoalReminder[] = [];
  for (const goal of goals) {
    if (goal.deadline === null) continue;
    const { reached, remainingMinor } = goalProgress(goal.savedMinor, goal.targetMinor);
    if (reached) continue;

    const body = COPY.goals.reminder.body
      .replace('{name}', goal.name)
      .replace('{remaining}', formatMoney(remainingMinor, goal.currency));
    const times = goalReminderTimes(goal.deadline);
    const candidates: ReadonlyArray<readonly [string, Date, string]> = [
      ['week', times.week, COPY.goals.reminder.weekTitle],
      ['day', times.day, COPY.goals.reminder.dayTitle],
    ];
    for (const [kind, at, title] of candidates) {
      if (at.getTime() <= now.getTime()) continue;
      planned.push({ id: `${ID_PREFIX}${goal.id}:${kind}`, at, title, body });
    }
  }
  return planned;
}

/**
 * Rebuild the scheduled goal reminders from the goals on this device. Like the bill
 * reminders it never asks for permission: a prompt out of nowhere is worse than no reminder.
 */
export async function syncGoalReminders(
  database: SqliteDatabase,
  now: Date = new Date(),
): Promise<number> {
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  for (const scheduled of existing) {
    if (scheduled.identifier.startsWith(ID_PREFIX)) {
      await Notifications.cancelScheduledNotificationAsync(scheduled.identifier);
    }
  }

  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return 0;

  const plan = planGoalReminders(await listLiveGoals(database), now);
  if (plan.length === 0) return 0;

  await ensureChannel(GOAL_REMINDER_CHANNEL, 'Goal reminders');
  for (const reminder of plan) {
    await Notifications.scheduleNotificationAsync({
      identifier: reminder.id,
      content: { title: reminder.title, body: reminder.body },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminder.at,
        ...(Platform.OS === 'android' ? { channelId: GOAL_REMINDER_CHANNEL } : {}),
      },
    });
  }
  return plan.length;
}
