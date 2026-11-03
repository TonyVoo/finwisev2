import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useDatabase } from '../db/DatabaseProvider';
import { monthCategorySpend, monthlyIncomeTotals, monthlyTotals } from '../db/queries';
import { buildYearReport, type YearReport } from './yearReport';

/** One year's report, read from local SQLite: the monthly totals and the per-category sums for it and for the year before. */
export function useYearReport(year: number, todayMonth: string): UseQueryResult<YearReport> {
  const database = useDatabase();
  return useQuery({
    queryKey: ['local', 'year', year, todayMonth] as const,
    queryFn: async () => {
      const range = (y: number) => ({ from: `${y}-01-01`, to: `${y}-12-31` });
      const [spendByMonth, incomeByMonth, categories, previousCategories] = await Promise.all([
        monthlyTotals(database, `${year}-01`, `${year}-12`),
        monthlyIncomeTotals(database, `${year}-01`, `${year}-12`),
        monthCategorySpend(database, range(year)),
        monthCategorySpend(database, range(year - 1)),
      ]);
      return buildYearReport({
        year,
        todayMonth,
        spendByMonth,
        incomeByMonth,
        categories,
        previousCategories,
      });
    },
  });
}
