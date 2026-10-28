import { IconButton } from '../components/Chrome';
import { COPY } from '../copy/strings';
import type { ExpenseSelection } from './useExpenseSelection';

/**
 * The visible way to start picking expenses, for the many who will never find a long press. Only
 * in a household, and gone while picking (the selection bar has its own way out).
 */
export function SelectButton({
  selection,
  testID,
}: {
  readonly selection: ExpenseSelection;
  readonly testID: string;
}) {
  if (!selection.available || selection.active) return null;
  return (
    <IconButton
      icon="check-square"
      label={COPY.household.bulk.select}
      onPress={selection.start}
      testID={testID}
    />
  );
}
