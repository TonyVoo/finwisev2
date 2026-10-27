import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { LIMITS } from '@expense-tracker/shared';
import { v7 as uuidv7 } from 'uuid';
import { hashPassword } from '../auth/password.ts';
import { getConfig } from '../config.ts';
import type { Db } from '../db/client.ts';
import { problems } from '../errors.ts';
import { logger } from '../logger.ts';
import { normaliseEmail } from './authService.ts';
import { getMailer, type Mailer } from './mailer.ts';

/**
 * Password reset by emailed code.
 *
 * A code rather than a link because the client is a phone app: a link needs a verified
 * deep-link domain to open the app, and falls back to a browser that cannot finish the
 * job. Six digits is typeable from the notification, and the attempt cap below is what
 * makes six digits enough.
 *
 * The properties, each with the reason it is here:
 *
 *  * **No enumeration.** {@link requestPasswordReset} returns the same thing for an email
 *    that has an account and one that does not, and does not wait on the mail provider -
 *    otherwise the response time would be the answer.
 *  * **One live code per user.** A new request replaces the old one, and resets its
 *    attempt count, so asking again never leaves two codes to guess against.
 *  * **Five wrong guesses kill it** ({@link LIMITS.RESET_CODE_MAX_ATTEMPTS}). Without that
 *    cap a million-code space is a few hours of requests; with it, a guesser gets a
 *    1-in-200,000 shot per code and has to ask for a new one each time, which the
 *    per-email request limit counts.
 *  * **Single use.** The row is deleted in the same transaction that changes the password,
 *    and deleting it is what decides a race between two correct submissions.
 *  * **Stored as an HMAC**, keyed on the server secret and the user id, so a copy of the
 *    table is not a list of working codes.
 *  * **Every session ends.** Resetting is what someone does when they suspect compromise;
 *    a stolen refresh token (60 days) must not survive it.
 */

function codeHash(userId: string, code: string): string {
  return createHmac('sha256', getConfig().jwt.secret)
    .update(`reset:${userId}:${code}`)
    .digest('hex');
}

function generateCode(): string {
  return String(randomInt(0, 10 ** LIMITS.RESET_CODE_LENGTH)).padStart(
    LIMITS.RESET_CODE_LENGTH,
    '0',
  );
}

/**
 * Create and send a reset code, if an account uses this email. Always resolves the same.
 */
export async function requestPasswordReset(
  db: Db,
  email: string,
  mailer: Mailer = getMailer(),
  now: Date = new Date(),
): Promise<void> {
  const normalised = normaliseEmail(email);
  const user = await db.user.findUnique({ where: { email: normalised } });
  if (!user) {
    logger.info('password reset requested for unknown email');
    return;
  }

  const code = generateCode();
  const data = {
    codeHash: codeHash(user.id, code),
    expiresAt: new Date(now.getTime() + LIMITS.RESET_CODE_TTL_MINUTES * 60_000),
    attempts: 0,
  };
  await db.passwordResetCode.upsert({
    where: { userId: user.id },
    create: { id: uuidv7(), userId: user.id, ...data },
    update: data,
  });

  // Not awaited: see the note on enumeration above. A provider failure is logged, and the
  // user's remedy - ask again - is the same as for a lost email.
  void mailer.sendPasswordResetCode(user.email, code).catch((error: unknown) => {
    logger.error('password reset email failed', {
      userId: user.id,
      message: error instanceof Error ? error.message : String(error),
    });
  });
  logger.info('password reset code issued', { userId: user.id });
}

export interface ResetPasswordInput {
  readonly email: string;
  readonly code: string;
  readonly newPassword: string;
}

/**
 * Set a new password if the code is right, and end every session of the account.
 *
 * Every way of being wrong is the same `invalid_reset_code`, including an email with no
 * account: a distinguishable answer would be the enumeration oracle `requestPasswordReset`
 * took care not to be.
 */
export async function resetPassword(
  db: Db,
  input: ResetPasswordInput,
  now: Date = new Date(),
): Promise<void> {
  const user = await db.user.findUnique({ where: { email: normaliseEmail(input.email) } });
  const row = user ? await db.passwordResetCode.findUnique({ where: { userId: user.id } }) : null;

  if (!user || !row || row.expiresAt <= now || row.attempts >= LIMITS.RESET_CODE_MAX_ATTEMPTS) {
    throw problems.invalidResetCode();
  }

  const presented = Buffer.from(codeHash(user.id, input.code), 'hex');
  const expected = Buffer.from(row.codeHash, 'hex');
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    // `lt` in the filter, so two concurrent wrong guesses cannot both slip past the cap.
    await db.passwordResetCode.updateMany({
      where: { id: row.id, attempts: { lt: LIMITS.RESET_CODE_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    throw problems.invalidResetCode();
  }

  // Hashed before the transaction opens, as in signup and change-password.
  const passwordHash = await hashPassword(input.newPassword);

  await db.$transaction(async (tx) => {
    // Deleting the row is the single-use gate: if a second correct submission got here
    // first, this deletes nothing and this one is refused.
    const consumed = await tx.passwordResetCode.deleteMany({
      where: { id: row.id, attempts: { lt: LIMITS.RESET_CODE_MAX_ATTEMPTS } },
    });
    if (consumed.count !== 1) throw problems.invalidResetCode();

    // Reading the code proves the mailbox, so a reset also verifies the address.
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? now },
    });
    await tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now },
    });
  });

  logger.info('password reset', { userId: user.id });
}
