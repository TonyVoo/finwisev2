import { z } from 'zod';

/**
 * Primitive wire types shared by every resource.
 *
 * These exist so that "what is an id", "what is money" and "what is a date" are
 * answered exactly once. Everything else in this package composes them.
 */

/** Hard limits that both sides must agree on. Exported so neither hard-codes them. */
export const LIMITS = {
  /** Max items in a single `POST /v1/sync` batch. Over this: HTTP 413 `batch_too_large`. */
  SYNC_MAX_BATCH_SIZE: 500,
  /** Default `limit` for `GET /v1/sync` when the client omits it. */
  SYNC_PULL_DEFAULT_LIMIT: 200,
  /** Max `limit` for `GET /v1/sync`. */
  SYNC_PULL_MAX_LIMIT: 500,
  /** Default `limit` for `GET /v1/expenses`. */
  EXPENSE_LIST_DEFAULT_LIMIT: 50,
  /** Max `limit` for `GET /v1/expenses`. */
  EXPENSE_LIST_MAX_LIMIT: 200,
  /**
   * The server clamps a client-supplied `updatedAt` to `now + 5 minutes`.
   * A device with a badly-set clock would otherwise write a far-future
   * `updatedAt` and permanently win every later conflict on that row.
   */
  CLIENT_CLOCK_SKEW_CLAMP_MS: 5 * 60 * 1000,
  /**
   * Tombstones (`deletedAt != null` rows) are pruned after this many days.
   * A `since` cursor older than the oldest surviving tombstone cannot be served
   * incrementally, so the server answers `resyncRequired: true`.
   */
  TOMBSTONE_HORIZON_DAYS: 90,
  CATEGORY_NAME_MAX: 64,
  EXPENSE_NOTE_MAX: 500,
  PASSWORD_MIN: 8,
  PASSWORD_MAX: 128,
  EMAIL_MAX: 254,
  /** Largest accepted `amountMinor`: ~10 billion major units. */
  AMOUNT_MINOR_MAX: 999_999_999_999,
  /**
   * Login throttling (`POST /v1/auth/login`, `TVO-38`), published in the OpenAPI contract.
   *
   * One window length for both buckets: 15 minutes. Long enough that guessing at the
   * limit is not worth an attacker's time, short enough that a user whose email was
   * targeted is locked out for a bounded, stated period rather than until someone
   * intervenes. It is also the ceiling of `Retry-After` on a login `429`.
   */
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: 15 * 60,
  /**
   * Failed logins one email address may accrue per window before the next attempt is
   * `429 rate_limited`. Cleared by a successful login. Ten leaves room for an honest user
   * who forgets which password they used and stops well short of a dictionary run.
   */
  LOGIN_MAX_FAILURES_PER_EMAIL: 10,
  /**
   * Failed logins one source address may accrue per window, across every email. Higher
   * than the per-email figure on purpose - several people can share an address - but low
   * enough to catch one guess against each of many accounts. Never cleared by a success,
   * so a spray cannot be refunded by landing one lucky login partway through.
   */
  LOGIN_MAX_FAILURES_PER_IP: 50,
  /**
   * Wrong "current password" answers one *account* may accrue per window across
   * `POST /v1/me/password` and `DELETE /v1/me`, before the next attempt is
   * `429 rate_limited`. Keyed on the user the access token names, so there is no
   * per-address bucket to bypass: the caller already holds a valid token and the only thing
   * being guarded is the password behind it. Cleared by a correct answer; the window is the
   * login window.
   */
  PASSWORD_CONFIRM_MAX_FAILURES_PER_USER: 10,
  /** Digits in a password-reset code. */
  RESET_CODE_LENGTH: 6,
  /** How long a reset code works, in minutes. */
  RESET_CODE_TTL_MINUTES: 15,
  /**
   * Wrong guesses one reset code survives. At six digits a million codes are possible, so
   * five guesses is a one-in-200,000 shot, and the code is dead after the fifth.
   */
  RESET_CODE_MAX_ATTEMPTS: 5,
  /**
   * Requests (`forgot-password`) per email, and per source address, per window - counted
   * whatever the outcome, because the endpoint answers the same for every email and so a
   * success and a miss cannot be told apart. Bounds both mail-bombing one inbox and
   * enumerating addresses by volume. The window is the login window.
   */
  RESET_REQUEST_MAX_PER_EMAIL: 5,
  RESET_REQUEST_MAX_PER_IP: 30,
  /** `reset-password` attempts per source address per window, counted whatever the outcome. */
  RESET_ATTEMPT_MAX_PER_IP: 30,
  /** Verification codes one account may request per window (each send counts). */
  VERIFY_REQUEST_MAX_PER_USER: 5,
  /** Longest display name, in characters, after trimming. */
  DISPLAY_NAME_MAX: 40,
  /** Characters in a household invite code. */
  INVITE_CODE_LENGTH: 8,
  /** How long an invite code works, in hours. */
  INVITE_CODE_TTL_HOURS: 48,
  /** Wrong invite codes one account may try per window, whatever the outcome. */
  INVITE_JOIN_MAX_PER_USER: 10,
  /** Largest receipt image, decoded. The app downsizes well below this before uploading. */
  RECEIPT_MAX_BYTES: 1_500_000,
  /** Longest `dataBase64` that can encode `RECEIPT_MAX_BYTES` (4 chars per 3 bytes). */
  RECEIPT_MAX_BASE64_LENGTH: 2_000_000,
  /** Receipt readings one account may ask for per rate-limit window: each spends the server's OCR budget. */
  RECEIPT_SCAN_MAX_PER_USER: 20,
} as const;

