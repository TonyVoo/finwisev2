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

// Type-only, and the one import this module has. The sync strings branch on which row of
// `02-offline-and-sync.md` §3 applies, so the formatters below take that state rather
// than a handful of booleans a caller could combine into a row the design does not have.
import type { SyncPillState } from '../sync/state';

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

  home: {
    title: 'Expenses',
    /** Element 6: the label changes with the month, the figure beside it does not. */
    total: { current: 'Total this month', other: 'Total' },
    section: { today: 'Today', yesterday: 'Yesterday' },
    fab: 'Add expense',
  },

  summary: {
    title: 'Summary',
    /**
     * The expense count under the total, which has an explicit singular form - deck §0:
     * "there is no `(s)` anywhere". Zero takes the plural, `0 expenses`, because the total
     * block renders in the empty state too (`08-monthly-summary.md` state `empty`).
     */
    count: { many: '{count} expenses', one: '1 expense' },
  },

  form: {
    title: { add: 'Add expense', edit: 'Edit expense' },
    field: {
      category: 'Category',
      date: 'Date',
      note: 'Note',
      notePlaceholder: 'Add a note (optional)',
    },
    save: 'Save',
    delete: 'Delete expense',
    close: 'Close without saving',
    /** The date sheet's three quick options (`06-expense-form.md` rule 7). */
    date: { today: 'Today', yesterday: 'Yesterday', choose: 'Choose a date…' },
    keypad: { decimal: 'Decimal point', backspace: 'Delete last digit' },
    /**
     * The note sheet's dismiss button (`06-expense-form.md` rule 10).
     *
     * Specified in the screen spec and **absent from the copy deck's §1 table**, the same
     * gap `signup.loginInstead` sits in. Named here rather than inlined in the component
     * so `tests/copy/strings.test.ts` accounts for it explicitly: the deck is
     * authoritative for wording, and a string that is nowhere in it should be visible as a
     * gap rather than buried in a sheet.
     */
    noteDone: 'Done',
    /**
     * State `error` (b) - edit mode with an id that is absent or tombstoned.
     *
     * Specified in `06-expense-form.md` §States and, like {@link noteDone}, **not in the
     * copy deck**: its §6 table covers empty states and has no row for this screen's error
     * state. Transcribed from the screen spec and named here so the deck gap is visible in
     * `tests/copy/strings.test.ts` rather than hidden in a component.
     */
    notFound: {
      headline: 'Expense not found',
      body: 'It may have been deleted on another device.',
      action: 'Back to expenses',
    },
  },

  picker: {
    category: { title: 'Category', new: 'New category' },
    month: { title: 'Jump to month', thisMonth: 'This month' },
  },

  categories: { title: 'Categories', fab: 'Add category' },

  category: {
    new: { title: 'New category' },
    edit: { title: 'Edit category' },
    field: { name: 'Name', namePlaceholder: 'e.g. Coffee', colour: 'Colour' },
    colour: { reserved: 'This colour is reserved.', inUse: 'In use' },
    create: 'Create',
    save: 'Save',
    delete: 'Delete category',
  },

  common: {
    back: 'Back',
    close: 'Close',
    cancel: 'Cancel',
    undo: 'Undo',
    view: 'View',
    delete: 'Delete',
    /** The sync sheet's retry, which exists in the error state only (§4 rule 1). */
    tryAgain: 'Try again',
  },

  settings: {
    title: 'Settings',
    email: 'Email',
    currency: 'Currency',
    currencyHint: 'Set when you created your account.',
    categories: 'Categories',
    logout: 'Log out',
  },
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
  category: {
    empty: 'Enter a name.',
    /** Interpolated by {@link categoryNameTaken}; `{name}` is the name as typed. */
    duplicate: 'You already have a category called "{name}".',
  },
  /**
   * The three amount messages, and they are not interchangeable: `zero` is guidance on a
   * form the user has not finished, `max` is a snackbar about a key press that was ignored,
   * and `outOfRange` is the only genuine amount *error* - it comes from a stored row rather
   * than from typing (`06-expense-form.md` rule 8).
   */
  amount: {
    zero: 'Enter an amount above zero.',
    max: 'That is the largest amount you can enter.',
    outOfRange: 'This amount is out of range.',
  },
  nochange: 'Make a change to save.',
  nocategories: 'Add a category first.',
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

