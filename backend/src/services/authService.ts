import {
  DEFAULT_CATEGORIES,
  type AuthResponse,
  type TokenPair,
  type User as WireUser,
} from '@expense-tracker/shared';
import { v7 as uuidv7 } from 'uuid';
import { signAccessToken } from '../auth/accessToken.ts';
import { hashPassword, verifyPassword } from '../auth/password.ts';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
} from '../auth/refreshToken.ts';
import { getConfig } from '../config.ts';
import type { Db } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { sendEmailVerification } from './emailVerificationService.ts';
import { toWireUser } from '../db/mappers.ts';
import { nextRevisionBlock } from '../db/revision.ts';
import { ApiProblem, problems } from '../errors.ts';
import { logger } from '../logger.ts';

/**
 * Account lifecycle: signup, login, refresh, logout.
 *
 * The invariants this file is responsible for:
 *
 *  * Emails are normalised before storage and before comparison, so `A@x.com` and
 *    `a@x.com` are one account (the DB's CHECK constraint is the backstop).
 *  * A wrong email and a wrong password are indistinguishable, in both the response and
 *    roughly in the time taken.
 *  * Refresh tokens are single-use. Presenting one that has already been rotated is
 *    rejected, which is also how a stolen-and-replayed token is caught.
 *  * Signup seeds the user's categories, including the undeletable `Uncategorized`, in
 *    the same transaction as the user — a user without a default category would have
 *    nowhere to reassign a deleted category's expenses to.
 */

/**
 * Normalise an email for storage and lookup.
 *
 * Only case and surrounding whitespace: no dot-stripping or `+tag` removal, which are
 * provider-specific policies and would silently merge addresses the user considers
 * distinct.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Mint an access/refresh pair and persist the refresh token's hash.
 *
 * Takes a {@link Db} so a caller can run it inside a transaction: `refresh` revokes the
 * presented token and issues its replacement atomically, so a crash in between cannot
 * leave the user with no usable token.
 */
async function issueSession(db: Db, userId: string): Promise<TokenPair> {
  const { refreshTokenTtlDays } = getConfig();

  const refreshToken = generateRefreshToken();
  const expiresAt = refreshTokenExpiry(refreshTokenTtlDays);

  await db.refreshToken.create({
    data: {
      id: uuidv7(),
      userId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt,
    },
  });

  const access = await signAccessToken(userId);

  return {
    accessToken: access.token,
    refreshToken,
    accessTokenExpiresIn: access.expiresInSeconds,
    refreshTokenExpiresAt: expiresAt.toISOString(),
  };
}

export interface SignupInput {
  readonly email: string;
  readonly password: string;
  readonly currency: string;
}

/**
 * Create an account, seed its categories, and return a usable session.
 *
 * The password hash is computed *before* the transaction opens: argon2id is deliberately
 * slow (~50ms), and holding a Postgres transaction open across it would pin a connection
 * for no reason.
 */
export async function signup(db: Db, input: SignupInput): Promise<AuthResponse> {
  const email = normaliseEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  const userId = uuidv7();
  const now = new Date();

  let user: WireUser;
  try {
    user = await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { id: userId, email, passwordHash, currency: input.currency },
      });

      // The counter must exist before `nextRevisionBlock` can draw from it — the SQL
      // function raises rather than inserting, so that a missing counter is a loud bug
      // instead of a silently restarted sequence.
      await tx.revisionCounter.create({ data: { userId } });

      const revisions = await nextRevisionBlock(tx, userId, DEFAULT_CATEGORIES.length);

      await tx.category.createMany({
        data: DEFAULT_CATEGORIES.map((category, index) => {
          const revision = revisions[index];
          if (revision === undefined) {
            // Unreachable: the block is allocated with exactly this length.
            throw new Error('nextRevisionBlock returned fewer revisions than requested');
          }
          return {
            id: uuidv7(),
            userId,
            name: category.name,
            color: category.color,
            isDefault: category.isDefault,
            updatedAt: now,
            revision,
          };
        }),
      });

      return toWireUser(created);
    });
  } catch (error) {
    if (isUniqueViolation(error, 'email')) throw problems.emailAlreadyExists();
    throw error;
  }

  // Outside the transaction: the account exists and is valid on its own. If issuing the
  // session failed, the correct recovery is a login, not an orphaned half-created user.
  const tokens = await issueSession(db, userId);
  logger.info('account created', { userId });

  // Fire and forget: verification is non-blocking, and a mail failure must never fail signup.
  void sendEmailVerification(db, userId).catch((error: unknown) => {
    logger.error('signup verification email failed', {
      userId,
      message: error instanceof Error ? error.message : String(error),
    });
  });

  return { user, ...tokens };
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

