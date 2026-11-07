import { z } from 'zod';
import { getConfig } from '../config.ts';
import { logger } from '../logger.ts';

/**
 * Sends a push through Expo's service. Nothing here knows what the message is about.
 *
 * Returns the tokens Expo says are no longer valid (`DeviceNotRegistered`), so the caller can forget them. A failure
 * to reach Expo is logged and answered as "none invalid": the caller has already recorded that the alert fired, and
 * one missed push is better than the same alert pushed again on every pass.
 */

const TIMEOUT_MS = 8000;

export interface PushMessage {
  readonly to: string;
  readonly title: string;
  readonly body: string;
  readonly data?: Record<string, unknown>;
}

const Ticket = z.object({
  status: z.enum(['ok', 'error']),
  details: z.object({ error: z.string().optional() }).passthrough().optional(),
});
const Tickets = z.object({ data: z.array(Ticket) });

export async function sendPush(messages: readonly PushMessage[]): Promise<string[]> {
  if (messages.length === 0) return [];
  const { pushUrl } = getConfig().alerts;
  try {
    const response = await fetch(pushUrl, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(
        messages.map((m) => ({
          ...m,
          sound: 'default',
          channelId: 'price-alerts',
          priority: 'high',
        })),
      ),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn('push service answered an error', { status: response.status });
      return [];
    }
    const parsed = Tickets.safeParse(await response.json());
    if (!parsed.success) {
      logger.warn('push service answered an unexpected shape');
      return [];
    }
    const invalid: string[] = [];
    parsed.data.data.forEach((ticket, index) => {
      const to = messages[index]?.to;
      if (
        ticket.status === 'error' &&
        ticket.details?.error === 'DeviceNotRegistered' &&
        to !== undefined
      ) {
        invalid.push(to);
      }
    });
    return invalid;
  } catch (error) {
    logger.warn('push service unreachable', {
      reason: error instanceof Error ? error.message : 'request failed',
    });
    return [];
  }
}