/**
 * §6 — empty states.
 *
 * Home has two, and the difference between them is the whole point: a user with no
 * expenses at all is being taught what the app is for, and a user looking at a month they
 * happened not to spend in is not. So the first gets an illustration and a primary action
 * and the second gets neither (`04-expense-list.md` state `empty`).
 */
export const EMPTY_COPY = {
  home: {
    firstRun: {
      headline: 'No expenses yet',
      body: 'Add your first expense and it will show up here, with your monthly total.',
      action: 'Add your first expense',
    },
    month: {
      headline: 'Nothing in {Month}',
      body: 'You have no expenses recorded for this month.',
      action: 'Go to {CurrentMonth}',
    },
  },
  categoryPicker: { headline: 'No categories yet', action: 'Create a category' },
  /**
   * Summary, no expenses this month. No action, deliberately: the Expenses tab holds the
   * add action, and a second entry point to it on a summary screen would compete with the
   * first (`08-monthly-summary.md` state `empty`).
   */
  summary: {
    headline: 'Nothing to summarise',
    body: 'Add an expense this month and you will see where your money went.',
  },
} as const;

/** §3 — the dialogs that guard something irreversible, and one that is not a dialog. */
export const CONFIRM_COPY = {
  discard: {
    title: 'Discard changes?',
    body: 'Your edits will not be saved.',
    confirm: 'Discard',
    /**
     * `Keep editing`, not `Cancel`. In a dialog whose other button is `Discard`, "Cancel"
     * is ambiguous about which thing it cancels (`00-foundations.md` §6).
     */
    cancel: 'Keep editing',
  },
  categoryDelete: {
    title: 'Delete {name}?',
    /**
     * Three bodies by count, each with its own singular form - the deck has no `(s)`
     * anywhere. The second sentence of the first two is deliberately redundant with the
     * first: `Delete` is the louder word in the dialog and losing spend history is the
     * actual fear (`07-categories.md` §4 rule 2).
     */
    bodyMany: "Its {count} expenses will move to {fallbackName}. They won't be deleted.",
    bodyOne: "Its 1 expense will move to {fallbackName}. It won't be deleted.",
    bodyNone: 'It has no expenses.',
    blocked: "{fallbackName} can't be deleted. It's where expenses go when you delete a category.",
  },
} as const;

/** §7 — every snackbar in the app. */
export const SNACK_COPY = {
  expense: {
    saved: 'Expense saved.',
    /** Rule 9: a save outside the month on Home says which month it landed in. */
    savedOtherMonth: 'Expense saved to {Month} {Year}.',
    updated: 'Changes saved.',
    deleted: 'Expense deleted.',
    restored: 'Expense restored.',
  },
  category: {
    created: '{name} created.',
    updated: '{name} updated.',
    deletedMany: '{name} deleted. {count} expenses moved to {fallbackName}.',
    deletedOne: '{name} deleted. 1 expense moved to {fallbackName}.',
    deletedNone: '{name} deleted.',
    blocked: "{fallbackName} can't be deleted. It's where expenses go when you delete a category.",
  },
  amount: { max: 'That is the largest amount you can enter.' },
  month: { current: 'This is the current month.' },
} as const;

/**
 * §4 - the sync pill, the sync sheet and the resync takeover.
 *
 * Three things about this table are specification rather than wording, and all three are
 * easy to lose in a paraphrase:
 *
 * - **The pill label and the accessibility label are different strings**, not the same
 *   string read twice. `02-offline-and-sync.md` §3 rule 6 requires the full sentence for a
 *   screen reader - `"Offline, 3 changes waiting to sync. Double tap for details."` - where
 *   the pill shows `Offline · 3 pending`. A terse label read aloud is close to meaningless.
 * - **Every string says where the data is.** "saved on this device" appears in three of
 *   them, because the one question a sync indicator raises is whether the user's work is
 *   at risk, and the answer is no.
 * - **The idle state has no copy at all.** Not `Synced`, not a tick (§3 rule 1), so there
 *   is deliberately nothing here to render in it.
 *
 * The singular forms are separate entries rather than a pluralisation rule: §3 rule 5
 * names `1 pending`, never `1 pendings`, and the sheet and a11y variants need `1 change`
 * against `{count} changes`.
 */
