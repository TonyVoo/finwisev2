import { createHmac, randomInt } from 'node:crypto';
import {
  INVITE_CODE_ALPHABET,
  LIMITS,
  type Household,
  type HouseholdInvite,
  type HouseholdResponse,
} from '@expense-tracker/shared';
import { v7 as uuidv7 } from 'uuid';
import { getConfig } from '../config.ts';
import type { Db } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { ApiProblem, problems } from '../errors.ts';
import { logger } from '../logger.ts';

/**
 * Shared households (`docs/design/10-households.md`).
 *
 * A household reuses the **owner's** user id as the data scope, so nothing here touches a
 * synced table: creating a household moves no rows, joining switches whose rows a member
 * reads, and leaving switches them back. That is also why the owner cannot leave - their id
 * *is* the scope - and why an owner with other members cannot delete their account.
 */

const notInHousehold = () => new ApiProblem('not_in_household', 'You are not in a household.');
const ownerOnly = () =>
  new ApiProblem('household_owner_only', 'Only the household owner can do that.');
const ownerCannotLeave = () =>
  new ApiProblem('owner_cannot_leave', 'The owner cannot leave the household; delete it instead.');
const householdExists = () => new ApiProblem('household_exists', 'You are already in a household.');
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

/** The household a person is in, with who is in it; `null` for a person in none. */
async function loadHousehold(db: Db, userId: string): Promise<Household | null> {
  const membership = await db.householdMember.findUnique({
    where: { userId },
    select: {
      role: true,
      household: {
        select: {
          id: true,
          ownerId: true,
          owner: { select: { currency: true } },
          members: {
            orderBy: { joinedAt: 'asc' },
            select: {
              userId: true,
              role: true,
              joinedAt: true,
              user: { select: { email: true } },
            },
          },
        },
      },
    },
  });
  if (membership === null) return null;

  const { household } = membership;
  return {
    id: household.id,
    role: membership.role as Household['role'],
    ownerId: household.ownerId,
    currency: household.owner.currency,
    members: household.members.map((member) => ({
      userId: member.userId,
      email: member.user.email,
      role: member.role as Household['role'],
      joinedAt: member.joinedAt.toISOString(),
    })),
  };
}

export async function getHousehold(db: Db, userId: string): Promise<HouseholdResponse> {
  return { household: await loadHousehold(db, userId) };
}

export async function createHousehold(db: Db, userId: string): Promise<HouseholdResponse> {
  if ((await db.householdMember.findUnique({ where: { userId } })) !== null) {
    throw householdExists();
  }

  const id = uuidv7();
  try {
    await db.household.create({
      data: { id, ownerId: userId, members: { create: { userId, role: 'owner' } } },
    });
  } catch (error) {
    // Two concurrent creates by the same person: the unique indexes decide, and the loser
    // gets the same answer as if it had arrived second.
    if (isUniqueViolation(error)) throw householdExists();
    throw error;
  }

  logger.info('household created', { userId, householdId: id });
  return await getHousehold(db, userId);
}

/** The caller's membership, or the right refusal: not in one, or not the owner. */
async function requireOwnerMembership(db: Db, userId: string) {
  const membership = await db.householdMember.findUnique({ where: { userId } });
  if (membership === null) throw notInHousehold();
  if (membership.role !== 'owner') throw ownerOnly();
  return membership;
}

export async function createInvite(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<{ data: HouseholdInvite }> {
  const { householdId } = await requireOwnerMembership(db, userId);

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
  if ((await db.householdMember.findUnique({ where: { userId } })) !== null) {
    throw householdExists();
  }

  const invite = await db.householdInvite.findUnique({ where: { codeHash: inviteHash(code) } });
  if (invite === null || invite.expiresAt <= now) throw invalidInvite();

  await db.$transaction(async (tx) => {
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
  return await getHousehold(db, userId);
}

export async function leaveHousehold(db: Db, userId: string): Promise<void> {
  const membership = await db.householdMember.findUnique({ where: { userId } });
  if (membership === null) throw notInHousehold();
  if (membership.role === 'owner') throw ownerCannotLeave();

  await db.householdMember.delete({ where: { userId } });
  logger.info('household left', { userId, householdId: membership.householdId });
}

export async function removeMember(db: Db, ownerUserId: string, memberId: string): Promise<void> {
  const owner = await requireOwnerMembership(db, ownerUserId);
  if (memberId === ownerUserId) throw ownerCannotLeave();

  const removed = await db.householdMember.deleteMany({
    where: { userId: memberId, householdId: owner.householdId },
  });
  // Not a member of *this* household: the same 404 as an unknown id, so ids cannot be probed.
  if (removed.count !== 1) throw problems.notFound('No such member.');

  logger.info('household member removed', { userId: ownerUserId, householdId: owner.householdId });
}

export async function deleteHousehold(db: Db, userId: string): Promise<void> {
  const owner = await requireOwnerMembership(db, userId);
  // Members, the invite and the memberships go with it (cascade). The shared rows stay,
  // under the owner's id, which is the owner's own books again.
  await db.household.delete({ where: { id: owner.householdId } });
  logger.info('household deleted', { userId, householdId: owner.householdId });
}

/** True when the account owns a household that still has other people in it. */
export async function ownsHouseholdWithOthers(db: Db, userId: string): Promise<boolean> {
  const owned = await db.householdMember.count({
    where: { household: { ownerId: userId }, userId: { not: userId } },
  });
  return owned > 0;
}
