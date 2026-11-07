import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { ApiClient } from '../api/client';
import { COPY } from '../copy/strings';
import type { SqliteDatabase } from '../db/sqlite';
import { ensureChannel, hasPermission } from '../notifications/budgetNotifier';
import { type PriceAlert, markFired, readAlerts, trippedBy, waitingSymbols } from './alerts';
import { formatDong, fillTemplate } from './investModel';

/**
 * Look at the waiting price alerts, and tell the person about any a price has reached.
 *
 * Run after every sync pass (so when the app opens, comes to the front, or wakes for background sync), not on its
 * own timer: the phone is the only place that can notify without a push server, and a check that only runs when
 * the app does is honest about it. Throttled, because a sync pass can come every few seconds and a quote is
 * cached for a minute by the server anyway.
 *
 * A symbol whose price cannot be had is skipped, never read as a drop. An alert is marked fired **before** the
 * notification is scheduled, so a failure to notify cannot make it fire again on the next pass.
 */

export const CHECK_INTERVAL_MS = 5 * 60 * 1000;
export const ALERT_CHANNEL = 'price-alerts';

let lastCheck = 0;

/** Forget when the last check ran. For tests. */
export function resetAlertThrottleForTests(): void {
  lastCheck = 0;
}

export function alertTitle(alert: PriceAlert): string {
  return fillTemplate(COPY.invest.alertTitle, { symbol: alert.symbol });
}

export function alertBody(alert: PriceAlert, close: number): string {
  return fillTemplate(
    alert.direction === 'above' ? COPY.invest.alertBodyAbove : COPY.invest.alertBodyBelow,
    {
      symbol: alert.symbol,
      close: formatDong(close),
      target: formatDong(alert.price),
    },
  );
}

export interface AlertCheckResult {
  readonly asked: number;
  readonly fired: readonly PriceAlert[];
}

export async function checkPriceAlerts(
  api: Pick<ApiClient, 'getMarketQuote'>,
  database: SqliteDatabase,
  now: Date = new Date(),
  notify: (alert: PriceAlert, close: number) => Promise<void> = scheduleNow,
): Promise<AlertCheckResult> {
  if (now.getTime() - lastCheck < CHECK_INTERVAL_MS) return { asked: 0, fired: [] };

  const alerts = await readAlerts(database);
  const symbols = waitingSymbols(alerts);
  if (symbols.length === 0) return { asked: 0, fired: [] };
  lastCheck = now.getTime();

  const closes: Record<string, number | null> = {};
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        closes[symbol] = (await api.getMarketQuote(symbol)).data.close;
      } catch {
        closes[symbol] = null;
      }
    }),
  );

  const tripped = trippedBy(alerts, closes);
  if (tripped.length === 0) return { asked: symbols.length, fired: [] };

  await markFired(
    database,
    tripped.map((alert) => ({ id: alert.id, close: closes[alert.symbol] as number })),
    now,
  );
  for (const alert of tripped) {
    try {
      await notify(alert, closes[alert.symbol] as number);
    } catch {
      // Marked fired already; it is in the list for the person to see.
    }
  }
  return { asked: symbols.length, fired: tripped };
}

async function scheduleNow(alert: PriceAlert, close: number): Promise<void> {
  if (!(await hasPermission())) return;
  await ensureChannel(ALERT_CHANNEL, 'Price alerts');
  await Notifications.scheduleNotificationAsync({
    content: { title: alertTitle(alert), body: alertBody(alert, close) },
    trigger: Platform.OS === 'android' ? { channelId: ALERT_CHANNEL } : null,
  });
}
