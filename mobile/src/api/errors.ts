import { ApiError, type ErrorCode, type ErrorDetails } from '@expense-tracker/shared';

/**
 * Three failure kinds, kept apart on purpose.
 *
 * In an offline-first app the difference decides behaviour, not just a message:
 *
 * - {@link NetworkUnavailableError} is the **expected** condition. The request never
 *   reached a server. Sync retries later, nothing is shown to the user beyond the quiet
 *   sync pill, and no local state changes - in particular the session is never dropped,
 *   because being offline for a week must not log anyone out.
 * - {@link ApiRequestError} is a real answer from the server. It carries a stable `code`
 *   from the contract, which is what callers branch on.
 * - {@link ResponseShapeError} means the server answered something the shared schemas do
 *   not describe. That is a contract break on one side or the other, never a user
 *   problem, and it must not be retried.
 */

/** Code used when a non-2xx body is not the documented error envelope. */
export const UNKNOWN_ERROR_CODE = 'unknown_error';

export class ApiRequestError extends Error {
  readonly status: number;
  /** Stable machine-readable code. Branch on this, never on `message`. */
  readonly code: ErrorCode | typeof UNKNOWN_ERROR_CODE;
  readonly details: ErrorDetails | undefined;
  /** `X-Request-Id`, for correlating with a server log line. */
  readonly requestId: string | null;

  constructor(init: {
    status: number;
    code: ErrorCode | typeof UNKNOWN_ERROR_CODE;
    message: string;
    details?: ErrorDetails | undefined;
    requestId?: string | null;
  }) {
    super(init.message);
    this.name = 'ApiRequestError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId ?? null;
  }
}

export class NetworkUnavailableError extends Error {
  constructor(cause: unknown) {
    super('The request could not reach the server');
    this.name = 'NetworkUnavailableError';
    this.cause = cause;
  }
}

export class ResponseShapeError extends Error {
  readonly status: number;

  constructor(status: number, detail: string, cause?: unknown) {
    super(`Server response did not match the wire contract: ${detail}`);
    this.name = 'ResponseShapeError';
    this.status = status;
    this.cause = cause;
  }
}

/**
 * Build an {@link ApiRequestError} from a non-2xx response.
 *
 * Every non-2xx body in this API is the `{ error: { code, message } }` envelope. When
 * one is not - a proxy's HTML 502, a gateway timeout page - the status is still real and
 * worth reporting, so it degrades to {@link UNKNOWN_ERROR_CODE} rather than throwing a
 * second error that hides the first.
 */
export function toApiRequestError(
  status: number,
  body: unknown,
  requestId: string | null,
): ApiRequestError {
  const parsed = ApiError.safeParse(body);
  if (parsed.success) {
    return new ApiRequestError({
      status,
      code: parsed.data.error.code,
      message: parsed.data.error.message,
      details: parsed.data.error.details,
      requestId,
    });
  }

  return new ApiRequestError({
    status,
    code: UNKNOWN_ERROR_CODE,
    message: `Request failed with status ${status}`,
    requestId,
  });
}

/** True when `error` is a server answer carrying one of `codes`. */
export function isApiErrorCode(
  error: unknown,
  ...codes: readonly ErrorCode[]
): error is ApiRequestError {
  return error instanceof ApiRequestError && codes.includes(error.code as ErrorCode);
}
