import { LIMITS } from '@expense-tracker/shared';
import { getConfig } from '../config.ts';
import { logger } from '../logger.ts';

/**
 * Outgoing email, behind one small interface.
 *
 * Only one message exists today (the password-reset code), so the interface is exactly
 * that and no more. Swapping the provider is a change to {@link createMailer} and nothing
 * else - the service asks for "send this person their code" and does not know how.
 */
export interface Mailer {
  sendPasswordResetCode(to: string, code: string): Promise<void>;
}

function resetEmail(code: string): { subject: string; text: string } {
  return {
    subject: 'Your Expense Tracker reset code',
    text:
      `Your password reset code is ${code}.\n\n` +
      `It works for ${LIMITS.RESET_CODE_TTL_MINUTES} minutes. If you did not ask to reset your ` +
      `password, ignore this email - your password has not been changed.`,
  };
}

/**
 * Development: print the code. It is the only way to complete a reset locally without a
 * mail account, and it is only reachable outside production - in production a mailer that
 * writes secrets to a log would be a leak, so there it says that nothing was sent instead.
 */
export function createConsoleMailer(options: { revealCode: boolean }): Mailer {
  return {
    async sendPasswordResetCode(to, code) {
      if (options.revealCode) {
        logger.info('password reset code (no mailer configured)', { to, code });
      } else {
        logger.warn('password reset requested but no mailer is configured; nothing was sent');
      }
    },
  };
}

/** Resend over HTTPS. A non-2xx answer throws, so the caller can log that it failed. */
export function createResendMailer(options: {
  apiKey: string;
  from: string;
  fetchImpl?: typeof fetch;
}): Mailer {
  const doFetch = options.fetchImpl ?? fetch;
  return {
    async sendPasswordResetCode(to, code) {
      const { subject, text } = resetEmail(code);
      const response = await doFetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: options.from, to: [to], subject, text }),
      });
      if (!response.ok) {
        throw new Error(`mail provider answered ${response.status}`);
      }
    },
  };
}

export function createMailer(): Mailer {
  const { mail, isProduction } = getConfig();
  if (mail.resendApiKey !== undefined && mail.from !== undefined) {
    return createResendMailer({ apiKey: mail.resendApiKey, from: mail.from });
  }
  return createConsoleMailer({ revealCode: !isProduction });
}

let current: Mailer | null = null;

/** The process's mailer, built on first use. */
export function getMailer(): Mailer {
  current ??= createMailer();
  return current;
}

/** Test seam: replace the mailer, or pass `null` to rebuild the default on next use. */
export function setMailerForTests(mailer: Mailer | null): void {
  current = mailer;
}
