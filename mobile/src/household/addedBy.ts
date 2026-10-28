import { COPY } from '../copy/strings';

/**
 * "Added by Bao": who put an expense in a shared book.
 *
 * Only shown when the book is actually shared (two or more members known), so a solo account
 * never sees a line that says "Added by you" on every row.
 */

export interface MemberRef {
  readonly userId: string;
  readonly email: string;
  /** What they chose to be called, or null. */
  readonly displayName: string | null;
}

/**
 * What to call a person: the name they chose, or - when they have not chosen one - the part of
 * their address before the `@`, capitalised, which is all the app otherwise knows of them.
 */
export function memberLabel(person: {
  readonly email: string;
  readonly displayName?: string | null | undefined;
}): string {
  const chosen = person.displayName?.trim();
  if (chosen !== undefined && chosen !== '') return chosen;
  const local = person.email.split('@')[0] ?? person.email;
  return local.length === 0 ? person.email : local.charAt(0).toUpperCase() + local.slice(1);
}

/**
 * What `reconcileDataScope` stored. Junk, or nothing, is no members. Members stored before
 * display names existed have no name, which reads as none.
 */
export function parseMembers(json: string | null): readonly MemberRef[] {
  if (json === null) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    const members: MemberRef[] = [];
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) return [];
      const { userId, email, displayName } = entry as Record<string, unknown>;
      if (typeof userId !== 'string' || typeof email !== 'string') return [];
      members.push({
        userId,
        email,
        displayName: typeof displayName === 'string' ? displayName : null,
      });
    }
    return members;
  } catch {
    return [];
  }
}

/**
 * The line for one expense, or `null` when there is nothing worth saying: the book is not
 * shared, the author was not recorded, or they have since left the household.
 */
export function addedByText(
  createdBy: string | null,
  members: readonly MemberRef[],
  myEmail: string | null | undefined,
): string | null {
  if (members.length < 2 || createdBy === null) return null;
  const author = members.find((member) => member.userId === createdBy);
  if (author === undefined) return null;
  if (myEmail !== null && myEmail !== undefined && author.email === myEmail) {
    return COPY.household.addedByYou;
  }
  return COPY.household.addedBy.replace('{name}', memberLabel(author));
}
