# Copy deck

Owner: Designer · Last updated: 2026-10-06

Every user-visible string in the MVP, in one place, so a wording change is a one-line diff
rather than a hunt through screens. The screen specs are authoritative for _placement_; this
doc is authoritative for _wording_.

English only in the MVP (`00-foundations.md` §7 note 6). Keys are given so the implementation
can lift them straight into a strings module.

---

## 0. Voice

Five rules, each of which is visible in the strings below.

1. **Say what happened, not that something happened.** `23 expenses moved to Uncategorized.`
   beats `Category deleted successfully.`
2. **Never apologise for being offline.** Offline is this app working as designed. No "Oops",
   no "Something went wrong", no sad-face copy for the normal case.
3. **No jargon from the sync layer.** The words _sync_, _pending_ and _offline_ are allowed
   because they are ordinary English. _Cursor_, _revision_, _outbox_, _tombstone_, _resync_,
   _conflict_ and _LWW_ are never shown to a user.
4. **Sentence case everywhere**, including buttons. `Delete category`, not `Delete Category`.
5. **Terminal punctuation on sentences, none on labels and buttons.** `Enter an amount above
zero.` has a full stop; `Save` does not. This matters for screen readers, which run
   unpunctuated sentences into the next element.

Interpolation is `{name}` style. Every string with a count has an explicit singular form — there
is no `(s)` anywhere.

---

## 1. Screen titles, labels and actions

| Key                               | String                                       | Where                             |
| --------------------------------- | -------------------------------------------- | --------------------------------- |
| `app.name`                        | `Expense Tracker`                            | Welcome                           |
| `welcome.tagline`                 | `Know where your money goes, online or not.` | Welcome                           |
| `welcome.cta.signup`              | `Create account`                             | Welcome                           |
| `welcome.cta.login`               | `I already have an account`                  | Welcome                           |
| `signup.title`                    | `Create your account`                        | Sign up                           |
| `signup.field.email`              | `Email`                                      | Sign up, Log in                   |
| `signup.field.email.placeholder`  | `you@example.com`                            | Sign up, Log in                   |
| `signup.field.password`           | `Password`                                   | Sign up, Log in                   |
| `signup.field.password.hint`      | `At least 8 characters`                      | Sign up                           |
| `signup.field.currency`           | `Currency`                                   | Sign up                           |
| `signup.field.currency.hint`      | `You cannot change this later.`              | Sign up                           |
| `signup.submit`                   | `Create account`                             | Sign up                           |
| `login.title`                     | `Welcome back`                               | Log in                            |
| `login.submit`                    | `Log in`                                     | Log in                            |
| `password.show`                   | `Show password`                              | a11y label                        |
| `password.hide`                   | `Hide password`                              | a11y label                        |
| `home.title`                      | `Expenses`                                   | Home                              |
| `home.total.current`              | `Total this month`                           | Home, Summary                     |
| `home.total.other`                | `Total`                                      | Home, Summary (non-current month) |
| `home.section.today`              | `Today`                                      | Home                              |
| `home.section.yesterday`          | `Yesterday`                                  | Home                              |
| `home.fab`                        | `Add expense`                                | a11y label                        |
| `summary.title`                   | `Summary`                                    | Summary                           |
| `summary.count`                   | `{count} expenses`                           | Summary                           |
| `summary.count.one`               | `1 expense`                                  | Summary                           |
| `form.title.add`                  | `Add expense`                                | Expense form                      |
| `form.title.edit`                 | `Edit expense`                               | Expense form                      |
| `form.field.category`             | `Category`                                   | Expense form                      |
| `form.field.date`                 | `Date`                                       | Expense form                      |
| `form.field.note`                 | `Note`                                       | Expense form                      |
| `form.field.note.placeholder`     | `Add a note (optional)`                      | Expense form                      |
| `form.save`                       | `Save`                                       | Expense form                      |
| `form.delete`                     | `Delete expense`                             | Expense form                      |
| `form.close`                      | `Close without saving`                       | a11y label                        |
| `form.date.today`                 | `Today`                                      | Date sheet                        |
| `form.date.yesterday`             | `Yesterday`                                  | Date sheet                        |
| `form.date.choose`                | `Choose a date…`                             | Date sheet                        |
| `form.keypad.decimal`             | `Decimal point`                              | a11y label                        |
| `form.keypad.backspace`           | `Delete last digit`                          | a11y label                        |
| `picker.category.title`           | `Category`                                   | Category picker sheet             |
| `picker.category.new`             | `New category`                               | Category picker sheet             |
| `picker.month.title`              | `Jump to month`                              | Month sheet                       |
| `picker.month.thisMonth`          | `This month`                                 | Month sheet                       |
| `categories.title`                | `Categories`                                 | Categories                        |
| `categories.fab`                  | `Add category`                               | a11y label                        |
| `category.new.title`              | `New category`                               | Create sheet                      |
| `category.edit.title`             | `Edit category`                              | Edit sheet                        |
| `category.field.name`             | `Name`                                       | Both sheets                       |
| `category.field.name.placeholder` | `e.g. Coffee`                                | Both sheets                       |
| `category.field.colour`           | `Colour`                                     | Both sheets                       |
| `category.colour.reserved`        | `This colour is reserved.`                   | Edit sheet, `isDefault` row       |
| `category.colour.inUse`           | `In use`                                     | Colour picker                     |
| `category.create`                 | `Create`                                     | Create sheet                      |
| `category.save`                   | `Save`                                       | Edit sheet                        |
| `category.delete`                 | `Delete category`                            | Edit sheet, delete dialog         |
| `settings.title`                  | `Settings`                                   | Settings                          |
| `settings.email`                  | `Email`                                      | Settings                          |
| `settings.currency`               | `Currency`                                   | Settings                          |
| `settings.currency.hint`          | `Set when you created your account.`         | Settings                          |
| `settings.categories`             | `Categories`                                 | Settings                          |
| `settings.logout`                 | `Log out`                                    | Settings                          |
| `common.cancel`                   | `Cancel`                                     | dialogs                           |
| `common.back`                     | `Back`                                       | a11y label                        |
| `common.close`                    | `Close`                                      | a11y label                        |
| `common.tryAgain`                 | `Try again`                                  | Sync sheet                        |
| `common.undo`                     | `Undo`                                       | snackbars                         |
| `common.view`                     | `View`                                       | snackbar action                   |
| `common.reload`                   | `Reload`                                     | conflict notice                   |

