import { ExpenseFormScreen } from '@/expenses/ExpenseFormScreen';

/**
 * Add expense - `docs/design/06-expense-form.md`, add mode.
 *
 * Add and edit are **one screen, two modes** (§Route), distinguished by whether the route
 * carries an id. The route files are therefore this thin: everything they could hold would
 * be a difference between the two modes, and rule 1's table says there are only four of
 * them - the title, the prefill, the Delete button and Save's enablement. All four live in
 * `ExpenseFormScreen`, keyed off the id's absence.
 */
export default function NewExpenseScreen() {
  return <ExpenseFormScreen />;
}
