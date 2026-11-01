import { z } from 'zod';
import { CurrencyCode, LIMITS, Timestamp, Uuid } from './primitives.js';
import { Email, User } from './user.js';

/**
 * Shared households (`docs/design/10-households.md`).
 *
 * Two or more people keep one set of books. A person may be in several
 * (`docs/design/13-multiple-households.md`); a household is named by its id in the URL, and a household the
 * caller is not in answers `404 not_found`, the same as one that does not exist, so ids cannot be probed.
 * The older `/v1/household` routes act on the caller's one household.
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

export const HouseholdName = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.HOUSEHOLD_NAME_MAX)
  .describe(
    `How the household is told apart from the person's others: 1 to ${LIMITS.HOUSEHOLD_NAME_MAX} characters after trimming.`,
  );

export const Household = z.strictObject({
  id: Uuid,
  name: HouseholdName,
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

export const HouseholdListResponse = z.strictObject({
  households: z
    .array(Household)
    .describe('Every household the caller is in, by when they joined. Empty for a person in none.'),
});

export const HouseholdInvite = z.strictObject({
  code: InviteCode,
  expiresAt: Timestamp,
});

export const HouseholdInviteResponse = z.strictObject({ data: HouseholdInvite });

/** `name` is optional: a household made without one is called "Household". */
export const HouseholdCreateRequest = z.strictObject({ name: HouseholdName.optional() });
export const HouseholdRenameRequest = z.strictObject({ name: HouseholdName });
export const HouseholdInviteRequest = z.strictObject({});
export const HouseholdLeaveRequest = z.strictObject({});

export const HouseholdJoinRequest = z.strictObject({ code: InviteCode });

export const HouseholdTransferRequest = z.strictObject({
  memberId: Uuid.describe(
    "The member to hand the household to: their account id, as listed by `GET /v1/household`. Must be someone else in the caller's household.",
  ),
});

export type HouseholdName = z.infer<typeof HouseholdName>;
export type HouseholdListResponse = z.infer<typeof HouseholdListResponse>;
export type HouseholdRenameRequest = z.infer<typeof HouseholdRenameRequest>;
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
 * A book a person can work in (`docs/design/13-multiple-households.md`): their own, or a household's.
 * Which one a request works in is named by its `X-Space-Id` header, validated every time.
 */
export const Space = z.discriminatedUnion('kind', [
  z.strictObject({
    id: Uuid.describe("The account's own id, which is what `X-Space-Id` carries to select it."),
    kind: z.literal('personal'),
    name: z.null(),
    currency: CurrencyCode,
  }),
  z.strictObject({
    id: Uuid.describe("The household's book, which is what `X-Space-Id` carries to select it."),
    kind: z.literal('household'),
    householdId: Uuid,
    name: z
      .string()
      .min(1)
      .max(40)
      .describe("How the household is told apart from the person's others."),
    role: z.enum(['owner', 'member']),
    currency: CurrencyCode,
  }),
]);
export type Space = z.infer<typeof Space>;

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
      'The household of the active space, with its members, or `null` (in the personal space there is none in view, even for a person who belongs to a household). It rides on `/v1/me` so a device can label each shared expense with who added it, offline, from the call it already makes at the start of every sync pass. Absent from servers that predate it and from endpoints that return only the user.',
    ),
  spaces: z
    .array(Space)
    .optional()
    .describe(
      'Every book the person can work in: their own first, then their households by when they joined (a person whose household is scoped by their own id, from before households had books, has just that household). The same whichever space is active. Absent from servers that predate spaces; treat absent as the one the account is already in.',
    ),
});

export type MeResponse = z.infer<typeof MeResponse>;
