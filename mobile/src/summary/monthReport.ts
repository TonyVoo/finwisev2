import type { ApiClient } from '../api/client';
import type { TradeListItem } from '../db/queries';
import { buildPortfolio, summarise } from '../invest/portfolioModel';
import type { MonthReportStocks } from './monthReportHtml';

/**
 * The stocks block of the monthly report: what the holdings are worth now and the result not yet booked, from the
 * trades and the last close of each holding. A holding whose price cannot be had is listed without a value and left
 * out of the result, never counted as a loss; with no price at all the block is left out rather than show zeros.
 */
export async function buildStocksBlock(
  api: Pick<ApiClient, 'getMarketQuote'>,
  trades: readonly TradeListItem[],
): Promise<MonthReportStocks | null> {
  const book = buildPortfolio(trades);
  if (book.open.length === 0) return null;

  const closes: Record<string, number | null> = {};
  await Promise.all(
    book.open.map(async (position) => {
      try {
        closes[position.symbol] = (await api.getMarketQuote(position.symbol)).data.close;
      } catch {
        closes[position.symbol] = null;
      }
    }),
  );
  if (Object.values(closes).every((close) => close === null)) return null;

  const totals = summarise(book, closes);
  return {
    worthDong: totals.worth,
    unrealizedDong: totals.unrealized,
    holdings: book.open.map((position) => {
      const close = closes[position.symbol];
      return {
        symbol: position.symbol,
        valueDong: close === null || close === undefined ? null : position.quantity * close,
      };
    }),
  };
}
