import {
  MARKET_QUOTE_SERIES_MAX,
  MarketBriefImpact,
  type AssistantAnswer,
  type AssistantAskRequest,
  type MarketBrief,
  type MarketNews,
  MarketSignalLabel,
  type MarketQuote,
  type MarketSignal,
  type PositionSize,
  type PositionSizeRequest,
} from '@expense-tracker/shared';
import { z } from 'zod';
import { getConfig } from '../config.ts';
import { isApiProblem, problems } from '../errors.ts';
import { logger } from '../logger.ts';

/**
 * Vietnamese market data, fetched from the market service and handed to the device.
 *
 * Same shape as `ratesService`: the only code that touches that network is here, behind a few
 * functions; the device asks *this* server, so the service can move without an app release.
 *
 * - **Not configured is not an error to hide.** With `MARKET_API_URL` unset every call answers
 *   `503 market_unavailable`, and the Investing tab says so; nothing else depends on it.
 * - **The upstream's wording never reaches the client.** A failure is logged here with its reason
 *   and answered as the single `market_unavailable`, since a message can name a key or an address.
 * - **Short caches, and a failure is never cached.** A quote for a minute, a signal for five (it
 *   moves once a day). Bounded by a timeout so a hung service cannot hold a request open.
 * - **Upstream output is parsed, not trusted.** A shape that drifted becomes `market_unavailable`
 *   here rather than a crash on a phone.
 */

const TIMEOUT_MS = 8000;
const QUOTE_TTL_MS = 60 * 1000;
const SIGNAL_TTL_MS = 5 * 60 * 1000;
const NEWS_TTL_MS = 5 * 60 * 1000;
const BRIEF_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