/**
 * Exchange email + password for a session.
 *
 * Both failure branches raise the same `invalid_credentials`, and the no-such-user
 * branch still pays the argon2 cost (see `verifyPassword`), so neither the body nor the
 * latency reveals whether the account exists.
 */
export async function login(db: Db, input: LoginInput): Promise<AuthResponse> {
  const email = normaliseEmail(input.email);
  const user = await db.user.findUnique({ where: { email } });

  const ok = await verifyPassword(input.password, user?.passwordHash);
  if (!ok || !user) {
    logger.info('login rejected', { email });
    throw problems.invalidCredentials();
  }

  const tokens = await issueSession(db, user.id);
  logger.info('login succeeded', { userId: user.id });

  return { user: toWireUser(user), ...tokens };
}

/**
 * Rotate a refresh token.
 *
 * Single-use is enforced by claiming the row with a conditional update
 * (`revokedAt: null` in the `where`) rather than by the read above it. The read decides
 * *which* error to report; the conditional update is what makes two concurrent refreshes
 * with the same token produce one new session and one rejection, instead of two
 * sessions.
 */
export async function refresh(db: Db, presentedToken: string): Promise<TokenPair> {
  const tokenHash = hashRefreshToken(presentedToken);
  const existing = await db.refreshToken.findUnique({ where: { tokenHash } });

  if (!existing) {
    throw problems.tokenInvalid('Refresh token is not valid.');
  }

  // Revoked is checked before expiry: a presented-but-already-rotated token is the
  // reuse signal, and reporting it as `token_expired` would tell a client to retry a
  // token that must never work again.
  if (existing.revokedAt !== null) {
    logger.warn('refresh token reused after rotation', {
      userId: existing.userId,
      tokenId: existing.id,
    });
    throw problems.tokenInvalid('Refresh token has already been used.');
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw problems.tokenExpired('Refresh token has expired.');
  }

  return db.$transaction(async (tx) => {
    const claimed = await tx.refreshToken.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count !== 1) {
      // Another request rotated it between our read and this update.
      throw problems.tokenInvalid('Refresh token has already been used.');
    }
    const tokens = await issueSession(tx, existing.userId);
    logger.info('session refreshed', { userId: existing.userId });
    return tokens;
  });
}

/**
 * Revoke a refresh token. Idempotent and deliberately forgiving.
 *
 * An unknown, already-revoked or expired token is still a success: the client's goal is
 * "this session is over and I can clear local credentials", and failing that would leave
 * the app stuck half-logged-out with no way forward. Per the contract, only a malformed
 * body is an error here.
 */
