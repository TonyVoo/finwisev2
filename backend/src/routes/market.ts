import {
  MarketBriefResponse,
  MarketNewsResponse,
  MarketQuoteResponse,
  MarketSignalResponse,
  MarketSymbol,
  MarketSymbolsQuery,
  PositionSizeRequest,
  PositionSizeResponse,
} from '@expense-tracker/shared';
import { Router, type Request, type Response } from 'express';
import { problems } from '../errors.ts';
import { toIssues } from '../http/issues.ts';
import { sendJson } from '../http/respond.ts';
import { validateBody, validateQuery, validatedQuery } from '../middleware/validate.ts';
import {
  getMarketBrief,
  getMarketNews,
  getMarketQuote,
  getMarketSignal,
  getPositionSize,
} from '../services/marketService.ts';

/**
 * `/v1/market/*` - Vietnamese stock data for the Investing tab.
 *
 * Authenticated like everything under `/v1`: it spends the server's outbound budget on the
 * market service, so it is not a public relay. Reads and writes nothing of the person's.
 */
export const marketRouter = Router();

/** The path symbol, upper-cased and checked. Anything else is a 400, never forwarded. */
function symbolOf(req: Request): string {
  const raw = req.params['symbol'];
  const parsed = MarketSymbol.safeParse(typeof raw === 'string' ? raw.toUpperCase() : raw);
  if (!parsed.success)
    throw problems.validation('Symbol failed validation.', toIssues(parsed.error));
  return parsed.data;
}

marketRouter.get('/market/quotes/:symbol', async (req: Request, res: Response) => {
  const data = await getMarketQuote(symbolOf(req));
  sendJson(res, 200, MarketQuoteResponse, { data });
});

marketRouter.get('/market/signals/:symbol', async (req: Request, res: Response) => {
  const data = await getMarketSignal(symbolOf(req));
  sendJson(res, 200, MarketSignalResponse, { data });
});

/** The tickers of `?symbols=`, upper-cased and checked by `MarketSymbolsQuery`. */
function symbolsOf(res: Response): string[] {
  const query = validatedQuery(res, MarketSymbolsQuery);
  return query.symbols.split(',').map((part) => part.trim().toUpperCase());
}

marketRouter.get(
  '/market/news',
  validateQuery(MarketSymbolsQuery),
  async (_req: Request, res: Response) => {
    const data = await getMarketNews(symbolsOf(res));
    sendJson(res, 200, MarketNewsResponse, { data });
  },
);

marketRouter.get(
  '/market/brief',
  validateQuery(MarketSymbolsQuery),
  async (_req: Request, res: Response) => {
    const data = await getMarketBrief(symbolsOf(res));
    sendJson(res, 200, MarketBriefResponse, { data });
  },
);

marketRouter.post(
  '/market/position-size',
  validateBody(PositionSizeRequest),
  async (req: Request, res: Response) => {
    const data = await getPositionSize(req.body as PositionSizeRequest);
    sendJson(res, 200, PositionSizeResponse, { data });
  },
);
