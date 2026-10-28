import { z } from 'zod';
import { CurrencyCode, LIMITS, Timestamp, Uuid } from './primitives.js';
import { Email, User } from './user.js';

/**
 * Shared households (`docs/design/10-households.md`).
 *
 * Two or more people keep one set of books. The household is addressed by the access token,
 * never by an id in a URL, so no endpoint can be pointed at a household the caller is not in.
 */

/** Unambiguous characters only: no 0/O, 1/I/L, so a code read aloud or off a screen survives. */
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const InviteCode = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z
      .string()
      .regex(
        new RegExp(`^[${INVITE_CODE_ALPHABET}]{${LIMITS.INVITE_CODE_LENGTH}}$`),
        `Exactly ${LIMITS.INVITE_CODE_LENGTH} letters and digits.`,
      ),
  )
  .describe(
    `The ${LIMITS.INVITE_CODE_LENGTH}-character invite code the household's owner generated. Case-insensitive.`,
  );

export const HouseholdRole = z
  .enum(['owner', 'member'])
  .describe('`owner` created the household; `member` joined with a code.');

export const HouseholdMember = z.strictObject({
  userId: Uuid,
  email: Email,
  displayName: z
    .string()
    .nullable()
    .describe('The name the member chose, or `null` when they have not chosen one.'),
  role: HouseholdRole,
  joinedAt: Timestamp,
});

export const Household = z.strictObject({
  id: Uuid,
  role: HouseholdRole.describe("The caller's own role."),
  ownerId: Uuid.describe(
    "The owner's account id. The owner is a role that can change hands (`POST /v1/household/transfer`); it is not the id the shared rows are scoped by - the household has a book of its own for that (`GET /v1/me` `dataOwnerId`).",
  ),
  currency: CurrencyCode.describe("The household's currency: the owner's."),
  members: z.array(HouseholdMember),
});

export const HouseholdResponse = z.strictObject({
  household: Household.nullable().describe('`null` when the caller is in no household.'),
});

export const HouseholdInvite = z.strictObject({
  code: InviteCode,
  expiresAt: Timestamp,
});

export const HouseholdInviteResponse = z.strictObject({ data: HouseholdInvite });

/** No fields: the household is the caller's, found from the token. */
export const HouseholdCreateRequest = z.strictObject({});
export const HouseholdInviteRequest = z.strictObject({});
export const HouseholdLeaveRequest = z.strictObject({});

export const HouseholdJoinRequest = z.strictObject({ code: InviteCode });

export const HouseholdTransferRequest = z.strictObject({
  memberId: Uuid.describe(
    "The member to hand the household to: their account id, as listed by `GET /v1/household`. Must be someone else in the caller's household.",
  ),
});

export type HouseholdRole = z.infer<typeof HouseholdRole>;
export type HouseholdMember = z.infer<typeof HouseholdMember>;
export type Household = z.infer<typeof Household>;
export type HouseholdResponse = z.infer<typeof HouseholdResponse>;
export type HouseholdInvite = z.infer<typeof HouseholdInvite>;
export type HouseholdInviteResponse = z.infer<typeof HouseholdInviteResponse>;
export type HouseholdCreateRequest = z.infer<typeof HouseholdCreateRequest>;
export type HouseholdInviteRequest = z.infer<typeof HouseholdInviteRequest>;
export type HouseholdLeaveRequest = z.infer<typeof HouseholdLeaveRequest>;
export type HouseholdJoinRequest = z.infer<typeof HouseholdJoinRequest>;
export type HouseholdTransferRequest = z.infer<typeof HouseholdTransferRequest>;

/**
 * `GET /v1/me`: who the token belongs to, and the books it works in.
 *
 * Lives here rather than beside `User` because it carries the household, and `Household`
 * already depends on `Email` from `user.ts`.
 */
export const MeResponse = z.strictObject({
  user: User,
  dataOwnerId: Uuid.optional().describe(
    "Whose rows this account reads and writes: its own id, or - while it is in a household - the household's book. A device keeps its local store per data owner, so a change here means a clear and a resync. Absent from servers that predate households; treat absent as the account's own id.",
  ),
  household: Household.nullable()
    .optional()
    .describe(
      'The household the account is in, with its members, or `null`. It rides on `/v1/me` so a device can label each shared expense with who added it, offline, from the call it already makes at the start of every sync pass. Absent from servers that predate it and from endpoints that return only the user.',
    ),
});

export type MeResponse = z.infer<typeof MeResponse>;
