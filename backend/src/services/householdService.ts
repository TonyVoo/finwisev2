import { createHmac, randomInt } from 'node:crypto';
import {
  INVITE_CODE_ALPHABET,
  LIMITS,
  type Household,
  type Space,
  type HouseholdInvite,
  type HouseholdListResponse,
  type HouseholdResponse,
} from '@expense-tracker/shared';
import { v7 as uuidv7 } from 'uuid';
import { getConfig } from '../config.ts';
import type { Db } from '../db/client.ts';
import {
  createBook,
  ensureOwnDefaultCategory,
  handBackPrivateExpenses,
  mergeBooks,
  moveBooks,
  unusablePasswordHash,
} from './householdBooks.ts';
import { ApiProblem, problems } from '../errors.ts';
import { logger } from '../logger.ts';

/**
 * Shared households (`docs/design/10-households.md`, `docs/design/13-multiple-households.md`).
 *
 * A household has a book of its own (a hidden user row, `scopeId`), so a person can be in several and keep
 * their own besides: creating one moves no rows, joining adds a book the person can work in, and leaving
 * takes it away. Every household is named by its id; one the caller is not in is `404 not_found`.
 *
 * Households made before books existed are scoped by their owner's own id (`scopeId === ownerId`).
 */

const DEFAULT_HOUSEHOLD_NAME = 'Household';

const notInHousehold = () => new ApiProblem('not_in_household', 'You are not in a household.');
const ownerOnly = () =>
  new ApiProblem('household_owner_only', 'Only the household owner can do that.');
const ownerCannotLeave = () =>
  new ApiProblem('owner_cannot_leave', 'The owner cannot leave the household; delete it instead.');
const alreadyMember = () => new ApiProblem('already_member', 'You are already in that household.');
const householdLimit = () =>
  new ApiProblem('household_limit', 'You are in as many households as you can be.');
/** One answer for a household that is not the caller's and one that does not exist, so ids cannot be probed. */
const householdNotFound = () => problems.notFound('No such household.');
const invalidInvite = () =>
  new ApiProblem('invalid_invite_code', 'That code is incorrect or has expired.');

/** Keyed on the server secret, so a copy of the table is not a list of working codes. */
function inviteHash(code: string): string {
  return createHmac('sha256', getConfig().jwt.secret).update(`invite:${code}`).digest('hex');
}