export async function logout(db: Db, presentedToken: string): Promise<void> {
  const result = await db.refreshToken.updateMany({
    where: { tokenHash: hashRefreshToken(presentedToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count > 0) logger.info('session revoked');
}

/**
 * Check the password a signed-in user just re-entered.
 *
 * `forbidden`, not `invalid_credentials`: that code is a `401`, and a `401` on an
 * authenticated route tells every client "your session is dead" - the mobile client reacts
 * by refreshing and, failing that, signing the user out. A mistyped password on a settings
 * screen must not do that. The caller is authenticated; this action is what is refused.
 *
 * A missing user row is `token_invalid` for the reason `GET /v1/me` gives: the token
 * verified but its account is gone, and the client's right move is to log in again.
 */
async function confirmPassword(db: Db, userId: string, presented: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw problems.tokenInvalid('Access token does not belong to an existing account.');

  const ok = await verifyPassword(presented, user.passwordHash);
  if (!ok) throw new ApiProblem('forbidden', 'The password is incorrect.');
  return user;
}

export interface ChangePasswordInput {
  readonly currentPassword: string;
  readonly newPassword: string;
}

/**
 * Change the password, end every other session, and hand this device a fresh one.
 *
 * Every refresh token of the account is revoked in the same transaction as the new hash.
 * That is the point of changing a password after a suspected compromise: whoever holds a
 * stolen refresh token (good for 60 days) must lose it with the old password. This device
 * is issued a replacement so the user is not signed out of the app they are standing in.
 *
 * What this does *not* do: revoke access tokens, which are stateless 1-hour JWTs. A stolen
 * access token keeps working until it expires. The contract says so on this endpoint.
 */
export async function changePassword(
  db: Db,
  userId: string,
  input: ChangePasswordInput,
): Promise<TokenPair> {
  await confirmPassword(db, userId, input.currentPassword);

  // Hashed before the transaction opens, as in `signup`: argon2id would otherwise hold a
  // connection for ~50ms for no reason.
  const passwordHash = await hashPassword(input.newPassword);

  const tokens = await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return issueSession(tx, userId);
  });

  logger.info('password changed', { userId });
  return tokens;
}

export interface ChangeEmailInput {
  readonly email: string;
  readonly password: string;
}

/**
 * Change the sign-in email and return the updated user.
 *
 * The password is re-checked first: an email is where a reset would be sent, so a stolen
 * access token alone must not be enough to take the account over. Sessions are left alone -
 * nothing in a token carries the email, and the person is still the same person.
 *
 * Uniqueness is decided by the database (`isUniqueViolation`), not by a read first: two
 * people claiming one address at once must not both succeed.
 */
export async function changeEmail(db: Db, userId: string, input: ChangeEmailInput) {
  const current = await confirmPassword(db, userId, input.password);
  const email = normaliseEmail(input.email);

  if (email === current.email) {
    throw problems.validation('That is already the email on this account.', {
      issues: [{ path: 'email', message: 'That is already the email on this account.' }],
    });
  }

  try {
    // The new address is unproven, and a code mailed to the old one must not confirm it.
    const updated = await db.$transaction(async (tx) => {
      await tx.emailVerificationCode.deleteMany({ where: { userId } });
      return tx.user.update({ where: { id: userId }, data: { email, emailVerifiedAt: null } });
    });
    logger.info('email changed', { userId });
    return toWireUser(updated);
  } catch (error) {
    if (isUniqueViolation(error, 'email')) throw problems.emailAlreadyExists();
    throw error;
  }
}

/**
 * Permanently delete the account and everything it owns.
 *
 * Expenses go first and explicitly. Every other table cascades from `users`, but an expense
 * references its category with `onDelete: Restrict` (a category cleanup must never be able
 * to silently take spend history with it), and a cascade from the user deletes categories
 * and expenses in an order Postgres does not promise - so relying on it would make this
 * either flaky or a constraint error. Removing the expenses first leaves the cascade nothing
 * to trip over.
 *
 * Hard delete, not a tombstone: the account's whole purpose here is to stop existing, and a
 * soft-deleted user row would still hold the email address against re-registration.
 */
export async function deleteAccount(db: Db, userId: string, password: string): Promise<void> {
  await confirmPassword(db, userId, password);

  await db.$transaction(async (tx) => {
    await tx.expense.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });
  });

  logger.info('account deleted', { userId });
}
