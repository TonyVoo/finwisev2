import { useMemo } from 'react';
import type { ApiClient } from '../api/client';
import {
  useGoalsList,
  useMonthCategorySpend,
  useMonthIncome,
  useMonthlyLimit,
  useSpendTrend,
  useTrades,
  useUserCurrency,
} from '../db/hooks';
import { buildPortfolio } from '../invest/portfolioModel';
import { usePortfolioQuotes } from '../invest/usePortfolioQuotes';
import type { MonthKey } from '../lib/calendar';
import { buildDigest, holdingOf } from './digest';

/**
 * The digest of what is on this device for `month`, as text, or null while any of it is still being read.
 * Prices come from the server like the portfolio's; a holding with no price is sent as unpriced.
 */
export function useDigest(
  api: Pick<ApiClient, 'getMarketQuote'>,
  month: MonthKey,
  online: boolean,
): { readonly text: string | null; readonly refresh: () => void } {
  const spend = useMonthCategorySpend(month);
  const income = useMonthIncome(month);
  const limit = useMonthlyLimit();
  const trend = useSpendTrend(month);
  const goals = useGoalsList();
  const currency = useUserCurrency();
  const trades = useTrades();

  const book = useMemo(() => buildPortfolio(trades.data ?? []), [trades.data]);
  const symbols = useMemo(() => book.open.map((p) => p.symbol), [book]);
  const quotes = usePortfolioQuotes(api, symbols, online);

  const ready =
    spend.data !== undefined &&
    income.data !== undefined &&
    trend.data !== undefined &&
    goals.data !== undefined &&
    currency.data !== undefined &&
    trades.data !== undefined &&
    quotes.status !== 'loading';

  const text = useMemo(() => {
    if (
      !ready ||
      spend.data === undefined ||
      income.data === undefined ||
      trend.data === undefined ||
      goals.data === undefined
    ) {
      return null;
    }
    return buildDigest({
      month,
      currency: currency.data ?? 'VND',
      locale: 'vi-VN',
      spend: spend.data,
      incomeMinor: income.data,
      limitMinor: limit.limitMinor,
      trend: trend.data,
      goals: goals.data,
      holdings: book.open.map((p) => holdingOf(p, quotes.closes[p.symbol] ?? null)),
      realized: book.realized,
      dividends: book.dividends,
    });
  }, [ready, month, spend.data, income.data, trend.data, goals.data, currency.data, limit.limitMinor, book, quotes.closes]);

  return { text, refresh: quotes.refresh };
}