function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < LIMITS.INVITE_CODE_LENGTH; i += 1) {
    code += INVITE_CODE_ALPHABET[randomInt(0, INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

const SELECT_HOUSEHOLD = {
  role: true,
  household: {
    select: {
      id: true,
      name: true,
      ownerId: true,
      book: { select: { currency: true } },
      members: {
        orderBy: { joinedAt: 'asc' },
        select: {
          userId: true,
          role: true,
          joinedAt: true,
          user: { select: { email: true, displayName: true } },
        },
      },
    },
  },
} as const;

/** What {@link SELECT_HOUSEHOLD} returns. */
interface MembershipRow {
  readonly role: string;
  readonly household: {
    readonly id: string;
    readonly name: string;
    readonly ownerId: string;
    readonly book: { readonly currency: string };
    readonly members: readonly {
      readonly userId: string;
      readonly role: string;
      readonly joinedAt: Date;
      readonly user: { readonly email: string; readonly displayName: string | null };
    }[];
  };
}

function toHousehold(membership: MembershipRow): Household {
  const { household } = membership;
  return {
    id: household.id,
    name: household.name,
    role: membership.role as Household['role'],
    ownerId: household.ownerId,
    currency: household.book.currency,
    members: household.members.map((member) => ({
      userId: member.userId,
      email: member.user.email,
      displayName: member.user.displayName,
      role: member.role as Household['role'],
      joinedAt: member.joinedAt.toISOString(),
    })),
  };
}

/** The household the caller's older, single-household routes mean: their one, `null` for none, `household_ambiguous` for several. */
async function soleHouseholdId(db: Db, userId: string): Promise<string | null> {
  const memberships = await db.householdMember.findMany({ where: { userId }, take: 2 });
  if (memberships.length > 1)
    throw new ApiProblem(
      'household_ambiguous',
      'You are in more than one household. Update the app to manage them.',
    );
  return memberships[0]?.householdId ?? null;
}

/** The older routes' household: the caller's one, or `not_in_household`. */
export async function requireSoleHouseholdId(db: Db, userId: string): Promise<string> {
  const id = await soleHouseholdId(db, userId);
  if (id === null) throw notInHousehold();
  return id;
}

/**
 * The household a person is in, with who is in it; `null` for a person in none. With `scopeId` it is the
 * household whose book that is (what `GET /v1/me` reports for the active space); without, the person's one.
 */
async function loadHousehold(db: Db, userId: string, scopeId?: string): Promise<Household | null> {
  const where =
    scopeId === undefined
      ? await soleHouseholdId(db, userId).then((householdId) =>
          householdId === null ? null : { userId, householdId },
        )
      : { userId, household: { scopeId } };
  if (where === null) return null;
  const membership = await db.householdMember.findFirst({ where, select: SELECT_HOUSEHOLD });
  return membership === null ? null : toHousehold(membership);
}

export async function getHousehold(
  db: Db,
  userId: string,
  scopeId?: string,
): Promise<HouseholdResponse> {
  return { household: await loadHousehold(db, userId, scopeId) };
}

async function householdById(
  db: Db,
  userId: string,
  householdId: string,
): Promise<HouseholdResponse> {
  const membership = await db.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
    select: SELECT_HOUSEHOLD,
  });
  return { household: membership === null ? null : toHousehold(membership) };
}

/** Every household the person is in, by when they joined. */
export async function listHouseholds(db: Db, userId: string): Promise<HouseholdListResponse> {
  const memberships = await db.householdMember.findMany({
    where: { userId },
    orderBy: { joinedAt: 'asc' },
    select: SELECT_HOUSEHOLD,
  });
  return { households: memberships.map(toHousehold) };
}

/**
 * Serialises the changes of one person's memberships, so the limit holds without a constraint: two
 * simultaneous creates or joins by the same person take turns and the second sees the first. Released with
 * the transaction.
 */
async function lockPerson(tx: Db, userId: string): Promise<void> {
  // `$executeRaw`: the function returns `void`, which a query cannot read back.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
}

async function requireRoom(tx: Db, userId: string): Promise<void> {
  const count = await tx.householdMember.count({ where: { userId } });
  if (count >= LIMITS.HOUSEHOLDS_MAX_PER_USER) throw householdLimit();
}

/** Makes an empty household with its own book. The creator's own books are not touched. */
export async function createHousehold(
  db: Db,
  userId: string,
  name: string = DEFAULT_HOUSEHOLD_NAME,
): Promise<HouseholdResponse> {
  const owner = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { currency: true },
  });
  const passwordHash = await unusablePasswordHash();

  const id = uuidv7();
  await db.$transaction(async (tx) => {
    await lockPerson(tx, userId);
    await requireRoom(tx, userId);
    const scopeId = await createBook(tx, owner.currency, passwordHash);
    // Empty of the creator's data, but never without categories: a book with no default cannot take an expense.
    await ensureOwnDefaultCategory(tx, scopeId);
    await tx.household.create({
      data: { id, name, ownerId: userId, scopeId, members: { create: { userId, role: 'owner' } } },
    });
  });

  logger.info('household created', { userId, householdId: id });
  return await householdById(db, userId, id);
}

/** The caller's membership in that household, or the one `404` for any household that is not theirs. */
async function requireMembership(db: Db, userId: string, householdId: string) {
  const membership = await db.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
  });
  if (membership === null) throw householdNotFound();
  return membership;
}

/** The caller's membership, or the right refusal: not theirs (`404`), or not the owner (`403`). */
async function requireOwnerMembership(db: Db, userId: string, householdId: string) {
  const membership = await requireMembership(db, userId, householdId);
  if (membership.role !== 'owner') throw ownerOnly();
  return membership;
}

export async function renameHousehold(
  db: Db,
  userId: string,
  householdId: string,
  name: string,
): Promise<HouseholdResponse> {
  await requireOwnerMembership(db, userId, householdId);
  await db.household.update({ where: { id: householdId }, data: { name } });
  return await householdById(db, userId, householdId);
}

