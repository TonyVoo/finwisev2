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

  constructor(code: ErrorCode, message: string, details?: ErrorDetails) {
    super(message);
    this.name = 'ApiProblem';
    this.code = code;
    this.status = ERROR_CODE_STATUS[code];
    if (details !== undefined) this.details = details;
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
  batchTooLarge: (message = 'Request body is too large.') =>
    new ApiProblem('batch_too_large', message),
  internal: (message = 'Something went wrong.') => new ApiProblem('internal_error', message),
} as const;
