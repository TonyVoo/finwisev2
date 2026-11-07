import { z } from 'zod';
import { MarketSymbol } from './market.js';

/**
 * The person's investing settings, kept on the server so a second phone has the same watchlist and alerts, and so the
 * server can notice a price reaching an alert while the app is closed. One document per account, replaced as a whole.
 *
 * It is replaced under optimistic concurrency: a write names the `version` it was made against, and is applied only
 * if that is still the current one. A device that loses the race gets the current document back (`applied: false`),
 * merges, and writes again, so two phones editing at once never silently drop each other's alerts.
 */

export const WATCHLIST_MAX = 20;
export const ALERTS_MAX = 20;

export const AlertDirection = z.enum(['above', 'below']);

export const InvestingAlert = z.strictObject({
  id: z.string().min(1).max(64),
  symbol: MarketSymbol,
  direction: AlertDirection,
  /** Dong per share, a whole number. */
  price: z.number().int().min(1).max(1_000_000_000),
  /** When it fired (ISO), or null while it waits. Fired alerts stay until the person removes them. */
  firedAt: z.string().max(40).nullable(),
  firedPrice: z.number().int().min(0).max(1_000_000_000).nullable(),
});

export const InvestingSettings = z.strictObject({
  watchlist: z.array(MarketSymbol).max(WATCHLIST_MAX),
  alerts: z.array(InvestingAlert).max(ALERTS_MAX),
  /** 0 until the first write. */
  version: z.number().int().min(0),
});

export const InvestingPutRequest = z.strictObject({
  watchlist: z.array(MarketSymbol).max(WATCHLIST_MAX),
  alerts: z.array(InvestingAlert).max(ALERTS_MAX),
  baseVersion: z.number().int().min(0),
});

export const InvestingPutResponse = z.strictObject({
  data: InvestingSettings,
  /** False when `baseVersion` was stale: `data` is then the current document and nothing was written. */
  applied: z.boolean(),
});
export const InvestingResponse = z.strictObject({ data: InvestingSettings });

/** An Expo push token, which the server uses to tell this device a price alert fired. */
export const PushTokenRequest = z.strictObject({
  token: z
    .string()
    .min(10)
    .max(200)
    .regex(/^Expo(nent)?PushToken\[[^\]]+\]$/, 'Not an Expo push token.'),
  platform: z.enum(['ios', 'android']),
});

export type AlertDirection = z.infer<typeof AlertDirection>;
export type InvestingAlert = z.infer<typeof InvestingAlert>;
export type InvestingSettings = z.infer<typeof InvestingSettings>;
export type InvestingPutRequest = z.infer<typeof InvestingPutRequest>;
export type InvestingPutResponse = z.infer<typeof InvestingPutResponse>;
export type InvestingResponse = z.infer<typeof InvestingResponse>;
export type PushTokenRequest = z.infer<typeof PushTokenRequest>;
