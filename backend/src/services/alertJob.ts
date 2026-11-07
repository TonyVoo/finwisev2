import type { InvestingAlert } from '@expense-tracker/shared';
import { logger } from '../logger.ts';
import {
  forgetPushTokens,
  listWaiting,
  markAlertsFired,
  pushTokensOf,
} from './investingService.ts';
import { getMarketQuote } from './marketService.ts';
import { sendPush } from './pushService.ts';

/**
 * Looks at every waiting price alert and pushes the ones a price has reached, so an alert works with the app closed.
 *
 * The same rules as the device's own check (`mobile/src/invest/checkAlerts.ts`):
 * - A symbol whose price cannot be had is skipped, never read as a drop.
 * - An alert is marked fired **before** it is pushed, and only if nobody wrote the document in between (a
 *   compare-and-set), so two instances of the job, or a person editing at that moment, cannot make it fire twice.
 *   A failed push is a missed push, not a repeated one.
 * - Fired alerts stay in the list until the person removes them.
 */

export function tripped(alert: InvestingAlert, close: number): boolean {
  if (alert.firedAt !== null) return false;
  return alert.direction === 'above' ? close >= alert.price : close <= alert.price;
}

const dong = (value: number): string => `${Math.round(value).toLocaleString('vi-VN')} ₫`;

export function alertText(alert: InvestingAlert, close: number): { title: string; body: string } {
  return {
    title: `${alert.symbol} đã chạm giá bạn đặt`,
    body:
      alert.direction === 'above'
        ? `${alert.symbol} đóng cửa ${dong(close)}, từ ${dong(alert.price)} trở lên.`
        : `${alert.symbol} đóng cửa ${dong(close)}, từ ${dong(alert.price)} trở xuống.`,
  };
}

export interface AlertPassResult {
  readonly accounts: number;
  readonly fired: number;
}

export async function runAlertPass(now: Date = new Date()): Promise<AlertPassResult> {
  const waiting = await listWaiting();
  if (waiting.length === 0) return { accounts: 0, fired: 0 };

  // One quote per symbol, however many accounts watch it.
  const symbols = [
    ...new Set(
      waiting.flatMap((w) =>
        w.settings.alerts.filter((a) => a.firedAt === null).map((a) => a.symbol),
      ),
    ),
  ];
  const closes = new Map<string, number>();
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        closes.set(symbol, (await getMarketQuote(symbol)).close);
      } catch {
        // No price: nothing to say about this symbol this time.
      }
    }),
  );

  let fired = 0;
  for (const { userId, settings } of waiting) {
    const hits = settings.alerts.filter((a) => {
      const close = closes.get(a.symbol);
      return close !== undefined && tripped(a, close);
    });
    if (hits.length === 0) continue;

    const marks = new Map(
      hits.map(
        (a) =>
          [a.id, { at: now.toISOString(), price: Math.round(closes.get(a.symbol) ?? 0) }] as const,
      ),
    );
    if (!(await markAlertsFired(userId, settings, marks))) continue;
    fired += hits.length;

    const tokens = await pushTokensOf(userId);
    const messages = hits.flatMap((a) =>
      tokens.map((to) => ({
        to,
        ...alertText(a, closes.get(a.symbol) ?? 0),
        data: { type: 'price-alert', symbol: a.symbol },
      })),
    );
    await forgetPushTokens(await sendPush(messages));
  }
  if (fired > 0) logger.info('price alerts fired', { accounts: waiting.length, fired });
  return { accounts: waiting.length, fired };
}

/** Starts the job on its interval; returns what stops it. Does nothing when the interval is 0. */
export function startAlertJob(intervalSeconds: number): () => void {
  if (intervalSeconds <= 0) return () => undefined;
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runAlertPass()
      .catch((error: unknown) => {
        logger.error('alert pass failed', {
          error: error instanceof Error ? error.message : 'unknown',
        });
      })
      .finally(() => {
        running = false;
      });
  }, intervalSeconds * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
