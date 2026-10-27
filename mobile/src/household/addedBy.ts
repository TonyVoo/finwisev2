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
}

/** The part of the address before the `@`, capitalised: all the app knows of a name. */
export function memberLabel(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.length === 0 ? email : local.charAt(0).toUpperCase() + local.slice(1);
}

/** What `reconcileDataScope` stored. Junk, or nothing, is no members. */
export function parseMembers(json: string | null): readonly MemberRef[] {
  if (json === null) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as MemberRef).userId === 'string' &&
        typeof (entry as MemberRef).email === 'string',
    )
      ? (parsed as MemberRef[])
      : [];
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
  return COPY.household.addedBy.replace('{name}', memberLabel(author.email));
}
