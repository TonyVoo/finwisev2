import { v7 as uuidv7 } from 'uuid';
import { getPrisma } from '../../src/db/client.ts';
import { createBook, unusablePasswordHash } from '../../src/services/householdBooks.ts';
import type { TestUser } from './fixtures.ts';

/**
 * Households built straight in the database, for the cases about a person being in **several**.
 *
 * The HTTP routes can build these too (`POST /v1/household`), but a household with a given join order or a
 * given currency, or one scoped by its owner's own id, is quicker to state directly. The
 * rows are the ones the routes write: a book of its own, the household, and its memberships.
 */

export interface MadeHousehold {
  readonly householdId: string;
  /** The household's book: the `X-Space-Id` that selects it. */
  readonly scopeId: string;
}

export async function makeHousehold(options: {
  readonly owner: TestUser;
  readonly members?: readonly TestUser[];
  readonly name?: string;
  readonly currency?: string;
  /** Makes the memberships' `joinedAt` order explicit. */
  readonly joinedAt?: Date;
}): Promise<MadeHousehold> {
  const passwordHash = await unusablePasswordHash();
  const householdId = uuidv7();
  const scopeId = await getPrisma().$transaction(async (tx) => {
    const book = await createBook(
      tx,
      options.currency ?? options.owner.user.currency,
      passwordHash,
    );
    await tx.household.create({
      data: {
        id: householdId,
        ownerId: options.owner.user.id,
        scopeId: book,
        ...(options.name === undefined ? {} : { name: options.name }),
        members: {
          create: [
            {
              userId: options.owner.user.id,
              role: 'owner',
              ...(options.joinedAt === undefined ? {} : { joinedAt: options.joinedAt }),
            },
            ...(options.members ?? []).map((member) => ({
              userId: member.user.id,
              role: 'member',
              ...(options.joinedAt === undefined ? {} : { joinedAt: options.joinedAt }),
            })),
          ],
        },
      },
    });
    return book;
  });
  return { householdId, scopeId };
}