export const SYNC_COPY = {
  pill: {
    syncing: 'Syncing…',
    pending: '{n} pending',
    offline: 'Offline',
    offlinePending: 'Offline · {n} pending',
    error: 'Sync failed',
  },
  a11y: {
    syncing: 'Syncing your changes.',
    pendingMany: '{n} changes waiting to sync. Double tap for details.',
    pendingOne: '1 change waiting to sync. Double tap for details.',
    offline: 'Offline. Your changes are saved on this device. Double tap for details.',
    offlinePendingMany: 'Offline, {n} changes waiting to sync. Double tap for details.',
    /**
     * Not in the deck's table, which gives only the plural. Spelled out rather than
     * generated so the singular cannot read `1 changes` - the same rule §3 rule 5 states
     * for the pill, applied to the sentence the deck only wrote once.
     */
    offlinePendingOne: 'Offline, 1 change waiting to sync. Double tap for details.',
    error: 'Sync failed. Double tap for details.',
  },
  sheet: {
    title: 'Sync',
    syncing: { headline: 'Syncing', body: 'Bringing your expenses up to date.' },
    pending: {
      headline: 'Waiting to sync',
      body: 'Your changes are saved on this device and will sync in a moment.',
    },
    offline: {
      headline: 'Offline',
      body: 'Your changes are saved on this device and will sync automatically when you are back online.',
    },
    error: {
      headline: 'Sync failed',
      body: 'We could not reach the server. Your changes are safe on this device.',
    },
    waitingMany: '{count} changes waiting',
    waitingOne: '1 change waiting',
    waitingMore: 'and {count} more',
    added: 'Added',
    edited: 'Edited',
    deleted: 'Deleted',
    lastSynced: 'Last synced {relative}',
    lastSyncedNever: 'Not synced yet',
  },
  /**
   * §5.3. The copy never says "resync", "cursor", "horizon" or "wiped": the user's mental
   * model is "my expenses", and the mechanism is not their problem.
   */
  resync: {
    title: 'Catching up',
    body: 'You have not used the app in a while, so we are refreshing your expenses from scratch. This only takes a moment.',
  },
} as const;

/** §5 - the relative times `sync.lastSynced` is built from. */
export const RELATIVE_TIME_COPY = {
  justNow: 'just now',
  minutesAgo: '{n} minutes ago',
  minuteAgo: '1 minute ago',
  hoursAgo: '{n} hours ago',
  hourAgo: '1 hour ago',
  daysAgo: '{n} days ago',
  dayAgo: '1 day ago',
  /** `≥ 7 days`, rendered as an absolute date: `on 3 Oct 2026`. */
  onDate: 'on {date}',
} as const;

/**
 * Fill a `{placeholder}` template from the deck.
 *
 * The templates above are stored **exactly as the deck writes them**, interpolation braces
 * and all, which is what lets `tests/copy/strings.test.ts` diff them against the deck
 * verbatim. A formatter that built `Its 23 expenses will move to Uncategorized.` out of
 * fragments would put half of each sentence beyond that check, which is precisely where
 * wording drifts.
 *
 * An unknown placeholder throws rather than rendering `{count}` to a user: a template and
 * its call site falling out of step is a bug, and a literal brace on screen is the kind of
 * thing that ships.
 */
function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) {
      throw new Error(`No value for {${key}} in copy template: ${template}`);
    }
    return String(value);
  });
}

export function categoryNameTaken(name: string): string {
  return fill(VALIDATION_COPY.category.duplicate, { name });
}

export function emptyMonthHeadline(month: string): string {
  return fill(EMPTY_COPY.home.month.headline, { Month: month });
}

export function goToMonthAction(month: string): string {
  return fill(EMPTY_COPY.home.month.action, { CurrentMonth: month });
}

/**
 * The Summary's expense count, in the singular at exactly one.
 *
 * Zero is the plural form (`0 expenses`), which is what the empty state shows beside
 * `$0.00` - the figure is not hidden there, because "hiding it would make the number
 * appear to pop into existence later" (`04-expense-list.md` state `empty`).
 */
export function summaryExpenseCount(count: number): string {
  const { many, one } = COPY.summary.count;
  return count === 1 ? one : fill(many, { count });
}

export function categoryDeleteTitle(name: string): string {
  return fill(CONFIRM_COPY.categoryDelete.title, { name });
}

