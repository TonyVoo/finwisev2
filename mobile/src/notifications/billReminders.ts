import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { COPY } from '../copy/strings';
import { listLiveRecurring, type RecurringListItem } from '../db/queries';
import type { SqliteDatabase } from '../db/sqlite';
import { type CalendarDate, dateParts, stepDay } from '../lib/calendar';
import { toCalendarDate } from '../lib/clock';
import { formatMoney } from '../lib/money';
import { nextOccurrence } from '../recurring/schedule';
import { ensureChannel } from './budgetNotifier';

/**
 * A reminder the day before each recurring expense is due.
 *
 * Local notifications scheduled on the device, so they work offline and need no push server.
 * Only the **next** occurrence of each rule is scheduled, and the whole set is rebuilt on
 * every pass (`syncBillReminders`), so an edited, ended or deleted rule cannot leave a stale
 * reminder behind and nothing has to track which reminders already exist.
 */

export const REMINDER_CHANNEL = 'bill-reminders';
const ID_PREFIX = 'bill-reminder:';
/** Local time of day the reminder fires on the day before. */
const REMINDER_HOUR = 9;

export interface PlannedReminder {
  readonly id: string;
  readonly at: Date;
  readonly title: string;
  readonly body: string;
  readonly dueDate: CalendarDate;
}

/** 09:00 local on the day before `due`. */
export function reminderTime(due: CalendarDate): Date {
  const before = dateParts(stepDay(due, -1));
  return new Date(before.year, before.month - 1, before.day, REMINDER_HOUR, 0, 0, 0);
}

/** The reminders still worth scheduling: one per rule, only if its time is in the future. */
export function planReminders(
  rules: readonly RecurringListItem[],
  now: Date,
  fallbackName = '',
): readonly PlannedReminder[] {
  const today = toCalendarDate(now);
  const planned: PlannedReminder[] = [];
  for (const rule of rules) {
    const due = nextOccurrence(rule, today);
    if (due === null) continue;
    const at = reminderTime(due);
    if (at.getTime() <= now.getTime()) continue;
    const name = rule.note ?? rule.categoryName ?? fallbackName;
    planned.push({
      id: `${ID_PREFIX}${rule.id}`,
      at,
      dueDate: due,
      title: COPY.recurring.reminder.title,
      body: COPY.recurring.reminder.body
        .replace('{name}', name)
        .replace('{amount}', formatMoney(rule.amountMinor, rule.currency)),
    });
  }
  return planned;
}

/**
 * Rebuild the scheduled reminders from the rules on this device.
 *
 * Does **not** ask for permission - this runs from the sync pass, and a system prompt out of
 * nowhere is worse than no reminder. Permission is requested when the person saves a rule
 * (`requestReminderPermission`), which is the moment the question makes sense.
 */
export async function syncBillReminders(
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

  const plan = planReminders(await listLiveRecurring(database), now);
  if (plan.length === 0) return 0;

  await ensureChannel(REMINDER_CHANNEL, 'Bill reminders');
  for (const reminder of plan) {
    await Notifications.scheduleNotificationAsync({
      identifier: reminder.id,
      content: { title: reminder.title, body: reminder.body },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminder.at,
        ...(Platform.OS === 'android' ? { channelId: REMINDER_CHANNEL } : {}),
      },
    });
  }
  return plan.length;
}

/** Ask once, in the context of saving a recurring rule. Returns whether reminders can fire. */
export async function requestReminderPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}
