import { ApiRequestError, NetworkUnavailableError } from '@/api/errors';
import { presentResetError } from '@/auth/resetErrors';
import { COPY } from '@/copy/strings';

const GENERIC_ERROR = COPY.error.generic;

const problem = (status: number, code: ApiRequestError['code']) =>
  new ApiRequestError({ status, code, message: `${code} from the test` });

describe('presentResetError', () => {
  it('puts a bad code on the Code field, only when resetting', () => {
    expect(presentResetError(problem(400, 'invalid_reset_code'), 'resetPassword')).toEqual({
      codeError: COPY.resetPassword.invalidCode,
      banner: null,
    });
    expect(presentResetError(problem(400, 'invalid_reset_code'), 'forgotPassword').banner).toBe(
      GENERIC_ERROR,
    );
  });

  it('says which action is blocked when offline', () => {
    const offline = new NetworkUnavailableError(new Error('down'));
    expect(presentResetError(offline, 'forgotPassword').banner).toBe(COPY.forgotPassword.offline);
    expect(presentResetError(offline, 'resetPassword').banner).toBe(COPY.resetPassword.offline);
  });

  it('shows the throttle as a banner and everything else as the generic one', () => {
    expect(presentResetError(problem(429, 'rate_limited'), 'resetPassword')).toEqual({
      codeError: null,
      banner: COPY.account.tooManyAttempts,
    });
    for (const error of [problem(500, 'internal_error'), new Error('boom')]) {
      expect(presentResetError(error, 'resetPassword')).toEqual({
        codeError: null,
        banner: GENERIC_ERROR,
      });
    }
  });
});