---

## 2. Errors

### 2.1 Error code → message

The authoritative code list is `ERROR_CODES` in `shared/src/errors.ts`. Every code is mapped,
including ones the UI should never provoke, because an unmapped code reaching a user shows a
blank banner.

| Code                     | User-facing message                                                                   | Placement                                        |
| ------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `validation_error`       | mapped per field from `details.issues`; unmapped paths fall back to `error.generic`   | field, else form banner                          |
| `malformed_request`      | `Something went wrong on our end. Try again.`                                         | form banner                                      |
| `invalid_cursor`         | _(never shown)_ — the client resets its cursor and retries silently                   | none                                             |
| `unsupported_media_type` | `Something went wrong on our end. Try again.`                                         | form banner                                      |
| `unauthorized`           | _(never shown)_ — triggers a token refresh, then a retry                              | none                                             |
| `invalid_credentials`    | `That email or password is incorrect.`                                                | Log in, form banner                              |
| `token_expired`          | _(never shown)_ — triggers a token refresh, then a retry                              | none                                             |
| `token_invalid`          | `Your session expired. Please log in again.`                                          | Welcome banner, after being returned to `(auth)` |
| `forbidden`              | `Something went wrong on our end. Try again.`                                         | form banner                                      |
| `not_found`              | `This expense no longer exists.` / `This category no longer exists.`                  | inline on the affected screen                    |
| `email_already_exists`   | `That email is already registered.`                                                   | Sign up, Email field                             |
| `category_name_taken`    | `You already have a category called "{name}".`                                        | Category sheet, Name field                       |
| `category_not_deletable` | `{fallbackName} can't be deleted. It's where expenses go when you delete a category.` | snackbar                                         |
| `unknown_category`       | `This category no longer exists. Pick another.`                                       | Expense form, Category field                     |
| `immutable_field`        | `Something went wrong on our end. Try again.`                                         | form banner                                      |
| `mutation_id_reused`     | _(never shown)_ — a client bug; logged, and the record is flagged `needs-attention`   | none                                             |
| `batch_too_large`        | _(never shown)_ — the client splits the batch and retries                             | none                                             |
| `rate_limited`           | `Too many attempts. Try again in a moment.`                                           | form banner                                      |
| `internal_error`         | `Something went wrong on our end. Try again.`                                         | form banner                                      |

