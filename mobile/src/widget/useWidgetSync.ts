import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { COPY } from '../copy/strings';
import { useDatabase } from '../db/DatabaseProvider';
import { useUserCurrency } from '../db/hooks';
import { daySpendTotal } from '../db/queries';
import { formatMoney } from '../lib/money';
import { clearHomeWidget, updateHomeWidget } from './native';

/**
 * Keeps the home-screen widget's number in step with today's spending: written whenever the total, the currency
 * or the language changes, and forgotten when the signed-in part of the app goes away (signing out). The widget
 * shows only what is written here.
 */
export function useWidgetSync(today: string): void {
  const database = useDatabase();
  const currency = useUserCurrency().data ?? null;
  const total = useQuery({
    queryKey: ['local', 'expenses', 'day', today] as const,
    queryFn: () => daySpendTotal(database, today),
  });

  const amount =
    total.data !== undefined && currency !== null ? formatMoney(total.data, currency) : null;
  const { today: todayLabel, add } = COPY.homeWidget;
  useEffect(() => {
    if (amount !== null) updateHomeWidget(todayLabel, amount, add);
  }, [amount, todayLabel, add]);

  useEffect(() => () => clearHomeWidget(), []);
}
