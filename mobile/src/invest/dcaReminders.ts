import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { COPY } from '../copy/strings';
import type { SqliteDatabase } from '../db/sqlite';
import { type CalendarDate, dateParts } from '../lib/calendar';
import { ensureChannel } from '../notifications/budgetNotifier';
import { type DcaPlan, readPlans, upcomingBuyDates } from './dca';
import { fillTemplate, formatDong } from './investModel';

/**
 * A reminder on the day of each monthly plan, at 09:00 local, for the next three months. Built like the goal and bill
 * reminders: local notifications scheduled on the device, the whole set rebuilt on every pass, so an edited or
 * removed plan cannot leave a stale one behind, and it never asks for permission out of nowhere.
 */

export const DCA_REMINDER_CHANNEL = 'dca-reminders';
const ID_PREFIX = 'dca-reminder:';
const REMINDER_HOUR = 9;
const MONTHS_AHEAD = 3;

export interface PlannedDcaReminder {
  readonly id: string;
  readonly at: Date;
  readonly title: string;
  readonly body: string;
}

function at9(date: CalendarDate): Date {
  const { year, month, day } = dateParts(date);
  return new Date(year, month - 1, day, REMINDER_HOUR, 0, 0, 0);
}

function localDate(now: Date): CalendarDate {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The reminders still worth scheduling: those whose time is in the future. */
export function planDcaReminders(
  plans: readonly DcaPlan[],
  now: Date,
): readonly PlannedDcaReminder[] {
  const planned: PlannedDcaReminder[] = [];
  for (const plan of plans) {
    let count = 0;
    // One extra date: today's, when it has already passed, is skipped and the three that are left still count.
    for (const date of upcomingBuyDates(plan, localDate(now), MONTHS_AHEAD + 1)) {
      const at = at9(date);
      if (at.getTime() <= now.getTime() || count >= MONTHS_AHEAD) continue;
      count += 1;
      planned.push({
        id: `${ID_PREFIX}${plan.id}:${date}`,
        at,
        title: fillTemplate(COPY.portfolio.dcaReminderTitle, { symbol: plan.symbol }),
        body: fillTemplate(COPY.portfolio.dcaReminderBody, { amount: formatDong(plan.amount) }),
      });
    }
  }
  return planned;
}

export async function syncDcaReminders(
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

  const plan = planDcaReminders(await readPlans(database), now);
  if (plan.length === 0) return 0;

  await ensureChannel(DCA_REMINDER_CHANNEL, 'Monthly plans');
  for (const reminder of plan) {
    await Notifications.scheduleNotificationAsync({
      identifier: reminder.id,
      content: { title: reminder.title, body: reminder.body },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminder.at,
        ...(Platform.OS === 'android' ? { channelId: DCA_REMINDER_CHANNEL } : {}),
      },
    });
  }
  return plan.length;
}
