import { Text } from 'react-native';
import { ScreenPlaceholder } from '@/components/ScreenPlaceholder';
import { useLiveCategories, usePendingRecordCount } from '@/db/hooks';

/**
 * Home - the expense list, and the app's landing screen.
 *
 * The placeholder reads from SQLite through TanStack Query so the full path is exercised
 * on a device from the first build: migrations ran, the provider holds the handle, the
 * query key resolves, the rows come back. A scaffold that renders static text would
 * leave all of that unproven until the first feature task.
 */
export default function ExpenseListScreen() {
  const categories = useLiveCategories();
  const pending = usePendingRecordCount();

  return (
    <ScreenPlaceholder title="Expenses" spec="docs/design/04-expense-list.md">
      <Text>{`Local categories: ${categories.data?.length ?? 0}`}</Text>
      <Text>{`Pending records: ${pending.data ?? 0}`}</Text>
    </ScreenPlaceholder>
  );
}
