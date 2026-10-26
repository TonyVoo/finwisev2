import { presentAccountError } from '@/account/accountErrors';
import { ApiRequestError, NetworkUnavailableError } from '@/api/errors';
import { COPY, GENERIC_ERROR } from '@/copy/strings';

const problem = (status: number, code: ApiRequestError['code']) =>
  new ApiRequestError({ status, code, message: `${code} from the test` });

describe('presentAccountError', () => {
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