Notes:

1. **`error.generic` = `Something went wrong on our end. Try again.`** It names the server
   deliberately: the user did nothing wrong, and a vague "Something went wrong" invites them to
   doubt their own input.
2. **Five codes are never shown.** Each is either handled transparently (refresh, cursor reset,
   batch split) or is a client bug. A code reaching a banner that is marked _never shown_ is a
   bug in the client, not a copy gap.
3. `error.message` from the server is **never** rendered to a user. It is for logs, as the
   contract states.
4. **An unrecognised code** — a newer server than this client — falls back to `error.generic`.
   The UI must never render the raw code.

### 2.2 Field validation

| Key                           | String                                         |
| ----------------------------- | ---------------------------------------------- |
| `validate.email.empty`        | `Enter your email address.`                    |
| `validate.email.invalid`      | `Enter a valid email address.`                 |
| `validate.password.empty`     | `Enter your password.`                         |
| `validate.password.short`     | `Use at least 8 characters.`                   |
| `validate.password.long`      | `Use at most 128 characters.`                  |
| `validate.category.empty`     | `Enter a name.`                                |
| `validate.category.duplicate` | `You already have a category called "{name}".` |
| `validate.amount.zero`        | `Enter an amount above zero.`                  |
| `validate.amount.max`         | `That is the largest amount you can enter.`    |
| `validate.amount.outOfRange`  | `This amount is out of range.`                 |
| `validate.nochange`           | `Make a change to save.`                       |
| `validate.nocategories`       | `Add a category first.`                        |

### 2.3 Blocking-offline copy

Only the two auth screens can be blocked by connectivity ([`03-auth.md`](./03-auth.md)).

| Key              | String                                        |
| ---------------- | --------------------------------------------- |
| `offline.signup` | `You need to be online to create an account.` |
| `offline.login`  | `You need to be online to log in.`            |

---

## 3. Confirmations and destructive flows

| Key                         | String                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `discard.title`             | `Discard changes?`                                                                    |
| `discard.body`              | `Your edits will not be saved.`                                                       |
| `discard.confirm`           | `Discard`                                                                             |
| `discard.cancel`            | `Keep editing`                                                                        |
| `logout.title`              | `Log out?`                                                                            |
| `logout.body.clean`         | `You can log back in at any time.`                                                    |
| `logout.body.pending`       | `Changes that have not synced yet will be lost.`                                      |
| `logout.confirm`            | `Log out`                                                                             |
| `category.delete.title`     | `Delete {name}?`                                                                      |
| `category.delete.body.many` | `Its {count} expenses will move to {fallbackName}. They won't be deleted.`            |
| `category.delete.body.one`  | `Its 1 expense will move to {fallbackName}. It won't be deleted.`                     |
| `category.delete.body.none` | `It has no expenses.`                                                                 |
| `category.delete.blocked`   | `{fallbackName} can't be deleted. It's where expenses go when you delete a category.` |

`{fallbackName}` is always read from the live `isDefault` category row, never hardcoded
(`00-foundations.md` §7 note 4). It is `Uncategorized` unless the user renamed it.

Note the contraction **"won't"** in the delete body, against the rest of the deck's more formal
register. It is deliberate: that sentence is the reassurance in the dialog, and it should read
as a person speaking rather than as a legal notice.

