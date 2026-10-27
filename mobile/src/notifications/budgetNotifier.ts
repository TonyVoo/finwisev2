import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { type BudgetAlert, alertBody, alertTitle } from '../summary/budgetAlerts';
import { META_KEYS, readMeta, writeMeta } from '../db/meta';
import type { SqliteExecutor } from '../db/sqlite';

/**
 * A local notification when a category crosses 80% or 100% of its budget.
 *
 * Local on purpose: the alert is derived from SQLite on the device, so it works offline and
 * needs no push server (push is still out of scope, `docs/PLAN.md` §1). The trade-off is
 * that it fires when the app next evaluates the month - on Home - not the instant another
 * device syncs the expense in.
 *
 * "Announced once" is keyed by month plus the alert's own `key`, which changes whenever the
 * set of categories or the level does. So going from near to over notifies again, a new
 * month starts clean, and relaunching with nothing new stays quiet.
 */

export const BUDGET_CHANNEL = 'budget';

/** Show the banner and play the sound even while the app is open, as the alert is the point. */
export function installForegroundHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export function notificationKey(month: string, alert: BudgetAlert): string {
  return `${month}:${alert.key}`;
}

/** Pure decision: notify only for an alert that differs from the last one announced. */
export function shouldNotify(
  month: string,
  alert: BudgetAlert | null,
  lastNotified: string | null,
): boolean {
  return alert !== null && notificationKey(month, alert) !== lastNotified;
}

export async function ensureChannel(
  id: string = BUDGET_CHANNEL,
  name = 'Budget alerts',
): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(id, {
    name,
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/** Whether notifications are allowed, asking once if the system still lets us. */
export async function hasPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/**
 * Announce `alert` if it is news. Returns whether a notification was scheduled. The key is
 * recorded even when permission is refused, so a person who said no is not asked again on
 * every launch for the same situation.
 */
export async function notifyBudgetAlert(
  executor: SqliteExecutor,
  month: string,
  alert: BudgetAlert | null,
): Promise<boolean> {
  const last = await readMeta(executor, META_KEYS.budgetNotified);
  if (!shouldNotify(month, alert, last) || alert === null) return false;

  await writeMeta(executor, META_KEYS.budgetNotified, notificationKey(month, alert));
  if (!(await hasPermission())) return false;

  await ensureChannel();
  await Notifications.scheduleNotificationAsync({
    content: { title: alertTitle(alert), body: alertBody(alert) },
    trigger: Platform.OS === 'android' ? { channelId: BUDGET_CHANNEL } : null,
  });
  return true;
}