/**
 * Resource id. Clients mint **UUIDv7** offline and the server accepts it as-is, so a
 * row's identity never changes and foreign keys written offline stay valid. The server
 * accepts any RFC 9562 UUID version on read paths for forward compatibility.
 */
export const Uuid = z
  .uuid()
  .describe(
    'UUID. Clients mint UUIDv7 primary keys offline; the server accepts them as-is (no temp-id remapping).',
  );

/**
 * Per-user monotonic sequence number assigned by the server on every write.
 * This — not a timestamp — is what `GET /v1/sync?since=` walks.
 */
export const Revision = z
  .int()
  .min(0)
  .describe(
    'Server-assigned, per-user monotonic revision. Increments on every write to the row. Used as the sync watermark; NOT a timestamp.',
  );

/** Money amount in the currency's minor unit (cents for USD/EUR, yen for JPY). */
export const AmountMinor = z
  .int()
  .min(0)
  .max(LIMITS.AMOUNT_MINOR_MAX)
  .describe(
    'Amount in the currency minor unit as an integer (e.g. 1234 = 12.34 USD). Never a float and never a decimal string, at rest or on the wire.',
  );

/** ISO 4217 alphabetic currency code, uppercase. Single currency per user in the MVP. */
export const CurrencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/, 'must be a 3-letter uppercase ISO 4217 code')
  .describe(
    'ISO 4217 alphabetic currency code, uppercase (e.g. "USD"). One currency per user in the MVP; no conversion.',
  );

/**
 * A calendar date (`YYYY-MM-DD`) with **no time and no zone**: the day the user assigns
 * to an expense. Stored as Postgres `DATE` so it never shifts across timezones.
 * Deliberately a different type from {@link Timestamp}.
 */
export const CalendarDate = z.iso
  .date()
  .describe(
    'Calendar date, YYYY-MM-DD. Zone-less and time-less: the day the user assigned to the expense, stored as Postgres DATE so it cannot shift across timezones. Distinct from createdAt/updatedAt.',
  );

/**
 * An instant, RFC 3339 with an explicit offset (`timestamptz`). Used for
 * `createdAt` / `updatedAt` / `deletedAt`. Deliberately a different type from
 * {@link CalendarDate}.
 */
export const Timestamp = z.iso
  .datetime({ offset: true })
  .describe(
    'Instant in time, RFC 3339 with an explicit UTC offset (e.g. "2026-10-06T12:34:56.789Z"). Backed by Postgres timestamptz. Distinct from the calendar-date `date` field.',
  );

/** Opaque keyset cursor for `GET /v1/expenses`. Not a revision, not a timestamp. */
export const OpaqueCursor = z
  .string()
  .min(1)
  .max(512)
  .describe(
    'Opaque pagination cursor. Pass back verbatim; do not parse or construct. Unrelated to the sync `since` revision watermark.',
  );

export type Uuid = z.infer<typeof Uuid>;
export type Revision = z.infer<typeof Revision>;
export type AmountMinor = z.infer<typeof AmountMinor>;
export type CurrencyCode = z.infer<typeof CurrencyCode>;
export type CalendarDate = z.infer<typeof CalendarDate>;
export type Timestamp = z.infer<typeof Timestamp>;
export type OpaqueCursor = z.infer<typeof OpaqueCursor>;