export async function createInvite(
  db: Db,
  userId: string,
  householdId: string,
  now: Date = new Date(),
): Promise<{ data: HouseholdInvite }> {
  await requireOwnerMembership(db, userId, householdId);

  const code = generateInviteCode();
  const expiresAt = new Date(now.getTime() + LIMITS.INVITE_CODE_TTL_HOURS * 3_600_000);
  const data = { codeHash: inviteHash(code), expiresAt, createdAt: now };
  // One live code per household: a new one replaces the old.
  await db.householdInvite.upsert({
    where: { householdId },
    create: { householdId, ...data },
    update: data,
  });

  logger.info('household invite issued', { userId, householdId });
  return { data: { code, expiresAt: expiresAt.toISOString() } };
}

export async function joinHousehold(
  db: Db,
  userId: string,
  code: string,
  now: Date = new Date(),
): Promise<HouseholdResponse> {
  const invite = await db.householdInvite.findUnique({ where: { codeHash: inviteHash(code) } });
  if (invite === null || invite.expiresAt <= now) throw invalidInvite();

  await db.$transaction(async (tx) => {
    await lockPerson(tx, userId);
    // Both refusals come before the code is spent, so the person can still pass it on.
    const already = await tx.householdMember.findUnique({
      where: { householdId_userId: { householdId: invite.householdId, userId } },
    });
    if (already !== null) throw alreadyMember();
    await requireRoom(tx, userId);
    // Deleting the invite is the single-use gate: if a second person with the same code got
    // here first, this deletes nothing and this one is refused.
    const consumed = await tx.householdInvite.deleteMany({
      where: { householdId: invite.householdId, codeHash: invite.codeHash },
    });
    if (consumed.count !== 1) throw invalidInvite();
    await tx.householdMember.create({
      data: { householdId: invite.householdId, userId, role: 'member' },
    });
  });

  logger.info('household joined', { userId, householdId: invite.householdId });
  return await householdById(db, userId, invite.householdId);
}

export async function leaveHousehold(db: Db, userId: string, householdId: string): Promise<void> {
  const membership = await requireMembership(db, userId, householdId);
  if (membership.role === 'owner') throw ownerCannotLeave();

  await db.$transaction(async (tx) => {
    const { scopeId } = await tx.household.findUniqueOrThrow({
      where: { id: householdId },
      select: { scopeId: true },
    });
    await tx.householdMember.delete({
      where: { householdId_userId: { householdId, userId } },
    });
    await ensureOwnDefaultCategory(tx, userId);
    // Private means "only I see it": it goes with the person, not into books they can't open.
    await handBackPrivateExpenses(tx, scopeId, userId);
  });
  logger.info('household left', { userId, householdId });
}

export async function removeMember(
  db: Db,
  ownerUserId: string,
  householdId: string,
  memberId: string,
): Promise<void> {
  await requireOwnerMembership(db, ownerUserId, householdId);
  if (memberId === ownerUserId) throw ownerCannotLeave();

  await db.$transaction(async (tx) => {
    const removed = await tx.householdMember.deleteMany({
      where: { userId: memberId, householdId },
    });
    // Not a member of *this* household: the same 404 as an unknown id, so ids cannot be probed.
    if (removed.count !== 1) throw problems.notFound('No such member.');
    await ensureOwnDefaultCategory(tx, memberId);
    const { scopeId } = await tx.household.findUniqueOrThrow({
      where: { id: householdId },
      select: { scopeId: true },
    });
    await handBackPrivateExpenses(tx, scopeId, memberId);
  });

  logger.info('household member removed', { userId: ownerUserId, householdId });
}

