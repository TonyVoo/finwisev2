import { z } from 'zod';
import { CalendarDate } from './primitives.js';

/**
 * Vietnamese stock-market data for the Investing tab, fetched by the server from the market
 * service (`vn-stock-assistant`'s `api/`) and handed to the device.
 *
 * Nothing here is stored. Prices are VND per share and may be fractional only through the
 * float the upstream computes (ATR-based stops), so these are plain numbers, not minor
 * units: they are for display and for sizing a trade, never written to a ledger.
 *
 * `demo` is true when the upstream had no real prices and made some up. A client must say
 * so on screen; presenting invented numbers as real ones is the one thing this contract is
 * built to prevent.
 */

export const MARKET_DISCLAIMER = 'Công cụ hỗ trợ ra quyết định, không phải lời khuyên đầu tư.';

export const MarketSymbol = z
  .string()
  .regex(/^[A-Z0-9]{1,10}$/, 'must be 1-10 upper-case letters or digits')
  .describe('Ticker, such as `VNM` or `VNINDEX`.');

export const MARKET_QUOTE_SERIES_MAX = 260;

export const MarketQuotePoint = z.strictObject({
  date: CalendarDate,
  close: z.number().positive(),
  volume: z.number().nonnegative(),
});

export const MarketQuote = z.strictObject({
  symbol: MarketSymbol,
  source: z.string().describe('Where the prices came from: csv, vnstock, vndirect, cache or demo.'),
  demo: z.boolean().describe('True when the prices are simulated and must be labelled as such.'),
  asOf: CalendarDate,
  close: z.number().positive(),
  prevClose: z.number().positive().nullable(),
  changePct: z.number().nullable().describe('Fraction, 0.012 is +1.2%.'),
  high52w: z.number().positive(),
  low52w: z.number().positive(),
  series: z.array(MarketQuotePoint).max(MARKET_QUOTE_SERIES_MAX),
});

export const MarketSignalLabel = z.enum(['Mạnh', 'Khá', 'Trung tính', 'Yếu', 'N/A']);

export const MarketSignal = z.strictObject({
  symbol: MarketSymbol,
  source: z.string(),
  demo: z.boolean(),
  label: MarketSignalLabel,
  score: z.number().min(0).max(100).nullable().describe('Null when there is too little history.'),
  close: z.number().positive().nullable(),
  suggestedStop: z.number().positive().nullable().describe('Close minus two ATR.'),
  stopPct: z.number().nullable(),
  liquid: z.boolean(),
  reasons: z.array(z.string()),
  warnings: z.array(z.string()),
  disclaimer: z.string(),
});

export const PositionSizeRequest = z
  .strictObject({
    capital: z.number().positive().max(1e13),
    entry: z.number().positive().max(1e9),
    stop: z.number().positive().max(1e9),
    riskPct: z
      .number()
      .gt(0)
      .max(0.1)
      .optional()
      .describe('Share of capital to risk. Default 1.5%.'),
    maxAlloc: z
      .number()
      .gt(0)
      .max(1)
      .optional()
      .describe('Largest share of capital in one stock. Default 30%.'),
  })
  .refine((v) => v.stop < v.entry, { error: '`stop` must be below `entry`', path: ['stop'] });

export const PositionSize = z.strictObject({
  shares: z.number().int().nonnegative().describe('A multiple of 100 (one lot), or 0.'),
  lots: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
  allocPct: z.number().nonnegative(),
  maxLoss: z.number().nonnegative(),
  maxLossPct: z.number().nonnegative(),
  breakeven: z.number().nonnegative(),
  limitedBy: z.string(),
  message: z.string().nullable().describe('Why no lot fits, when `shares` is 0.'),
  disclaimer: z.string(),
});

export const MARKET_NEWS_SYMBOLS_MAX = 20;

/**
 * `?symbols=VNM,FPT`: one to twenty tickers, comma separated. Kept as the raw string on the wire and split by the
 * handler, so the contract is exactly what a client sends.
 */
export const MarketSymbolsQuery = z.strictObject({
  symbols: z
    .string()
    .refine(
      (value) => {
        const parts = value.split(',');
        return (
          parts.length >= 1 &&
          parts.length <= MARKET_NEWS_SYMBOLS_MAX &&
          parts.every((part) => MarketSymbol.safeParse(part.trim().toUpperCase()).success)
        );
      },
      { error: 'one to twenty tickers, separated by commas' },
    )
    .describe('Comma-separated tickers, such as `VNM,FPT`.'),
});

