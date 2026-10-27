import { z } from 'zod';

/**
 * The one error shape. Every non-2xx response body in this API is an {@link ApiError}.
 *
 * `code` is the stable, machine-readable contract — clients branch on it. `message` is
 * human-readable and may change without notice; never parse it.
 */

/**
 * Exhaustive list of `error.code` values. Adding one is a contract change and goes
 * through Chief. Each entry documents the HTTP status it is returned with.
 */
export const ERROR_CODES = [
  /** 400 — request body/query/params failed schema validation. `details.issues` lists the fields. */
  'validation_error',
  /** 400 — body was not parseable JSON, or a required body was absent. */
  'malformed_request',
  /** 400 — an email-verification code was wrong, expired, for a different address, or out of attempts. Does not say which. */
  'invalid_verification_code',
  /** 400 — a password-reset code was wrong, expired, already used, or out of attempts. Deliberately does not say which, nor whether the email has an account. */
  'invalid_reset_code',
  /** 400 — an opaque pagination `cursor` could not be decoded (truncated, tampered, or from an older server). */
  'invalid_cursor',
  /** 415 — `Content-Type` was not `application/json` on a request with a body. */
  'unsupported_media_type',
  /** 401 — no credentials presented (missing or non-Bearer `Authorization` header). */
  'unauthorized',
  /** 401 — email/password pair did not match. Deliberately does not say which half was wrong. */
  'invalid_credentials',
  /** 401 — the access or refresh token is well-formed but past its expiry. Client should refresh. */
  'token_expired',
  /** 401 — token signature/shape is bad, or the refresh token is unknown, revoked, or already rotated. Client must re-login. */
  'token_invalid',
  /** 403 — authenticated, but not permitted to perform this action. Cross-tenant row access is reported as `not_found`, not this. */
  'forbidden',
  /** 404 — no such route, or no such row for this user. Cross-tenant reads are reported as 404, not 403, so ids cannot be probed. */
  'not_found',
  /** 409 — signup with an email that already has an account. */
  'email_already_exists',
  /** 409 (REST) / per-record `invalid` (sync) — another live category of this user already has that name (names are unique per user, case-insensitive). */
  'category_name_taken',
  /** 409 (REST) / per-record `invalid` (sync) — attempt to delete the user's default `Uncategorized` category, which must always exist. */
  'category_not_deletable',
  /** 422 (REST) / per-record `invalid` (sync) — `categoryId` does not name a live category of this user. */
  'unknown_category',
  /** 422 (REST) / per-record `invalid` (sync) — the request tried to set a server-owned field (`id`, `revision`, `createdAt`, `userId`). */
  'immutable_field',
  /** 409 / per-record `invalid` (sync) — a `clientMutationId` was reused with a different payload. */
  'mutation_id_reused',
  /** 413 — a `POST /v1/sync` batch exceeded `LIMITS.SYNC_MAX_BATCH_SIZE`, or the body exceeded the server limit. */
  'batch_too_large',
  /** 429 — too many requests. `Retry-After` is set. */
  'rate_limited',
  /** 502 — the exchange-rate provider could not be reached or gave an unusable answer. Retry later, or enter the rate by hand. */
  'rates_unavailable',
  /** 500 — unexpected server fault. Never leaks internals; correlate via the logged request id. */
  'internal_error',
] as const;

export const ErrorCode = z
  .enum(ERROR_CODES)
  .describe('Stable, machine-readable error code. Branch on this, never on `message`.');

/** Structured, optional detail. Shape depends on `code`; always treat as best-effort. */
export const ErrorDetails = z
  .looseObject({
    /** Field-level issues, present for `validation_error`. */
    issues: z
      .array(
        z.looseObject({
          path: z
            .string()
            .describe('Dotted path to the offending field, e.g. "fields.amountMinor".'),
          message: z.string(),
        }),
      )
      .optional(),
  })
  .describe('Optional structured detail. Present for validation_error; may be absent otherwise.');

export const ApiErrorBody = z.strictObject({
  code: ErrorCode,
  message: z
    .string()
    .describe('Human-readable explanation. For logs and developers; not for parsing.'),
  details: ErrorDetails.optional(),
});

/** The error envelope: the body of every non-2xx response. */
export const ApiError = z.strictObject({
  error: ApiErrorBody,
});

export type ErrorCode = z.infer<typeof ErrorCode>;
export type ErrorDetails = z.infer<typeof ErrorDetails>;
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
export type ApiError = z.infer<typeof ApiError>;

/** The HTTP status each `code` is returned with, for the server's error mapper. */
export const ERROR_CODE_STATUS: Readonly<Record<ErrorCode, number>> = {
  validation_error: 400,
  malformed_request: 400,
  invalid_verification_code: 400,
  invalid_reset_code: 400,
  invalid_cursor: 400,
  unsupported_media_type: 415,
  unauthorized: 401,
  invalid_credentials: 401,
  token_expired: 401,
  token_invalid: 401,
  forbidden: 403,
  not_found: 404,
  email_already_exists: 409,
  category_name_taken: 409,
  category_not_deletable: 409,
  unknown_category: 422,
  immutable_field: 422,
  mutation_id_reused: 409,
  batch_too_large: 413,
  rate_limited: 429,
  rates_unavailable: 502,
  internal_error: 500,
};

/** Build an error envelope. Used by the backend's error middleware. */
export function apiError(code: ErrorCode, message: string, details?: ErrorDetails): ApiError {
  return details === undefined
    ? { error: { code, message } }
    : { error: { code, message, details } };
}
