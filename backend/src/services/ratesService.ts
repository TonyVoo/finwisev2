import type { ExchangeRate } from '@expense-tracker/shared';
import { RATE_PATTERN } from '@expense-tracker/shared';
import { isApiProblem, problems } from '../errors.ts';
import { logger } from '../logger.ts';

/**
 * Exchange rates, fetched from a free public provider and cached.
 *
 * The provider is Frankfurter, which republishes the European Central Bank's daily reference
 * rates: no key, no account, and nothing the app ships has to know about it - the device asks
 * *this* server, so the provider can change without an app release. It is also the reason this
 * is a service of its own: the only code that touches the network is here, behind one function.
 *
 * - **The server converts nothing and stores nothing.** It answers "what is the rate"; the
 *   device multiplies, at entry, with the rate the person saw (or typed over).
 * - **A failure is never cached.** A provider blip must not make a pair unavailable for the
 *   next six hours, so only a good answer is remembered.
 * - **A past day is cached for good** - the ECB does not restate a published rate - while
 *   "latest" is cached briefly, since it moves once a day.
 * - **Bounded by a timeout.** A provider that hangs would otherwise hold the request open for
 *   as long as the platform lets it, with the person watching a spinner on a form.
 */

const PROVIDER_URL = 'https://api.frankfurter.dev/v1';
const TIMEOUT_MS = 5000;
const LATEST_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2000;

interface CacheEntry {
  readonly rate: ExchangeRate;
  /** Null never expires. */
  readonly expiresAt: number | null;
}

const cache = new Map<string, CacheEntry>();

/** Forget everything. For tests, which must not see each other's answers. */
export function clearRateCache(): void {
  cache.clear();
}

function unavailable(reason: string, context: Record<string, unknown>) {
  logger.warn('exchange rate unavailable', { reason, ...context });
  return problems.ratesUnavailable();
}

/** A float from the provider as plain decimal text: no exponent, at most 8 places, trimmed. */
export function rateText(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const text = value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  // A rate that rounds to nothing at 8 places is not a usable rate.
  return RATE_PATTERN.test(text) && /[1-9]/.test(text) ? text : null;
}

export async function getExchangeRate(
  query: { from: string; to: string; date?: string | undefined },
  now: number = Date.now(),
): Promise<ExchangeRate> {
  const key = `${query.date ?? 'latest'}|${query.from}|${query.to}`;
  const hit = cache.get(key);
  if (hit && (hit.expiresAt === null || hit.expiresAt > now)) return hit.rate;

  const url = new URL(`${PROVIDER_URL}/${query.date ?? 'latest'}`);
  url.searchParams.set('base', query.from);
  url.searchParams.set('symbols', query.to);

  let body: unknown;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw unavailable(`provider answered ${response.status}`, query);
    body = await response.json();
  } catch (error) {
    // Our own `rates_unavailable` from the status check above passes straight through.
    if (isApiProblem(error)) throw error;
    throw unavailable(error instanceof Error ? error.message : 'request failed', query);
  }

  const parsed = body as { date?: unknown; rates?: Record<string, unknown> } | null;
  const raw = parsed?.rates?.[query.to];
  const date = parsed?.date;
  const text = typeof raw === 'number' ? rateText(raw) : null;
  if (text === null || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw unavailable('provider answered something unusable', query);
  }

  const rate: ExchangeRate = { from: query.from, to: query.to, date, rate: text };
  if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
  cache.set(key, { rate, expiresAt: query.date === undefined ? now + LATEST_TTL_MS : null });
  return rate;
}