---

## 4. Sync states

Pill labels are terse; sheet copy and `accessibilityLabel`s are full sentences
([`02-offline-and-sync.md`](./02-offline-and-sync.md) §3 rule 6).

| State             | Pill label              | a11y label                                                                | Sheet headline    | Sheet body                                                                                    |
| ----------------- | ----------------------- | ------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------- |
| Idle              | _(nothing rendered)_    | —                                                                         | —                 | —                                                                                             |
| Syncing           | `Syncing…`              | `Syncing your changes.`                                                   | `Syncing`         | `Bringing your expenses up to date.`                                                          |
| Pending           | `{n} pending`           | `{n} changes waiting to sync. Double tap for details.`                    | `Waiting to sync` | `Your changes are saved on this device and will sync in a moment.`                            |
| Pending (1)       | `1 pending`             | `1 change waiting to sync. Double tap for details.`                       | `Waiting to sync` | as above                                                                                      |
| Offline           | `Offline`               | `Offline. Your changes are saved on this device. Double tap for details.` | `Offline`         | `Your changes are saved on this device and will sync automatically when you are back online.` |
| Offline + pending | `Offline · {n} pending` | `Offline, {n} changes waiting to sync. Double tap for details.`           | `Offline`         | as above                                                                                      |
| Error             | `Sync failed`           | `Sync failed. Double tap for details.`                                    | `Sync failed`     | `We could not reach the server. Your changes are safe on this device.`                        |

| Key                     | String                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `sync.sheet.title`      | `Sync`                                                                                                             |
| `sync.waiting.many`     | `{count} changes waiting`                                                                                          |
| `sync.waiting.one`      | `1 change waiting`                                                                                                 |
| `sync.waiting.more`     | `and {count} more`                                                                                                 |
| `sync.item.added`       | `Added`                                                                                                            |
| `sync.item.edited`      | `Edited`                                                                                                           |
| `sync.item.deleted`     | `Deleted`                                                                                                          |
| `sync.lastSynced`       | `Last synced {relative}`                                                                                           |
| `sync.lastSynced.never` | `Not synced yet`                                                                                                   |
| `sync.resync.title`     | `Catching up`                                                                                                      |
| `sync.resync.body`      | `You have not used the app in a while, so we are refreshing your expenses from scratch. This only takes a moment.` |
| `row.needsAttention`    | `Couldn't sync — tap to fix`                                                                                       |
| `conflict.changed`      | `This expense changed on another device.`                                                                          |
| `conflict.deleted`      | `This expense was deleted on another device.`                                                                      |

Every one of these says where the data _is_ — "saved on this device" — because the single
question a user has when they see a sync indicator is whether their work is at risk.

---

## 5. Relative time

Used only by `sync.lastSynced`. Computed against the device clock.

| Condition | String                             |
| --------- | ---------------------------------- |
| < 60s     | `just now`                         |
| < 60min   | `{n} minutes ago` / `1 minute ago` |
| < 24h     | `{n} hours ago` / `1 hour ago`     |
| < 7 days  | `{n} days ago` / `1 day ago`       |
| ≥ 7 days  | `on {d MMM yyyy}`                  |

A negative interval (a device clock that moved backwards) renders `just now` rather than a
future time. The app never shows `in 3 hours` for something that already happened.

---

## 6. Empty states

| Screen                       | Headline                            | Body                                                                        | Action                                                  |
| ---------------------------- | ----------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------- |
| Home, first run              | `No expenses yet`                   | `Add your first expense and it will show up here, with your monthly total.` | `Add your first expense`                                |
| Home, month with no expenses | `Nothing in {Month}`                | `You have no expenses recorded for this month.`                             | `Go to {CurrentMonth}` _(omitted when already current)_ |
| Home, filtered by category   | `No {category} expenses in {Month}` | `Clear the filter to see everything this month.`                            | `Clear filter`                                          |
| Summary, no expenses         | `Nothing to summarise`              | `Add an expense this month and you will see where your money went.`         | none                                                    |
| Category picker, none exist  | `No categories yet`                 | —                                                                           | `Create a category`                                     |