/** A headline that names the stock in its title or summary, from a Vietnamese financial news feed. */
export const MarketNewsItem = z.strictObject({
  symbol: MarketSymbol.describe('The stock the headline names.'),
  source: z.string(),
  title: z.string(),
  link: z.url().describe('Always an http(s) link, never any other scheme.'),
  published: z.string().describe('As the feed wrote it; not a normalised timestamp.'),
});

export const MarketNews = z.strictObject({ items: z.array(MarketNewsItem).max(200) });

export const MarketBriefImpact = z.enum(['tich_cuc', 'tieu_cuc', 'trung_tinh']);

/**
 * A morning brief written by a language model from headlines, world markets and the stocks' screening scores. The
 * text is in Vietnamese whatever the app's language, and the client must say it was written by AI.
 */
export const MarketBrief = z.strictObject({
  overview: z.string(),
  worldLink: z.string(),
  topNews: z
    .array(
      z.strictObject({
        title: z.string(),
        symbols: z.array(z.string()),
        impact: MarketBriefImpact,
        level: z.string(),
        comment: z.string(),
      }),
    )
    .max(6),
  notes: z.array(z.strictObject({ symbol: z.string(), comment: z.string() })),
  risks: z.array(z.string()),
  confidence: z.string(),
  disclaimer: z.string(),
});

/** A question about the person's own money, with the digest of their figures it is answered from. */
export const ASSISTANT_QUESTION_MAX = 500;
export const ASSISTANT_CONTEXT_MAX = 6000;
/** Recent turns, so a follow-up ("and last month?") can be understood. Oldest first. */
export const ASSISTANT_HISTORY_MAX = 4;
export const ASSISTANT_ANSWER_ECHO_MAX = 800;
export const AssistantTurn = z.strictObject({
  question: z.string().trim().min(1).max(ASSISTANT_QUESTION_MAX),
  answer: z.string().min(1).max(ASSISTANT_ANSWER_ECHO_MAX),
});
export const AssistantAskRequest = z.strictObject({
  question: z.string().trim().min(1).max(ASSISTANT_QUESTION_MAX),
  context: z.string().min(1).max(ASSISTANT_CONTEXT_MAX),
  history: z.array(AssistantTurn).max(ASSISTANT_HISTORY_MAX).optional(),
});
export const AssistantAnswer = z.strictObject({
  answer: z.string().min(1),
  disclaimer: z.string(),
});
export const AssistantAnswerResponse = z.strictObject({ data: AssistantAnswer });

export const MarketQuoteResponse = z.strictObject({ data: MarketQuote });
export const MarketSignalResponse = z.strictObject({ data: MarketSignal });
export const MarketNewsResponse = z.strictObject({ data: MarketNews });
export const MarketBriefResponse = z.strictObject({ data: MarketBrief });
export const PositionSizeResponse = z.strictObject({ data: PositionSize });

export type AssistantTurn = z.infer<typeof AssistantTurn>;
export type AssistantAskRequest = z.infer<typeof AssistantAskRequest>;
export type AssistantAnswer = z.infer<typeof AssistantAnswer>;
export type AssistantAnswerResponse = z.infer<typeof AssistantAnswerResponse>;
export type MarketQuotePoint = z.infer<typeof MarketQuotePoint>;
export type MarketSymbolsQuery = z.infer<typeof MarketSymbolsQuery>;
export type MarketNewsItem = z.infer<typeof MarketNewsItem>;
export type MarketNews = z.infer<typeof MarketNews>;
export type MarketBrief = z.infer<typeof MarketBrief>;
export type MarketQuote = z.infer<typeof MarketQuote>;
export type MarketSignal = z.infer<typeof MarketSignal>;
export type PositionSizeRequest = z.infer<typeof PositionSizeRequest>;
export type PositionSize = z.infer<typeof PositionSize>;
export type MarketNewsResponse = z.infer<typeof MarketNewsResponse>;
export type MarketBriefResponse = z.infer<typeof MarketBriefResponse>;
export type MarketQuoteResponse = z.infer<typeof MarketQuoteResponse>;
export type MarketSignalResponse = z.infer<typeof MarketSignalResponse>;
export type PositionSizeResponse = z.infer<typeof PositionSizeResponse>;
