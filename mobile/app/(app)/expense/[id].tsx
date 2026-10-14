import { useLocalSearchParams } from 'expo-router';
import { ExpenseFormScreen } from '@/expenses/ExpenseFormScreen';

/**
 * Edit expense - `docs/design/06-expense-form.md`, edit mode.
 *
 * The same screen as `new.tsx` with the row's id passed in. An id that is absent or
 * tombstoned - a deep link, or a row deleted on another device - lands on the screen's
 * `Expense not found` state rather than a crash or an empty form.
 */
export default function EditExpenseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ExpenseFormScreen expenseId={id} />;
}