---

## 7. Snackbars

Every snackbar in the app. Auto-dismiss 5s, or 10s with a screen reader
(`00-foundations.md` §6).

| Key                             | String                                                                                | Action |
| ------------------------------- | ------------------------------------------------------------------------------------- | ------ |
| `snack.expense.saved`           | `Expense saved.`                                                                      | —      |
| `snack.expense.savedOtherMonth` | `Expense saved to {Month} {Year}.`                                                    | `View` |
| `snack.expense.updated`         | `Changes saved.`                                                                      | —      |
| `snack.expense.deleted`         | `Expense deleted.`                                                                    | `Undo` |
| `snack.expense.restored`        | `Expense restored.`                                                                   | —      |
| `snack.category.created`        | `{name} created.`                                                                     | —      |
| `snack.category.updated`        | `{name} updated.`                                                                     | —      |
| `snack.category.deleted.many`   | `{name} deleted. {count} expenses moved to {fallbackName}.`                           | —      |
| `snack.category.deleted.one`    | `{name} deleted. 1 expense moved to {fallbackName}.`                                  | —      |
| `snack.category.deleted.none`   | `{name} deleted.`                                                                     | —      |
| `snack.category.blocked`        | `{fallbackName} can't be deleted. It's where expenses go when you delete a category.` | —      |
| `snack.amount.max`              | `That is the largest amount you can enter.`                                           | —      |
| `snack.month.current`           | `This is the current month.`                                                          | —      |

**There is no success snackbar for a completed sync.** A `Synced!` confirmation would fire
constantly in normal use, train the user to dismiss notifications, and confirm something they
already believed was done ([`02-offline-and-sync.md`](./02-offline-and-sync.md) §2 rule 3).

---

## 8. Accessibility strings

Composed labels, as assembled by the screens. Absent parts are omitted along with their
separator.

| Element             | Composition                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| Expense row         | `{category}, {amount}, {note}, {dateLabel}` + `, not synced yet` + `, could not sync`                     |
| Expense row hint    | `Double tap to edit this expense.`                                                                        |
| Expense row action  | `Delete expense`                                                                                          |
| Category row        | `{name}, {count} expenses` / `, 1 expense` / `, no expenses` + `, not synced yet` + `, cannot be deleted` |
| Category row hint   | `Double tap to edit this category.`                                                                       |
| Category row action | `Delete {name}`                                                                                           |
| Month total         | `{totalLabel}, {amount}` _(Summary appends `, {count} expenses`)_                                         |
| Legend row          | `{name}, {amount}, {percent} percent of the month`                                                        |
| Legend row, <1%     | `{name}, {amount}, less than 1 percent of the month`                                                      |
| Legend row hint     | `Double tap to see these expenses.`                                                                       |
| Month prev / next   | `Previous month, {Month} {Year}` / `Next month, {Month} {Year}`                                           |
| Month label hint    | `Double tap to jump to another month.`                                                                    |
| Amount display      | `Amount, {amount}`                                                                                        |
| Busy button         | `{label}, in progress`                                                                                    |
| Filter chip         | `Filtered by {name}. Double tap to clear.`                                                                |
| Colour swatch       | `{ColourName}` — `Green`, `Orange`, `Blue`, `Indigo`, `Teal`, `Red`, `Pink`, `Purple`, `Ochre`, `Slate`   |

**Amounts in accessibility labels are the formatted currency string** (`$12.50`), which both
VoiceOver and TalkBack read as money. Never pass `amountMinor` to a label
(`00-foundations.md` §8 rule 3).

## 9. Post-MVP additions

Strings for features built after the MVP scope in `docs/PLAN.md` §1 was closed. They were
**not** written by the Designer: the developer transcribed them here so the copy test
(`mobile/tests/copy/strings.test.ts`) keeps holding every shipped string to this file. Treat
them as proposals the Designer can reword; changing a row here means changing
`mobile/src/copy/strings.ts` in the same commit.