export async function deleteHousehold(db: Db, userId: string, householdId: string): Promise<void> {
  await requireOwnerMembership(db, userId, householdId);

  await db.$transaction(async (tx) => {
    const household = await tx.household.findUniqueOrThrow({
      where: { id: householdId },
      select: { id: true, ownerId: true, scopeId: true },
    });
    // Every other member gets their private expenses back first: they are theirs alone, and
    // must not be merged into the owner's books along with the shared ones.
    const others = await tx.householdMember.findMany({
      where: { householdId: household.id, userId: { not: household.ownerId } },
      select: { userId: true },
    });
    for (const { userId: memberId } of others) {
      await handBackPrivateExpenses(tx, household.scopeId, memberId);
    }
    // The owner's own private expenses are theirs in their books now; "private" has no meaning
    // in a book only they read. Only this household's rows: the owner's others stay as they are.
    await tx.expense.updateMany({
      where: { userId: household.scopeId, private: true },
      data: { private: false },
    });
    // The shared books go to the owner, merged into whatever books they already have. A
    // household made before books existed was scoped by its owner already: nothing to move.
    if (household.scopeId !== household.ownerId) {
      await mergeBooks(tx, household.scopeId, household.ownerId);
    }
    // Members, the invite and the memberships go with it (cascade); the book is empty now.
    await tx.household.delete({ where: { id: household.id } });
    if (household.scopeId !== household.ownerId) {
      await tx.user.delete({ where: { id: household.scopeId } });
    }
  });
  logger.info('household deleted', { userId, householdId });
}

/**
 * Hand the household to another member: they become the owner, the caller a member.
 *
 * Only a role changes - the rows live in the household's own book, not in anyone's account. (A
 * household made before books existed is scoped by its owner's account, so it is given a book
 * first, moving those rows once.)
 */
export async function transferHousehold(
  db: Db,
  ownerUserId: string,
  householdId: string,
  memberId: string,
): Promise<HouseholdResponse> {
  await requireOwnerMembership(db, ownerUserId, householdId);
  if (memberId === ownerUserId) {
    throw new ApiProblem('validation_error', 'Choose another member to hand the household to.', {
      issues: [{ path: 'memberId', message: 'must be another member of the household' }],
    });
  }
  const passwordHash = await unusablePasswordHash();

  await db.$transaction(async (tx) => {
    const target = await tx.householdMember.findFirst({
      where: { userId: memberId, householdId },
    });
    // Not a member of *this* household: the same 404 as an unknown id.
    if (target === null) throw problems.notFound('No such member.');

    const household = await tx.household.findUniqueOrThrow({ where: { id: householdId } });
    if (household.scopeId === household.ownerId) {
      const books = await tx.user.findUniqueOrThrow({
        where: { id: household.ownerId },
        select: { currency: true },
      });
      const scopeId = await createBook(tx, books.currency, passwordHash);
      await moveBooks(tx, household.ownerId, scopeId);
      await tx.household.update({ where: { id: household.id }, data: { scopeId } });
    }

    await tx.householdMember.update({
      where: { householdId_userId: { householdId, userId: ownerUserId } },
      data: { role: 'member' },
    });
    await tx.householdMember.update({
      where: { householdId_userId: { householdId, userId: memberId } },
      data: { role: 'owner' },
    });
    await tx.household.update({ where: { id: household.id }, data: { ownerId: memberId } });
  });

  logger.info('household transferred', { userId: ownerUserId, to: memberId });
  return await householdById(db, ownerUserId, householdId);
}

/** True when the account owns a household that still has other people in it. */
export async function ownsHouseholdWithOthers(db: Db, userId: string): Promise<boolean> {
  const owned = await db.householdMember.count({
    where: { household: { ownerId: userId }, userId: { not: userId } },
  });
  return owned > 0;
}

/**
 * Every book a person can work in: their own first, then their households by when they joined
 * (`docs/design/13-multiple-households.md`). A person whose household is scoped by their own id, from before
 * households had books of their own, has no separate personal space: that household *is* the book their id
 * selects, so it is listed once, as the household.
 */
export async function listSpaces(
  db: Db,
  user: { readonly id: string; readonly currency: string },
): Promise<Space[]> {
  const memberships = await db.householdMember.findMany({
    where: { userId: user.id },
    orderBy: { joinedAt: 'asc' },
    select: {
      role: true,
      household: {
        select: { id: true, name: true, scopeId: true, book: { select: { currency: true } } },
      },
    },
  });
  const households: Space[] = memberships.map((membership) => ({
    id: membership.household.scopeId,
    kind: 'household',
    householdId: membership.household.id,
    name: membership.household.name,
    role: membership.role as 'owner' | 'member',
    currency: membership.household.book.currency,
  }));
  const personalIsAHousehold = memberships.some((m) => m.household.scopeId === user.id);
  return personalIsAHousehold
    ? households
    : [{ id: user.id, kind: 'personal', name: null, currency: user.currency }, ...households];
}
