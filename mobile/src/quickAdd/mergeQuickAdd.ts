import type { QuickAddSuggestion } from '@expense-tracker/shared';
import { matchCategory } from '../receipts/receiptSuggestion';
import type { QuickAddReading } from './parseQuickAdd';

/**
 * The server's reading beside the phone's own (`docs/design/15-quick-add.md`, "Merging"): the phone keeps
 * everything it was sure of, and the model fills only what the phone left empty. So the model can add a
 * date, an amount the phone could not settle, or a cleaner note, but it can never overrule a clear `45k`.
 *
 * Two fields are not simply "first one wins". The note: the model's has the amount, the date and the
 * filler words already taken out, and the phone's, when it was unsure, may still hold them ("Coffee 4.50
 * tip 1.00"), so the model's is preferred when there is one. The type: the phone's `expense` is a default,
 * not a finding, so only the phone's `income` is something the model must not undo.
 */
export function mergeQuickAdd(
  rules: QuickAddReading,
  model: QuickAddSuggestion,
  categories: readonly { readonly id: string; readonly name: string }[],
): QuickAddReading {
  const amountMinor = rules.amountMinor ?? model.amountMinor;
  const modelNote =
    model.note === null ? null : model.note.charAt(0).toLocaleUpperCase() + model.note.slice(1);
  return {
    type: rules.type === 'income' ? 'income' : (model.type ?? rules.type),
    amountMinor,
    date: rules.date ?? model.date,
    note: modelNote ?? rules.note,
    categoryId: rules.categoryId ?? matchCategory(model.category, categories),
    confident: rules.confident || amountMinor !== null,
  };
}
