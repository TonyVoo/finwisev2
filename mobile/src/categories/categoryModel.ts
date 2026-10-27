import type { CategoryWithCount } from '../db/queries';
import { COPY } from '../copy/strings';

/**
 * What a category row says out loud: `docs/design/07-categories.md` §5 rules 1 and 2.
 *
 * Pure, and tested as text, because the composition has three plural forms and two
 * conditional suffixes - and every one of them is a sentence a screen-reader user hears
 * rather than something anyone will notice on screen.
 */

/**
 * The count, spoken.
 *
 * > read as `23 expenses` / `1 expense` / `No expenses`
 *
 * The deck has no `(s)` anywhere, and the zero case is words rather than the digit `0`:
 * the **column** renders `0` so it stays scannable (§1 rule 2), but "no expenses" is what
 * someone hearing the row needs - a bare "0" read aloud after a category name is a
 * stumble.
 */
export function expenseCountLabel(count: number): string {
  if (count === 0) return COPY.a11y.noExpenses;
  if (count === 1) return COPY.a11y.expenseOne;
  return COPY.a11y.expenseMany.replace('{count}', String(count));
}

/**
 * A category row's composed accessibility label.
 *
 * `{name}, {count} expenses`, plus `, not synced yet` when pending, plus `, cannot be
 * deleted` on the `isDefault` row - so a screen-reader user learns that constraint
 * *before* trying rather than by being refused (§5 rule 2).
 */
export function categoryRowLabel(category: CategoryWithCount): string {
  return [
    category.name,
    expenseCountLabel(category.expenseCount),
    ...(category.pending ? [COPY.a11y.notSyncedYet] : []),
    ...(category.isDefault ? [COPY.a11y.cannotBeDeleted] : []),
  ].join(', ');
}
