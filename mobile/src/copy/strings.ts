/**
 * User-visible strings, lifted from `docs/design/09-copy-deck.md`.
 *
 * The deck is authoritative for wording and the screen specs for placement, so a wording
 * change is a one-line diff here rather than a hunt through screens. Keys match the
 * deck's keys exactly - `signup.field.email` is `signup.field.email` - so the two can be
 * diffed without a translation step. `tests/copy/strings.test.ts` asserts every string
 * below still appears in the deck.
 *
 * English only in the MVP, so these are plain constants rather than an i18n runtime.
 * The deck's voice rules show up as data: sentence case everywhere, terminal punctuation
 * on sentences and none on labels or buttons.
 */

/** §1 — screen titles, labels and actions. */
export const COPY = {
  app: { name: 'Expense Tracker' },

  welcome: {
    tagline: 'Know where your money goes, online or not.',
    cta: { signup: 'Create account', login: 'I already have an account' },
  },

  signup: {
    title: 'Create your account',
    field: {
      email: 'Email',
      emailPlaceholder: 'you@example.com',
      password: 'Password',
      passwordHint: 'At least 8 characters',
      currency: 'Currency',
      currencyHint: 'You cannot change this later.',
    },
    submit: 'Create account',
    /** §1.2 rule 4: offered beside the "already registered" error. */
    loginInstead: 'Log in instead',
  },

  login: { title: 'Welcome back', submit: 'Log in' },

  password: { show: 'Show password', hide: 'Hide password' },

  common: { back: 'Back', close: 'Close', cancel: 'Cancel' },

  settings: { logout: 'Log out' },
} as const;

/** §2.2 — field validation. The client only ever renders these for rules it enforces. */
export const VALIDATION_COPY = {
  email: {
    empty: 'Enter your email address.',
    invalid: 'Enter a valid email address.',
  },
  password: {
    empty: 'Enter your password.',
    short: 'Use at least 8 characters.',
    long: 'Use at most 128 characters.',
  },
} as const;

/**
 * §2.3 — the only two places in the app where being offline blocks the user.
 *
 * Every other screen works offline by design, which is why these two strings are
 * specific rather than a shared "no connection" string: they tell the user what they
 * cannot do right now, not that the network is down.
 */
export const OFFLINE_COPY = {
  signup: 'You need to be online to create an account.',
  login: 'You need to be online to log in.',
} as const;

/**
 * §2.1 note 1 - the fallback for anything the client cannot place on a field.
 *
 * It names the server deliberately: the user did nothing wrong, and a vague "Something
 * went wrong" invites them to doubt their own input.
 */
export const GENERIC_ERROR = 'Something went wrong on our end. Try again.';

/** The Welcome banner after a refresh failure cleared the session (§2.1, `token_invalid`). */
export const SESSION_EXPIRED = 'Your session expired. Please log in again.';
