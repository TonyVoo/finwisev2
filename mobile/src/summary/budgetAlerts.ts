import { COPY } from '../copy/strings';
import type { SpendEntry } from './summaryModel';

/**
 * Which budgets deserve a word on Home.
 *
 * Derived from the same entries the Summary legend draws, so the banner and the legend can
 * never disagree about who is over: both read `entry.budget`. **Over** is the legend's own
 * rule (strictly past the limit; spending exactly the budget is a month going to plan).
 * **Near** is 80% or more of it, in integers - `spent * 5 >= budget * 4` - so there is no
 * float division to round the wrong way at exactly 80.
 */

export type BudgetAlertLevel = 'over' | 'near';

export interface BudgetAlert {
  readonly level: BudgetAlertLevel;
  /** Names of the categories at that level, in the legend's order (largest spend first). */
  readonly names: readonly string[];
  /** Changes whenever the situation does, so a dismissal only covers what was dismissed. */
  readonly key: string;
}

export function budgetAlert(entries: readonly SpendEntry[]): BudgetAlert | null {
  const over: string[] = [];
  const near: string[] = [];

  for (const entry of entries) {
    const budget = entry.budget;
    if (budget === null) continue;
    if (budget.over) over.push(entry.name);
    else if (budget.spentMinor * 5 >= budget.budgetMinor * 4 && budget.spentMinor > 0) {
      near.push(entry.name);
    }
  }

  // One banner, the more serious thing: someone over budget does not need telling about
  // someone else being close as well.
  if (over.length > 0) return { level: 'over', names: over, key: `over:${over.join('|')}` };
  if (near.length > 0) return { level: 'near', names: near, key: `near:${near.join('|')}` };
  return null;
}

const MAX_NAMES = 3;

/** `Food`, `Food and Fun`, `Food, Fun, Rent and 2 more`. */
export function alertNames(names: readonly string[]): string {
  const shown = names.slice(0, MAX_NAMES);
  const rest = names.length - shown.length;
  if (rest > 0) {
    return COPY.home.budgetAlert.andMore
      .replace('{names}', shown.join(', '))
      .replace('{count}', String(rest));
  }
  if (shown.length <= 1) return shown.join('');
  return COPY.home.budgetAlert.and
    .replace('{names}', shown.slice(0, -1).join(', '))
    .replace('{last}', shown[shown.length - 1] ?? '');
}

export function alertTitle(alert: BudgetAlert): string {
  const copy = COPY.home.budgetAlert;
  const many = alert.names.length > 1;
  if (alert.level === 'over') {
    return many ? copy.overMany.replace('{count}', String(alert.names.length)) : copy.overOne;
  }
  return many ? copy.nearMany.replace('{count}', String(alert.names.length)) : copy.nearOne;
}

export function alertBody(alert: BudgetAlert): string {
  const copy = COPY.home.budgetAlert;
  return (alert.level === 'over' ? copy.bodyOver : copy.bodyNear).replace(
    '{names}',
    alertNames(alert.names),
  );
}