| Key                          | Copy                                                                 | Where                      |
| ---------------------------- | -------------------------------------------------------------------- | -------------------------- |
| `settings.export`            | `Export expenses`                                                    | Settings                   |
| `settings.exportHint`        | `Save everything you have recorded as a CSV file.`                   | Settings                   |
| `settings.changePassword`    | `Change password`                                                    | Settings                   |
| `settings.deleteAccount`     | `Delete account`                                                     | Settings                   |
| `account.changePassword.title`    | `Change password`                                               | Change password            |
| `account.changePassword.hint`     | `You will be logged out on your other devices.`                 | Change password            |
| `account.changePassword.current`  | `Current password`                                              | Change password, field     |
| `account.changePassword.new`      | `New password`                                                  | Change password, field     |
| `account.changePassword.confirm`  | `Confirm new password`                                          | Change password, field     |
| `account.changePassword.submit`   | `Change password`                                               | Change password, button    |
| `account.changePassword.mismatch` | `The passwords do not match.`                                   | Change password, field error |
| `account.changePassword.same`     | `Choose a password different from your current one.`            | Change password, field error |
| `account.changePassword.success`  | `Password changed.`                                             | Snackbar                   |
| `account.changePassword.offline`  | `You need to be online to change your password.`                | Change password, banner    |
| `account.deleteAccount.title`     | `Delete account`                                                | Delete account             |
| `account.deleteAccount.warning`   | `This permanently deletes your account and every expense and category in it, on this device and on our server. It cannot be undone.` | Delete account |
| `account.deleteAccount.password`  | `Password`                                                      | Delete account, field      |
| `account.deleteAccount.submit`    | `Delete my account`                                             | Delete account, button     |
| `account.deleteAccount.dialogTitle` | `Delete your account?`                                        | Delete account, dialog     |
| `account.deleteAccount.dialogBody`  | `Everything will be gone for good. Export your expenses first if you want a copy.` | Delete account, dialog |
| `account.deleteAccount.confirm`   | `Delete account`                                                | Delete account, dialog     |
| `account.deleteAccount.offline`   | `You need to be online to delete your account.`                 | Delete account, banner     |
| `account.wrongPassword`           | `That password is incorrect.`                                   | Both, field error          |
| `account.tooManyAttempts`         | `Too many attempts. Try again in a moment.`                     | Both, banner               |
| `home.categoryReview.title`   | `Your categories are ready`                                         | Home, after signup         |
| `home.categoryReview.body`    | `We set up a few to get you started. Rename, remove or add your own any time.` | Home, after signup |
| `home.categoryReview.review`  | `Review categories`                                                 | Home, after signup, button |
| `home.categoryReview.dismiss` | `Not now`                                                           | Home, after signup, button |
| `export.busy`                | `Preparing your file`                                                | Settings, while exporting  |
| `export.empty`               | `There are no expenses to export yet.`                               | Snackbar                   |
| `export.unavailable`         | `Sharing files is not available on this device.`                     | Snackbar                   |
| `export.failed`              | `Could not export your expenses. Try again.`                         | Snackbar                   |
| `sync.sheet.idle.headline`   | `Up to date`                                                         | Sync sheet, already open when sync settles |
| `sync.sheet.idle.body`       | `Everything on this device has been synced.`                         | Sync sheet, already open when sync settles |
| `home.search.open`           | `Search expenses`                                                    | Home, a11y label           |
| `home.search.close`          | `Close search`                                                       | Home, a11y label           |
| `home.search.placeholder`    | `Search notes and categories`                                        | Home, search field         |
| `home.search.clear`          | `Clear search`                                                       | Home, a11y label           |
| `home.search.allCategories`  | `All categories`                                                     | Home, filter chip          |
| `home.search.resultsOne`     | `1 result`                                                           | Home, result summary       |
| `home.search.resultsMany`    | `{count} results`                                                    | Home, result summary       |
| `home.search.empty.headline` | `No matches`                                                         | Home, empty search         |
| `home.search.empty.body`     | `Nothing matches that search. Try different words or another category.` | Home, empty search      |
