import { VALIDATION_COPY } from '../copy/strings';
import { isOutOfRangeAmount, isSavableAmount } from '../lib/amount';
import type { ExpenseDraft } from '../db/mutations';
import { changedExpenseFields, normaliseNote } from '../db/mutations';
import type { ExpenseDetail } from '../db/queries';

/**
 * Whether the form can be saved, and what to say when it cannot.
 *
 * `docs/design/06-expense-form.md` rule 6 pairs these two questions deliberately: "a
 * disabled button must state its reason", so there is no API here that answers the first
 * without the second. The reason is rendered on the amount's reserved line, which is part
 * of the screen's reading order - so the explanation is available without sight
 * (§Accessibility rule 6).
 *
 * Pure, and separated from the screen, because this is the logic with four interacting
 * inputs and a precedence between them.
 */

export interface SaveState {
  readonly canSave: boolean;
  /** Guidance - `text.tertiary`. Absent when Save is available. */
  readonly hint?: string;
  /** A genuine error - `danger.default`. Only ever the out-of-range case. */
  readonly error?: string;
}

export interface SaveStateInput {
  readonly amountMinor: number;
  /** The stored row in edit mode, or null in add mode. */
  readonly stored: ExpenseDetail | null;
  readonly draft: ExpenseDraft;
  /** False when the database holds no live category at all (rule 4, last bullet). */
  readonly hasCategories: boolean;
  /** Something outside the draft changed (the receipt photo): edit mode may then save. */
  readonly otherChange?: boolean;
}

/**
 * The precedence between the reasons Save is unavailable.
 *
 * Worked out in one place because the cases overlap - a first-run user with no categories
 * also has a zero amount, and a stored row that is out of range is also unchanged - and
 * the spec names a single message for each situation rather than a list.
 *
 * 1. **No categories.** It is the only reason the user cannot fix on this screen by
 *    typing, so it is the one worth saying first. `Add a category first.`
 * 2. **Out of range**, the one genuine amount *error*, which comes from a stored row
 *    rather than from typing (rule 8, last row). It outranks "nothing changed" because an
 *    out-of-range row that is also untouched must not be reported as merely unchanged -
 *    the user needs to know the amount is the problem.
 * 3. **Zero.** The initial state in add mode. `Enter an amount above zero.`
 * 4. **Nothing changed**, edit mode only. `Make a change to save.`
 */
export function saveState({
  amountMinor,
  stored,
  draft,
  hasCategories,
  otherChange = false,
}: SaveStateInput): SaveState {
  if (!hasCategories) {
    return { canSave: false, hint: VALIDATION_COPY.nocategories };
  }

  if (isOutOfRangeAmount(amountMinor)) {
    return { canSave: false, error: VALIDATION_COPY.amount.outOfRange };
  }

  if (!isSavableAmount(amountMinor)) {
    return { canSave: false, hint: VALIDATION_COPY.amount.zero };
  }

  // Edit mode only: add mode has nothing to compare against, and a nonzero amount is
  // already a change.
  // `otherChange`: something the draft does not hold has changed (the receipt photo), which
  // is a change worth saving even when every field is as stored.
  if (
    stored !== null &&
    !otherChange &&
    Object.keys(changedExpenseFields(stored, draft)).length === 0
  ) {
    return { canSave: false, hint: VALIDATION_COPY.nochange };
  }

  return { canSave: true };
}

/**
 * Whether the user has edited anything - what decides between closing immediately and
 * showing `Discard changes?` (rule 11).
 *
 * Expressed as "does the draft differ from the one the screen opened with", which answers
 * both modes with one rule. In add mode the opening draft is the prefill - zero, the
 * last-used category, today - so:
 *
 * - a nonzero amount is an edit, which is what the spec states outright;
 * - the **prefilled** category and today's date are not, so a user who opens Add and
 *   immediately backs out is not asked to confirm discarding a form they never touched;
 * - but a category they *changed* is, which a rule written only about the amount would
 *   miss - and silently dropping a deliberate choice is the failure the dialog exists to
 *   prevent.
 *
 * The note is compared normalised, so whitespace that would not be stored is not an edit.
 */
export function hasEdits(initial: ExpenseDraft, draft: ExpenseDraft): boolean {
  return (
    initial.amountMinor !== draft.amountMinor ||
    initial.categoryId !== draft.categoryId ||
    initial.date !== draft.date ||
    normaliseNote(initial.note) !== normaliseNote(draft.note)
  );
}
