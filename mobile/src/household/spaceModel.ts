import type { Space } from '@expense-tracker/shared';
import { COPY } from '../copy/strings';

/**
 * Which book is open, and what the switcher shows (`docs/design/13-multiple-households.md`). Pure, so the
 * rules are tested without a screen.
 */

/** What to call a space: the person's household by its name, their own books "Personal". */
export function spaceName(space: Pick<Space, 'kind' | 'name'>): string {
  return space.kind === 'personal' || space.name === null ? COPY.spaces.personal : space.name;
}

/**
 * The space the store holds. A store whose scope is not in the list (stale, or the list not read yet) is
 * the personal space if there is one, else the first - never nothing, so the chip always has a label once
 * there are spaces.
 */
export function activeSpaceOf(spaces: readonly Space[], scope: string | null): Space | null {
  return (
    spaces.find((space) => space.id === scope) ??
    spaces.find((space) => space.kind === 'personal') ??
    spaces[0] ??
    null
  );
}

/** A person with only their own books has nothing to switch to, so no chip. */
export function needsSwitcher(spaces: readonly Space[]): boolean {
  return spaces.length > 1;
}

/** Why a switch cannot happen now, as words to show; `null` when it can. */
export function switchRefusal(state: { pending: boolean; offline: boolean }): string | null {
  if (state.offline) return COPY.spaces.offline;
  if (state.pending) return COPY.household.syncFirst;
  return null;
}
