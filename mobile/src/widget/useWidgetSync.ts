import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useApiClient } from '../bootstrap/AppProviders';
import { COPY } from '../copy/strings';
import { useDatabase } from '../db/DatabaseProvider';
import { useTrades, useUserCurrency } from '../db/hooks';
import { daySpendTotal } from '../db/queries';
import { formatChange, formatDong } from '../invest/investModel';
import { buildPortfolio, summarise } from '../invest/portfolioModel';
import { usePortfolioQuotes } from '../invest/usePortfolioQuotes';
import { formatMoney } from '../lib/money';
import { clearHomeWidget, updateHomeWidget } from './native';
import { WIDGET_LINKS, type WidgetMode, portfolioWidgetText, readWidgetMode } from './widgetMode';

/** The query key of the widget's mode, so a change in Settings redraws the widget at once. */
export const WIDGET_MODE_KEY = ['local', 'widgetMode'] as const;

/**
 * Keeps the home-screen widget's number in step with what it is set to show: today's spending, or the portfolio's
 * value with how it is doing. Written whenever the figure, the currency, the mode or the language changes, and
 * forgotten when the signed-in part of the app goes away (signing out). The widget shows only what is written here.
 *
 * In portfolio mode it asks the market service for the last close of what is held; when none can be had the value
 * is the cost, and no change is shown, rather than a stale or made-up figure.
 */
export function useWidgetSync(today: string): void {
  const database = useDatabase();
  const api = useApiClient();
  const currency = useUserCurrency().data ?? null;
  const mode = useQuery({
    queryKey: WIDGET_MODE_KEY,
    queryFn: () => readWidgetMode(database),
  }).data as WidgetMode | undefined;

  const total = useQuery({
    queryKey: ['local', 'expenses', 'day', today] as const,
    queryFn: () => daySpendTotal(database, today),
    enabled: mode !== 'portfolio',
  });

  const trades = useTrades();
  const book = useMemo(() => buildPortfolio(trades.data ?? []), [trades.data]);
  const symbols = useMemo(() => book.open.map((position) => position.symbol), [book]);
  const quotes = usePortfolioQuotes(api, symbols, mode === 'portfolio');
  const totals = summarise(book, quotes.closes);
  const anyPrice = Object.values(quotes.closes).some((close) => close !== null);

  const spending =
    total.data !== undefined && currency !== null ? formatMoney(total.data, currency) : null;
  const { today: todayLabel, add, open } = COPY.homeWidget;
  const portfolioTitle = COPY.portfolio.title;
  const portfolioWorth = formatDong(totals.worth);
  const portfolioChange =
    anyPrice && totals.unrealizedPct !== null ? formatChange(totals.unrealizedPct) : '';
  const ready = mode === 'portfolio' ? quotes.status !== 'loading' : spending !== null;

  useEffect(() => {
    if (mode === undefined || !ready) return;
    if (mode === 'portfolio') {
      if (book.open.length === 0) return;
      const text = portfolioWidgetText(portfolioTitle, portfolioWorth, portfolioChange, open);
      updateHomeWidget(text.title, text.amount, text.button, text.link);
    } else if (spending !== null) {
      updateHomeWidget(todayLabel, spending, add, WIDGET_LINKS.spending);
    }
  }, [
    mode,
    ready,
    spending,
    todayLabel,
    add,
    open,
    portfolioTitle,
    portfolioWorth,
    portfolioChange,
    book.open.length,
  ]);

  useEffect(() => () => clearHomeWidget(), []);
}
