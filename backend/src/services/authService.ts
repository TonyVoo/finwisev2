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
import { toWireUser } from '../db/mappers.ts';
import { nextRevisionBlock } from '../db/revision.ts';
import { problems } from '../errors.ts';
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