/**
 * The delete dialog's body, chosen by count.
 *
 * `fallbackName` is always the live `isDefault` row's name and never the literal
 * "Uncategorized": the user may have renamed it (`07-categories.md` §4 rule 3).
 */
export function categoryDeleteBody(count: number, fallbackName: string): string {
  const { bodyMany, bodyOne, bodyNone } = CONFIRM_COPY.categoryDelete;
  if (count === 0) return bodyNone;
  if (count === 1) return fill(bodyOne, { fallbackName });
  return fill(bodyMany, { count, fallbackName });
}

export function categoryDeleteBlocked(fallbackName: string): string {
  return fill(CONFIRM_COPY.categoryDelete.blocked, { fallbackName });
}

export function expenseSavedToMonth(month: string, year: number | string): string {
  return fill(SNACK_COPY.expense.savedOtherMonth, { Month: month, Year: year });
}

export function categoryCreated(name: string): string {
  return fill(SNACK_COPY.category.created, { name });
}

export function categoryUpdated(name: string): string {
  return fill(SNACK_COPY.category.updated, { name });
}

/** The result snackbar, which reports what happened rather than that it happened (§0 rule 1). */
export function categoryDeleted(name: string, count: number, fallbackName: string): string {
  const { deletedMany, deletedOne, deletedNone } = SNACK_COPY.category;
  if (count === 0) return fill(deletedNone, { name });
  if (count === 1) return fill(deletedOne, { name, fallbackName });
  return fill(deletedMany, { name, count, fallbackName });
}

/**
 * The pill's two labels for one state (§3 rule 6).
 *
 * `null` in either position is state 1, which renders nothing at all - not an empty pill,
 * so there is no label to return for it either.
 */
export function syncPillLabel(state: SyncPillState, pendingRecords: number): string | null {
  switch (state) {
    case 'idle':
      return null;
    case 'syncing':
      return SYNC_COPY.pill.syncing;
    case 'pending':
      return fill(SYNC_COPY.pill.pending, { n: pendingRecords });
    case 'offline':
      return SYNC_COPY.pill.offline;
    case 'offline-pending':
      return fill(SYNC_COPY.pill.offlinePending, { n: pendingRecords });
    case 'error':
      return SYNC_COPY.pill.error;
  }
}

export function syncPillA11yLabel(state: SyncPillState, pendingRecords: number): string | null {
  const { a11y } = SYNC_COPY;
  switch (state) {
    case 'idle':
      return null;
    case 'syncing':
      return a11y.syncing;
    case 'pending':
      return pendingRecords === 1 ? a11y.pendingOne : fill(a11y.pendingMany, { n: pendingRecords });
    case 'offline':
      return a11y.offline;
    case 'offline-pending':
      return pendingRecords === 1
        ? a11y.offlinePendingOne
        : fill(a11y.offlinePendingMany, { n: pendingRecords });
    case 'error':
      return a11y.error;
  }
}

/** The sheet's headline and body for a state. The idle state cannot open the sheet (§4 rule 5). */
export function syncSheetCopy(state: SyncPillState): {
  readonly headline: string;
  readonly body: string;
} {
  const { sheet } = SYNC_COPY;
  switch (state) {
    case 'syncing':
      return sheet.syncing;
    case 'error':
      return sheet.error;
    case 'offline':
    case 'offline-pending':
      return sheet.offline;
    // `pending`, and `idle` only if something ever opens the sheet without a pill: the
    // reassuring copy is the right thing to read in both.
    default:
      return sheet.pending;
  }
}

/** `{n} changes waiting`, omitted by the caller at zero (§4, pending section header). */
export function syncWaitingHeader(count: number): string {
  const { waitingMany, waitingOne } = SYNC_COPY.sheet;
  return count === 1 ? waitingOne : fill(waitingMany, { count });
}

/** The sheet lists at most five pending items and counts the rest (§4, pending item). */
export function syncWaitingMore(count: number): string {
  return fill(SYNC_COPY.sheet.waitingMore, { count });
}

export function lastSyncedLabel(relative: string | null): string {
  const { lastSynced, lastSyncedNever } = SYNC_COPY.sheet;
  return relative === null ? lastSyncedNever : fill(lastSynced, { relative });
}
