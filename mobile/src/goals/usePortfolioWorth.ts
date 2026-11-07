import { useMemo } from 'react';
import type { ApiClient } from '../api/client';
import { useTrades } from '../db/hooks';
import { buildPortfolio, summarise } from '../invest/portfolioModel';
import { usePortfolioQuotes } from '../invest/usePortfolioQuotes';

/**
 * What the holdings are worth now, in dong: priced ones at the last close, the rest at cost, so a missing price never
 * shrinks a goal. 0 until the trades are read, and when `enabled` is false nothing is asked of the server.
 */
export function usePortfolioWorth(
  api: Pick<ApiClient, 'getMarketQuote'>,
  enabled: boolean,
): number {
  const trades = useTrades();
  const book = useMemo(() => buildPortfolio(trades.data ?? []), [trades.data]);
  const symbols = useMemo(() => book.open.map((p) => p.symbol), [book]);
  const quotes = usePortfolioQuotes(api, symbols, enabled);
  return enabled ? summarise(book, quotes.closes).worth : 0;
}