interface CacheEntry {
  readonly value: unknown;
  readonly expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Forget everything. For tests, which must not see each other's answers. */
export function clearMarketCache(): void {
  cache.clear();
}

function unavailable(reason: string, context: Record<string, unknown> = {}) {
  logger.warn('market service unavailable', { reason, ...context });
  return problems.marketUnavailable();
}

async function call(
  path: string,
  init: { method: 'GET' } | { method: 'POST'; body: unknown },
): Promise<unknown> {
  const { url, apiKey } = getConfig().market;
  if (url === undefined) throw unavailable('MARKET_API_URL is not set');

  const headers: Record<string, string> = { accept: 'application/json' };
  if (apiKey !== undefined) headers['x-api-key'] = apiKey;
  if (init.method === 'POST') headers['content-type'] = 'application/json';

  try {
    const response = await fetch(new URL(path, url), {
      method: init.method,
      headers,
      body: init.method === 'POST' ? JSON.stringify(init.body) : null,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 422) return { invalid: true };
    // The service has no prices for that ticker: the person's typo, not an outage.
    if (response.status === 404) throw problems.notFound('No stock with that symbol.');
    if (!response.ok) throw unavailable(`service answered ${response.status}`, { path });
    return await response.json();
  } catch (error) {
    if (isApiProblem(error)) throw error;
    throw unavailable(error instanceof Error ? error.message : 'request failed', { path });
  }
}

async function cached<T>(
  key: string,
  ttlMs: number,
  now: number,
  load: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;
  const value = await load();
  if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
  cache.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

const num = z.number().finite();

const UpstreamQuote = z.object({
  symbol: z.string(),
  source: z.string(),
  demo: z.boolean(),
  as_of: z.string(),
  close: num,
  prev_close: num.nullable(),
  change_pct: num.nullable(),
  high_52w: num,
  low_52w: num,
  series: z.array(z.object({ date: z.string(), close: num, volume: num })),
});

const UpstreamSignal = z.object({
  symbol: z.string(),
  source: z.string(),
  demo: z.boolean(),
  label: z.string(),
  score: num.nullable(),
  close: num.nullable().optional(),
  suggested_stop: num.nullable().optional(),
  stop_pct: num.nullable().optional(),
  liquid: z.boolean(),
  reasons: z.array(z.string()),
  warnings: z.array(z.string()),
  disclaimer: z.string(),
});

const UpstreamPositionSize = z.object({
  shares: z.number().int(),
  lots: z.number().int().optional(),
  cost: num.optional(),
  alloc_pct: num.optional(),
  max_loss: num.optional(),
  max_loss_pct: num.optional(),
  breakeven: num.optional(),
  limited_by: z.string(),
  message: z.string().optional(),
  disclaimer: z.string(),
});

function parseOrThrow<S extends z.ZodType>(schema: S, body: unknown, path: string): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw unavailable('service answered something unusable', { path });
  return parsed.data;
}

export async function getMarketQuote(
  symbol: string,
  now: number = Date.now(),
): Promise<MarketQuote> {
  const path = `/v1/quotes/${symbol}?days=${MARKET_QUOTE_SERIES_MAX}`;
  return cached(`quote|${symbol}`, QUOTE_TTL_MS, now, async () => {
    const q = parseOrThrow(UpstreamQuote, await call(path, { method: 'GET' }), path);
    return {
      symbol: q.symbol,
      source: q.source,
      demo: q.demo,
      asOf: q.as_of,
      close: q.close,
      prevClose: q.prev_close,
      changePct: q.change_pct,
      high52w: q.high_52w,
      low52w: q.low_52w,
      series: q.series.slice(-MARKET_QUOTE_SERIES_MAX),
    };
  });
}

export async function getMarketSignal(
  symbol: string,
  now: number = Date.now(),
): Promise<MarketSignal> {
  const path = `/v1/signals/${symbol}`;
  return cached(`signal|${symbol}`, SIGNAL_TTL_MS, now, async () => {
    const s = parseOrThrow(UpstreamSignal, await call(path, { method: 'GET' }), path);
    const label = MarketSignalLabel.safeParse(s.label);
    return {
      symbol: s.symbol,
      source: s.source,
      demo: s.demo,
      label: label.success ? label.data : 'N/A',
      score: s.score,
      close: s.close ?? null,
      suggestedStop: s.suggested_stop ?? null,
      stopPct: s.stop_pct ?? null,
      liquid: s.liquid,
      reasons: s.reasons,
      warnings: s.warnings,
      disclaimer: s.disclaimer,
    };
  });
}

const UpstreamNews = z.object({
  items: z.array(
    z.object({
      symbol: z.string(),
      source: z.string(),
      title: z.string(),
      link: z.string(),
      published: z.string(),
    }),
  ),
});

const UpstreamBrief = z.object({
  overview: z.string(),
  worldLink: z.string(),
  topNews: z.array(
    z.object({
      title: z.string(),
      symbols: z.array(z.string()),
      impact: z.string(),
      level: z.string(),
      comment: z.string(),
    }),
  ),
  notes: z.array(z.object({ symbol: z.string(), comment: z.string() })),
  risks: z.array(z.string()),
  confidence: z.string(),
  disclaimer: z.string(),
});

/** Only links a person can safely open: a feed is someone else's data, and `javascript:` is a scheme too. */
function isWebLink(link: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(link);
}

/** Headlines that name the stocks, from the market service's news feeds. Cached for five minutes. */
export async function getMarketNews(
  symbols: readonly string[],
  now: number = Date.now(),
): Promise<MarketNews> {
  const list = [...new Set(symbols)].sort();
  const path = `/v1/news?${new URLSearchParams({ symbols: list.join(',') }).toString()}`;
  return cached(`news|${list.join(',')}`, NEWS_TTL_MS, now, async () => {
    const n = parseOrThrow(UpstreamNews, await call(path, { method: 'GET' }), path);
    return {
      items: n.items
        .filter((item) => isWebLink(item.link) && /^[A-Z0-9]{1,10}$/.test(item.symbol))
        .slice(0, 200),
    };
  });
}

/**
 * The morning brief for the stocks, written by a model. Cached for thirty minutes per set of stocks: it costs a
 * model call, and a brief does not change that fast. Unavailable (503) when the service has no model configured.
 */
export async function getMarketBrief(
  symbols: readonly string[],
  now: number = Date.now(),
): Promise<MarketBrief> {
  const list = [...new Set(symbols)].sort();
  const path = `/v1/brief?${new URLSearchParams({ symbols: list.join(',') }).toString()}`;
  return cached(`brief|${list.join(',')}`, BRIEF_TTL_MS, now, async () => {
    const b = parseOrThrow(UpstreamBrief, await call(path, { method: 'GET' }), path);
    return {
      ...b,
      topNews: b.topNews.slice(0, 6).map((item) => {
        const impact = MarketBriefImpact.safeParse(item.impact);
        return { ...item, impact: impact.success ? impact.data : 'trung_tinh' };
      }),
    };
  });
}

/** Never cached: it is arithmetic on the person's own numbers. */
export async function getPositionSize(request: PositionSizeRequest): Promise<PositionSize> {
  const path = '/v1/risk/position-size';
  const body = {
    capital: request.capital,
    entry: request.entry,
    stop: request.stop,
    ...(request.riskPct === undefined ? {} : { risk_pct: request.riskPct }),
    ...(request.maxAlloc === undefined ? {} : { max_alloc: request.maxAlloc }),
  };
  const raw = await call(path, { method: 'POST', body });
  if (typeof raw === 'object' && raw !== null && 'invalid' in raw) {
    throw problems.validation('Those numbers do not make a valid trade.');
  }
  const p = parseOrThrow(UpstreamPositionSize, raw, path);
  return {
    shares: p.shares,
    lots: p.lots ?? p.shares / 100,
    cost: p.cost ?? 0,
    allocPct: p.alloc_pct ?? 0,
    maxLoss: p.max_loss ?? 0,
    maxLossPct: p.max_loss_pct ?? 0,
    breakeven: p.breakeven ?? 0,
    limitedBy: p.limited_by,
    message: p.message ?? null,
    disclaimer: p.disclaimer,
  };
}

const UpstreamAssistant = z.object({ answer: z.string().min(1), disclaimer: z.string() });

/**
 * One answer about the person's own money. Never cached and never logged: the question and the digest are
 * theirs, and a repeat of the same words is not the same moment. A longer timeout than a quote, since a model
 * is writing.
 */
export async function askAssistant(request: AssistantAskRequest): Promise<AssistantAnswer> {
  const path = '/v1/assistant';
  const raw = await call(path, { method: 'POST', body: request });
  if (typeof raw === 'object' && raw !== null && 'invalid' in raw) {
    throw problems.validation('That question could not be answered.');
  }
  const a = parseOrThrow(UpstreamAssistant, raw, path);
  return { answer: a.answer, disclaimer: a.disclaimer };
}
