import {
  ERROR_CODE_STATUS,
  apiError,
  type ApiError,
  type ErrorCode,
  type ErrorDetails,
} from '@expense-tracker/shared';

/**
 * The one way this server reports a failure.
 *
 * Handlers and services `throw new ApiProblem(code, message)`; the error middleware
 * turns it into the contract's envelope with the status that `shared/` maps the code to.
 * Keeping the code→status table in `shared/` means the status for `not_found` is decided
 * once, in the same place the client reads it from.
 */
export class ApiProblem extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: ErrorDetails;
  /**
   * Seconds the client should wait, for the one code that carries a header.
   *
   * It lives on the problem rather than being set by whoever throws, so that the
   * contract's promise — a `429` *always* carries `Retry-After` — is kept at the single
   * place a non-2xx response is written (`middleware/errorHandler.ts`) instead of at
   * every throw site. A future second thrower of `rate_limited` cannot forget it.
   */
  readonly retryAfterSeconds?: number;

  constructor(
    code: ErrorCode,
    message: string,
    details?: ErrorDetails,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiProblem';
    this.code = code;
    this.status = ERROR_CODE_STATUS[code];
    if (details !== undefined) this.details = details;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }

  toEnvelope(): ApiError {
    return apiError(this.code, this.message, this.details);
  }
}

export function isApiProblem(error: unknown): error is ApiProblem {
  return error instanceof ApiProblem;
}

/**
 * Named constructors for the failures that have exactly one correct wording.
 *
 * `invalidCredentials` is the one that matters most: a wrong email and a wrong password
 * must be indistinguishable, or the endpoint becomes an account-enumeration oracle. One
 * function, one message, so no call site can accidentally be more helpful than that.
 */
export const problems = {
  validation: (message: string, details?: ErrorDetails) =>
    new ApiProblem('validation_error', message, details),
  malformedRequest: (message = 'Request body must be a JSON object.') =>
    new ApiProblem('malformed_request', message),
  unsupportedMediaType: (message = 'Content-Type must be application/json.') =>
    new ApiProblem('unsupported_media_type', message),
  unauthorized: (message = 'Authentication required.') => new ApiProblem('unauthorized', message),
  invalidCredentials: () =>
    new ApiProblem('invalid_credentials', 'Email or password is incorrect.'),
  tokenExpired: (message = 'Token has expired.') => new ApiProblem('token_expired', message),
  tokenInvalid: (message = 'Token is not valid.') => new ApiProblem('token_invalid', message),
  notFound: (message = 'Not found.') => new ApiProblem('not_found', message),
  emailAlreadyExists: () =>
    new ApiProblem('email_already_exists', 'An account with that email already exists.'),
  invalidCursor: (message = 'The pagination cursor could not be decoded.') =>
    new ApiProblem('invalid_cursor', message),
  categoryNameTaken: (name: string) =>
    new ApiProblem('category_name_taken', `A category named "${name}" already exists.`),
  categoryNotDeletable: () =>
    new ApiProblem('category_not_deletable', 'The default category cannot be deleted.'),
  /**
   * `categoryId` does not name a *live* category of this user.
   *
   * One function for all three ways that happens — no such id, another user's category,
   * a tombstoned one — because the three must be indistinguishable. Reporting the second
   * as `403` would turn the field into a probe for which ids exist.
   */
  unknownCategory: () =>
    new ApiProblem(
      'unknown_category',
      'categoryId does not name a live category of this account.',
      {
        issues: [{ path: 'categoryId', message: 'no such live category' }],
      },
    ),
  batchTooLarge: (message = 'Request body is too large.') =>
    new ApiProblem('batch_too_large', message),
  /**
   * Over a published rate limit.
   *
   * The message says nothing about *which* bucket was hit. On login the two buckets are
   * keyed by email and by source address, and saying which one tripped would tell a
   * caller whether anyone else has been failing against that email recently — a weaker
   * oracle than `invalid_credentials` would be, but the same kind, and there is no
   * reason for a client to know.
   */
  rateLimited: (retryAfterSeconds: number) =>
    new ApiProblem(
      'rate_limited',
      'Too many attempts. Wait for the period given in Retry-After and try again.',
      undefined,
      retryAfterSeconds,
    ),
  /** A reset code that did not work. One message for wrong, expired, used and exhausted. */
  invalidResetCode: () =>
    new ApiProblem('invalid_reset_code', 'That code is incorrect or has expired.'),
  internal: (message = 'Something went wrong.') => new ApiProblem('internal_error', message),
} as const;
