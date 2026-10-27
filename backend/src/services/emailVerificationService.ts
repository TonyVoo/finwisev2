import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { LIMITS } from '@expense-tracker/shared';
import { v7 as uuidv7 } from 'uuid';
import { getConfig } from '../config.ts';
import type { Db } from '../db/client.ts';
import { toWireUser } from '../db/mappers.ts';
import { problems } from '../errors.ts';
import { logger } from '../logger.ts';
import { getMailer, type Mailer } from './mailer.ts';

/**
 * Email verification by emailed code. Non-blocking: an unverified account works fully;
 * verifying only records that the address is readable by its owner.
 *
 * Same shape as the password-reset code and for the same reasons (HMAC at rest, one live
 * code per user, five wrong guesses kill it, single use). Differences: it is authenticated,
 * so there is no enumeration to avoid, and the code's HMAC uses a different domain prefix so
 * a reset code can never be replayed as a verification code or the reverse. Changing the
 * email deletes the pending code (see `authService.changeEmail`), so a code mailed to the old
 * address cannot confirm the new one.
 */

function codeHash(userId: string, code: string): string {
  return createHmac('sha256', getConfig().jwt.secret)
    .update(`verify:${userId}:${code}`)
    .digest('hex');
}

function generateCode(): string {
  return String(randomInt(0, 10 ** LIMITS.RESET_CODE_LENGTH)).padStart(
    LIMITS.RESET_CODE_LENGTH,
    '0',
  );
}

/**
 * Create a code and mail it. A no-op for an already-verified account. Mail is not awaited:
 * a provider failure is logged and the remedy (ask again) is the same as for a lost email.
 */
export async function sendEmailVerification(
  db: Db,
  userId: string,
  mailer: Mailer = getMailer(),
  now: Date = new Date(),
): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw problems.tokenInvalid('Access token does not belong to an existing account.');
  if (user.emailVerifiedAt !== null) return;

  const code = generateCode();
  const data = {
    codeHash: codeHash(user.id, code),
    expiresAt: new Date(now.getTime() + LIMITS.RESET_CODE_TTL_MINUTES * 60_000),
    attempts: 0,
  };
  await db.emailVerificationCode.upsert({
    where: { userId: user.id },
    create: { id: uuidv7(), userId: user.id, ...data },
    update: data,
  });

  try {
    void mailer.sendEmailVerificationCode(user.email, code).catch((error: unknown) => {
      logger.error('email verification email failed', {
        userId: user.id,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  } catch (error) {
    logger.error('email verification email failed', {
      userId: user.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  logger.info('email verification code issued', { userId: user.id });
}

/** Confirm the code, mark the address verified and return the updated user. */
export async function confirmEmailVerification(
  db: Db,
  userId: string,
  code: string,
  now: Date = new Date(),
) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw problems.tokenInvalid('Access token does not belong to an existing account.');
  // Already verified: confirming again is harmless and idempotent.
  if (user.emailVerifiedAt !== null) return toWireUser(user);

  const row = await db.emailVerificationCode.findUnique({ where: { userId } });
  if (!row || row.expiresAt <= now || row.attempts >= LIMITS.RESET_CODE_MAX_ATTEMPTS) {
    throw problems.invalidVerificationCode();
  }

  const presented = Buffer.from(codeHash(userId, code), 'hex');
  const expected = Buffer.from(row.codeHash, 'hex');
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    await db.emailVerificationCode.updateMany({
      where: { id: row.id, attempts: { lt: LIMITS.RESET_CODE_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    throw problems.invalidVerificationCode();
  }

  const updated = await db.$transaction(async (tx) => {
    const consumed = await tx.emailVerificationCode.deleteMany({
      where: { id: row.id, attempts: { lt: LIMITS.RESET_CODE_MAX_ATTEMPTS } },
    });
    if (consumed.count !== 1) throw problems.invalidVerificationCode();
    return tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: now } });
  });

  logger.info('email verified', { userId });
  return toWireUser(updated);
}
