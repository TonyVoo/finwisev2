import { presentAccountError, presentVerifyError } from '@/account/accountErrors';
import { ApiRequestError, NetworkUnavailableError } from '@/api/errors';
import { COPY } from '@/copy/strings';

const GENERIC_ERROR = COPY.error.generic;

const problem = (status: number, code: ApiRequestError['code']) =>
  new ApiRequestError({ status, code, message: `${code} from the test` });

describe('presentAccountError', () => {
  it('explains that an owner must delete the household before the account', () => {
    expect(presentAccountError(problem(409, 'household_has_members'), 'deleteAccount')).toEqual({
      passwordError: null,
      banner: COPY.household.error.household_has_members,
    });
  });

  it('puts a wrong password on the password field, not in a banner', () => {
    expect(presentAccountError(problem(403, 'forbidden'), 'changePassword')).toEqual({
      passwordError: COPY.account.wrongPassword,
      banner: null,
    });
  });

  it('says which action is blocked when offline, and that differs per action', () => {
    const offline = new NetworkUnavailableError(new Error('down'));
    expect(presentAccountError(offline, 'changePassword').banner).toBe(
      COPY.account.changePassword.offline,
    );
    expect(presentAccountError(offline, 'deleteAccount').banner).toBe(
      COPY.account.deleteAccount.offline,
    );
    expect(COPY.account.changePassword.offline).not.toBe(COPY.account.deleteAccount.offline);
  });

  it('puts a taken address on the email field, only for change-email', () => {
    expect(presentAccountError(problem(409, 'email_already_exists'), 'changeEmail')).toEqual({
      passwordError: null,
      banner: null,
      emailError: COPY.account.changeEmail.taken,
    });
    expect(presentAccountError(problem(409, 'email_already_exists'), 'deleteAccount').banner).toBe(
      GENERIC_ERROR,
    );
  });

  it('keeps wrong-password, offline and throttled apart', () => {
    const wrong = presentAccountError(problem(403, 'forbidden'), 'deleteAccount');
    const offline = presentAccountError(new NetworkUnavailableError('x'), 'deleteAccount');
    const limited = presentAccountError(problem(429, 'rate_limited'), 'deleteAccount');

    expect(limited).toEqual({ passwordError: null, banner: COPY.account.tooManyAttempts });
    expect(new Set([wrong.passwordError, offline.banner, limited.banner]).size).toBe(3);
  });

  it('falls back to the generic banner for anything else, never a raw code', () => {
    for (const error of [
      problem(500, 'internal_error'),
      problem(400, 'validation_error'),
      new Error('boom'),
    ]) {
      expect(presentAccountError(error, 'changePassword')).toEqual({
        passwordError: null,
        banner: GENERIC_ERROR,
      });
    }
  });
});

describe('presentVerifyError', () => {
  it('puts a bad code on the Code field, only when confirming', () => {
    expect(presentVerifyError(problem(400, 'invalid_verification_code'), 'confirm')).toEqual({
      codeError: COPY.verifyEmail.invalidCode,
      banner: null,
    });
    expect(presentVerifyError(problem(400, 'invalid_verification_code'), 'request')).toEqual({
      codeError: null,
      banner: GENERIC_ERROR,
    });
  });

  it('names the blocked action offline, and shows throttling as a banner', () => {
    expect(
      presentVerifyError(new NetworkUnavailableError(new Error('down')), 'confirm').banner,
    ).toBe(COPY.verifyEmail.offline);
    expect(presentVerifyError(problem(429, 'rate_limited'), 'request').banner).toBe(
      COPY.account.tooManyAttempts,
    );
  });

  it('falls back to the generic banner', () => {
    expect(presentVerifyError(problem(500, 'internal_error'), 'confirm')).toEqual({
      codeError: null,
      banner: GENERIC_ERROR,
    });
  });
});
