import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { useDatabase } from '../db/DatabaseProvider';
import { queryKeys } from '../query/keys';
import { type ReceiptRow, readReceipt } from './receiptStore';

/** One expense's receipt row, or null. Re-read whenever any local write or sync lands. */
export function useReceipt(expenseId: string | null): UseQueryResult<ReceiptRow | null> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.receipts.detail(expenseId ?? ''),
    queryFn: () => readReceipt(database, expenseId ?? ''),
    enabled: expenseId !== null,
  });
}
