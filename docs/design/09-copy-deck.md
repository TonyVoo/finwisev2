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
| `summary.trend.title`             | `Last 6 months`                              | Summary, trend card heading       |
| `form.title.add`                  | `Add expense`                                | Expense form                      |
| `form.title.edit`                 | `Edit expense`                               | Expense form                      |
| `form.field.category`             | `Category`                                   | Expense form                      |
| `form.field.date`                 | `Date`                                       | Expense form                      |
| `form.field.note`                 | `Note`                                       | Expense form                      |
| `form.field.note.placeholder`     | `Add a note (optional)`                      | Expense form                      |
| `form.field.receipt` | `Receipt` | Expense form, row |
| `form.field.receiptAdd` | `Add a photo` | Expense form, row value |
| `form.field.receiptAttached` | `Photo attached` | Expense form, row value |
| `form.receipt.title` | `Receipt` | Receipt sheet |
| `form.receipt.take` | `Take photo` | Receipt sheet, button |
| `form.receipt.choose` | `Choose from library` | Receipt sheet, button |
| `form.receipt.remove` | `Remove photo` | Receipt sheet, button |
| `form.receipt.loading` | `Loading photo…` | Receipt sheet |
| `form.receipt.unavailable` | `Connect to the internet to view this photo.` | Receipt sheet |
| `form.receipt.deniedCamera` | `Allow camera access in Settings to photograph a receipt.` | Snackbar |
| `form.receipt.deniedLibrary` | `Allow photo access in Settings to attach a receipt.` | Snackbar |
| `form.receipt.failed` | `Could not use that photo. Try another.` | Snackbar |
| `form.receipt.imageLabel` | `Receipt photo` | Receipt sheet, image label |
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
| `settings.verifyEmail`            | `Verify email`                               | Settings, row                     |
| `settings.unverified`             | `Unverified`                                 | Settings, row value               |
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
| `invalid_verification_code` | `That code is incorrect or has expired.`                                           | Verify email, Code field                         |
| `invalid_reset_code`     | `That code is incorrect or has expired.`                                              | Reset password, Code field                       |
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
| `invalid_invite_code`    | `That code is incorrect or has expired.`                                              | Join household, Code field                       |
| `household_exists`       | `You are already in a household.`                                                     | Household screen, banner                         |
| `not_in_household`       | `You are not in a household.`                                                         | Household screen, banner                         |
| `household_owner_only`   | `Only the household owner can do that.`                                               | Household screen, banner                         |
| `owner_cannot_leave`     | `The owner cannot leave the household. Delete it instead.`                            | Household screen, banner                         |
| `household_has_members`  | `Transfer or delete your household before deleting your account.`                                 | Delete account, banner                           |
| `rates_unavailable`      | `Could not get today's exchange rate. Enter it yourself.`                             | Expense form, Rate field                         |
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
| `login.forgot`                    | `Forgot password?`                                              | Log in, link               |
| `forgotPassword.title`            | `Reset your password`                                           | Forgot password            |
| `forgotPassword.hint`             | `Enter your email and we will send you a 6-digit code.`         | Forgot password            |
| `forgotPassword.submit`           | `Send code`                                                     | Forgot password, button    |
| `forgotPassword.offline`          | `You need to be online to reset your password.`                 | Forgot password, banner    |
| `resetPassword.title`             | `Enter your code`                                               | Reset password             |
| `resetPassword.hint`              | `If an account exists for {email}, we sent it a 6-digit code. It works for 15 minutes.` | Reset password |
| `resetPassword.code`              | `Code`                                                          | Reset password, field      |
| `resetPassword.newPassword`       | `New password`                                                  | Reset password, field      |
| `resetPassword.submit`            | `Reset password`                                                | Reset password, button     |
| `resetPassword.resend`            | `Send a new code`                                               | Reset password, link       |
| `resetPassword.resent`            | `If that account exists, a new code is on its way.`             | Snackbar                   |
| `resetPassword.invalidCode`       | `That code is incorrect or has expired.`                        | Reset password, field error |
| `resetPassword.success`           | `Password changed. Log in with your new password.`              | Snackbar                   |
| `resetPassword.offline`           | `You need to be online to reset your password.`                 | Reset password, banner     |
| `verifyEmail.title`               | `Verify your email`                                             | Verify email               |
| `verifyEmail.hint`                | `We sent a 6-digit code to {email}. It works for 15 minutes.`   | Verify email               |
| `verifyEmail.code`                | `Code`                                                          | Verify email, field        |
| `verifyEmail.submit`              | `Verify`                                                        | Verify email, button       |
| `verifyEmail.resend`              | `Send a new code`                                               | Verify email, link         |
| `verifyEmail.resent`              | `A new code is on its way.`                                     | Snackbar                   |
| `verifyEmail.invalidCode`         | `That code is incorrect or has expired.`                        | Verify email, field error  |
| `verifyEmail.success`             | `Email verified.`                                               | Snackbar                   |
| `verifyEmail.offline`             | `You need to be online to verify your email.`                   | Verify email, banner       |
| `account.changeEmail.title`       | `Change email`                                                  | Change email               |
| `account.changeEmail.hint`        | `This is the address you log in with.`                          | Change email               |
| `account.changeEmail.new`         | `New email`                                                     | Change email, field        |
| `account.changeEmail.password`    | `Password`                                                      | Change email, field        |
| `account.changeEmail.submit`      | `Change email`                                                  | Change email, button       |
| `account.changeEmail.same`        | `That is already your email.`                                   | Change email, field error  |
| `account.changeEmail.taken`       | `That email is already registered.`                             | Change email, field error  |
| `account.changeEmail.success`     | `Email changed.`                                                | Snackbar                   |
| `account.changeEmail.offline`     | `You need to be online to change your email.`                   | Change email, banner       |
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
| `category.field.budget`      | `Monthly budget (optional)`                                          | Category sheet, field label |
| `category.field.budgetPlaceholder` | `No budget`                                                    | Category sheet, field placeholder |
| `validation.category.budgetFormat` | `Enter an amount like 40 or 40.50.`                            | Category sheet, field error |
| `settings.recurring` | `Recurring expenses` | Settings |
| `settings.recurringHint` | `Rent, subscriptions and other regular payments.` | Settings |
| `recurring.title` | `Recurring expenses` | Recurring screen title |
| `recurring.fab` | `Add recurring expense` | Recurring screen, button |
| `recurring.new.title` | `New recurring expense` | Recurring sheet title |
| `recurring.edit.title` | `Edit recurring expense` | Recurring sheet title |
| `recurring.field.amount` | `Amount` | Recurring sheet, field label |
| `recurring.field.category` | `Category` | Recurring sheet, field label |
| `recurring.field.note` | `Note (optional)` | Recurring sheet, field label |
| `recurring.field.frequency` | `Repeats` | Recurring sheet, field label |
| `recurring.field.startDate` | `Starts` | Recurring sheet, field label |
| `recurring.field.endDate` | `Ends (optional)` | Recurring sheet, field label |
| `recurring.field.datePlaceholder` | `YYYY-MM-DD` | Recurring sheet, date placeholder |
| `recurring.field.endPlaceholder` | `Never` | Recurring sheet, end placeholder |
| `recurring.frequency.weekly` | `Weekly` | Recurring sheet, option |
| `recurring.frequency.monthly` | `Monthly` | Recurring sheet, option |
| `recurring.hint.pastStart` | `A start date in the past adds the expenses you missed.` | Recurring sheet, hint |
| `recurring.error.amount` | `Enter an amount like 12 or 12.99.` | Recurring sheet, field error |
| `recurring.error.date` | `Enter a date like 2026-11-05.` | Recurring sheet, field error |
| `recurring.error.endBeforeStart` | `The end date cannot be before the start date.` | Recurring sheet, field error |
| `recurring.error.noCategory` | `Add a category first.` | Recurring sheet, field error |
| `recurring.row.next` | `Next {date}` | Recurring list, row subtitle |
| `recurring.row.ended` | `Ended` | Recurring list, row subtitle |
| `recurring.create` | `Add` | Recurring sheet, button |
| `recurring.save` | `Save` | Recurring sheet, button |
| `recurring.delete` | `Delete recurring expense` | Recurring sheet, button |
| `recurring.deleteDialog.title` | `Delete this recurring expense?` | Delete dialog |
| `recurring.deleteDialog.body` | `Expenses it already added will stay. No new ones will be added.` | Delete dialog |
| `recurring.empty.headline` | `No recurring expenses` | Recurring list, empty |
| `recurring.empty.body` | `Add one and it will create the expense for you each week or month, even offline.` | Recurring list, empty |
| `snack.recurring.saved` | `Recurring expense saved.` | Snackbar |
| `snack.recurring.deleted` | `Recurring expense deleted.` | Snackbar |
| `settings.appearance` | `Appearance` | Settings, row title |
| `appearance.title` | `Appearance` | Theme sheet, title |
| `appearance.system` | `Match system` | Theme sheet, option and Settings row value |
| `appearance.light` | `Light` | Theme sheet, option and Settings row value |
| `appearance.dark` | `Dark` | Theme sheet, option and Settings row value |
| `home.budgetAlert.overOne` | `Over budget` | Home, budget banner title (one category) |
| `home.budgetAlert.overMany` | `{count} categories over budget` | Home, budget banner title |
| `home.budgetAlert.nearOne` | `Close to budget` | Home, budget banner title (one category) |
| `home.budgetAlert.nearMany` | `{count} categories close to budget` | Home, budget banner title |
| `home.budgetAlert.bodyOver` | `{names}: spending is past the monthly budget.` | Home, budget banner body |
| `home.budgetAlert.bodyNear` | `{names}: 80% or more of the monthly budget is used.` | Home, budget banner body |
| `home.budgetAlert.and` | `{names} and {last}` | Home, budget banner, two or three names |
| `home.budgetAlert.andMore` | `{names} and {count} more` | Home, budget banner, more than three names |
| `home.budgetAlert.open` | `See summary` | Home, budget banner button |
| `home.budgetAlert.dismiss` | `Dismiss` | Home, budget banner button |
| `summary.insights.title` | `Insights` | Summary, insights card heading |
| `summary.insights.up` | `You have spent {percent}% more than in {month}.` | Summary, insights card |
| `summary.insights.down` | `You have spent {percent}% less than in {month}.` | Summary, insights card |
| `summary.insights.same` | `Your spending is about the same as in {month}.` | Summary, insights card |
| `summary.insights.top` | `{name} is your biggest category, at {percent}% of the month.` | Summary, insights card |
| `summary.insights.rise` | `{name} is up {amount} on {month}.` | Summary, insights card |
| `form.title.addIncome` | `Add income` | Expense form, income mode |
| `form.title.editIncome` | `Edit income` | Expense form, income mode |
| `form.kind.expense` | `Expense` | Expense form, kind toggle |
| `form.kind.income` | `Income` | Expense form, kind toggle |
| `home.balance.income` | `Income {amount}` | Home and Summary, line under the total |
| `home.balance.net` | `Net {amount}` | Home and Summary, line under the total |
| `home.pace` | `On pace for {amount} this month` | Home, line under the total, current month only, once some money is spent |
| `home.incomeLabel` | `income` | Home, spoken prefix on an income row |
| `form.deleteIncome` | `Delete income` | Expense form, income mode |
| `recurring.reminder.title` | `Due tomorrow` | Notification, day before a recurring expense |
| `recurring.reminder.body` | `{name} · {amount}` | Notification, day before a recurring expense |
| `summary.insights.incomeUp` | `Your income is up {percent}% on {month}.` | Summary, insights card |
| `summary.insights.incomeDown` | `Your income is down {percent}% on {month}.` | Summary, insights card |
| `summary.insights.incomeSame` | `Your income is about the same as in {month}.` | Summary, insights card |
| `summary.insights.kept` | `You have kept {amount} of your income this month.` | Summary, insights card |
| `summary.insights.overspent` | `You have spent {amount} more than you earned this month.` | Summary, insights card |
| `summary.trend.spent` | `Spent` | Summary, trend legend |
| `summary.trend.income` | `Income` | Summary, trend legend |
| `settings.goals` | `Savings goals` | Settings row |
| `settings.goalsHint` | `Save towards something you want.` | Settings row, hint |
| `goals.title` | `Savings goals` | Goals screen title |
| `goals.fab` | `Add savings goal` | Goals screen, add button |
| `household.error.invalid_invite_code` | `That code is incorrect or has expired.` | Household screen, banner |
| `household.error.household_exists` | `You are already in a household.` | Household screen, banner |
| `household.error.not_in_household` | `You are not in a household.` | Household screen, banner |
| `household.error.household_owner_only` | `Only the household owner can do that.` | Household screen, banner |
| `household.error.owner_cannot_leave` | `The owner cannot leave the household. Delete it instead.` | Household screen, banner |
| `household.error.household_has_members` | `Transfer or delete your household before deleting your account.` | Household screen, banner |
| `household.title` | `Household` | Household screen |
| `household.empty.headline` | `Share your books` | Household screen |
| `household.empty.body` | `Keep one set of expenses with a partner or family. Everyone can see and add everything.` | Household screen |
| `household.create` | `Create a household` | Household screen |
| `household.join` | `Join with a code` | Household screen |
| `household.addedBy` | `Added by {name}` | Expense row, in a shared household |
| `household.addedByYou` | `Added by you` | Expense row, in a shared household |
| `household.members` | `Members` | Household screen |
| `household.role.owner` | `Owner` | Household screen |
| `household.role.member` | `Member` | Household screen |
| `household.you` | `You` | Household screen |
| `household.invite.action` | `Invite someone` | Household screen |
| `household.invite.title` | `Invite code` | Household screen |
| `household.invite.body` | `Share this code. It works once, for 48 hours.` | Household screen |
| `household.invite.share` | `Share code` | Household screen |
| `household.invite.message` | `Join my household in Expense Tracker with this code: {code}` | Household screen |
| `household.invite.close` | `Close` | Household screen |
| `household.joinSheet.title` | `Join a household` | Household screen |
| `household.joinSheet.field` | `Invite code` | Household screen |
| `household.joinSheet.hint` | `You will see the household's books. Your own expenses stay private and come back if you leave.` | Household screen |
| `household.joinSheet.submit` | `Join` | Household screen |
| `household.leave.action` | `Leave household` | Household screen |
| `household.leave.title` | `Leave this household?` | Household screen |
| `household.leave.body` | `You will go back to your own expenses. The household keeps what everyone added.` | Household screen |
| `household.leave.confirm` | `Leave` | Household screen |
| `household.delete.action` | `Delete household` | Household screen |
| `household.delete.title` | `Delete this household?` | Household screen |
| `household.delete.body` | `Everyone goes back to their own expenses. You keep the shared ones.` | Household screen |
| `household.delete.confirm` | `Delete` | Household screen |
| `household.remove.title` | `Remove {email}?` | Household screen |
| `household.remove.body` | `They will go back to their own expenses.` | Household screen |
| `household.remove.confirm` | `Remove` | Household screen |
| `household.syncFirst` | `Sync your changes first. Connect to the internet and try again.` | Household screen |
| `household.offline` | `Connect to the internet to manage your household.` | Household screen |
| `household.retry` | `Try again` | Household screen |
| `household.snack.created` | `Household created.` | Household screen |
| `household.snack.joined` | `You joined the household.` | Household screen |
| `household.snack.left` | `You left the household.` | Household screen |
| `household.snack.removed` | `Member removed.` | Household screen |
| `household.snack.deleted` | `Household deleted.` | Household screen |
| `household.a11y.removeMember` | `Remove {email}` | Household screen |
| `settings.household` | `Household` | Settings row |
| `settings.householdHint` | `Share your books with someone.` | Settings row hint |
| `goals.reminder.weekTitle` | `Goal due in a week` | Notification, 7 days before a savings goal's deadline |
| `goals.reminder.dayTitle` | `Goal due tomorrow` | Notification, the day before a savings goal's deadline |
| `goals.reminder.body` | `{name} · {remaining} to go` | Notification, both goal reminders |
| `goals.new.title` | `New savings goal` | Goal sheet, create |
| `goals.edit.title` | `Edit savings goal` | Goal sheet, edit |
| `goals.field.name` | `Name` | Goal sheet |
| `goals.field.target` | `Target` | Goal sheet |
| `goals.field.saved` | `Saved so far` | Goal sheet, edit |
| `goals.field.deadline` | `Deadline (optional)` | Goal sheet |
| `goals.field.deadlinePlaceholder` | `None` | Goal sheet, no deadline set |
| `goals.deposit.title` | `Add to {name}` | Deposit sheet |
| `goals.deposit.amount` | `Amount` | Deposit sheet |
| `goals.deposit.add` | `Add` | Deposit sheet, button |
| `goals.deposit.editGoal` | `Edit goal` | Deposit sheet, button |
| `goals.row.amounts` | `{saved} of {target}` | Goal row |
| `goals.row.reached` | `Goal reached` | Goal row, status |
| `goals.row.perMonth` | `Save {amount} a month to reach it by {date}` | Goal row, status |
| `goals.row.pastDeadline` | `Deadline was {date}` | Goal row, status |
| `goals.error.name` | `Enter a name for this goal.` | Goal sheet, validation |
| `goals.error.nameLong` | `That name is too long.` | Goal sheet, validation |
| `goals.error.amount` | `Enter an amount like 500 or 499.99.` | Goal sheet, validation |
| `goals.error.date` | `Enter a date like 2026-12-31.` | Goal sheet, validation |
| `goals.empty.headline` | `No savings goals yet` | Goals screen, empty |
| `goals.empty.body` | `Set a target for a holiday, a laptop or a rainy day, then add to it as you save.` | Goals screen, empty |
| `goals.create` | `Add` | Goal sheet, create button |
| `goals.save` | `Save` | Goal sheet, save button |
| `goals.delete` | `Delete savings goal` | Goal sheet, button |
| `goals.deleteDialog.title` | `Delete this goal?` | Delete dialog |
| `goals.deleteDialog.body` | `The goal and its progress are removed. Your expenses are not affected.` | Delete dialog |
| `goal.saved` | `Savings goal saved.` | Snackbar |
| `goal.deposited` | `Added to your goal.` | Snackbar |
| `goal.deleted` | `Savings goal deleted.` | Snackbar |
| `lock.title` | `Expense Tracker is locked` | Lock screen, heading |
| `lock.body` | `Unlock to see your expenses.` | Lock screen |
| `lock.unlock` | `Unlock` | Lock screen, button |
| `lock.reason` | `Unlock Expense Tracker` | System prompt, reason |
| `lock.enableReason` | `Turn on app lock` | System prompt, reason |
| `lock.disableReason` | `Turn off app lock` | System prompt, reason |
| `lock.failed` | `Could not unlock. Try again.` | Lock screen, error |
| `lock.unavailable` | `Set up Face ID, a fingerprint or a passcode on this device first.` | Settings, snackbar |
| `lock.settingsRow` | `App lock` | Settings row |
| `lock.settingsHint` | `Ask for Face ID or your passcode.` | Settings row, hint |
| `lock.notConfirmed` | `Could not confirm it is you, so app lock was not changed.` | Settings, snackbar |
| `home.paidIn` | `paid {amount}` | Home, spoken label of a foreign-currency row |
| `form.currency.title` | `Currency` | Currency sheet, title |
| `form.currency.row` | `Currency` | Expense form, currency row |
| `form.rate.label` | `Exchange rate` | Expense form, rate field |
| `form.rate.hint` | `1 {from} = {rate} {home}` | Expense form, rate field helper |
| `form.rate.converted` | `= {amount}` | Expense form, converted amount |
| `form.rate.loading` | `Getting the exchange rate…` | Expense form, rate field |
| `form.rate.failed` | `Could not get today's exchange rate. Enter it yourself.` | Expense form, rate field |
| `form.rate.needed` | `Enter the exchange rate.` | Expense form, Save hint |
| `form.rate.invalid` | `Enter a rate like 1.0823.` | Expense form, rate field error |
| `language.title` | `Language` | Language sheet and Settings row |
| `language.system` | `Match system` | Language sheet and Settings row |
| `language.en` | `English` | Language sheet and Settings row |
| `language.vi` | `Tiếng Việt` | Language sheet and Settings row |
| `currencyNames.USD` | `US Dollar` | Currency pickers |
| `currencyNames.EUR` | `Euro` | Currency pickers |
| `currencyNames.GBP` | `British Pound` | Currency pickers |
| `currencyNames.JPY` | `Japanese Yen` | Currency pickers |
| `currencyNames.CAD` | `Canadian Dollar` | Currency pickers |
| `currencyNames.AUD` | `Australian Dollar` | Currency pickers |
| `currencyNames.CHF` | `Swiss Franc` | Currency pickers |
| `currencyNames.INR` | `Indian Rupee` | Currency pickers |
| `currencyNames.BRL` | `Brazilian Real` | Currency pickers |
| `currencyNames.MXN` | `Mexican Peso` | Currency pickers |
| `a11y.jumpToMonth` | `Double tap to jump to another month.` | Screen-reader text |
| `a11y.editExpense` | `Double tap to edit this expense.` | Screen-reader text |
| `a11y.deleteExpense` | `Delete expense` | Screen-reader text |
| `a11y.payInOtherCurrency` | `Double tap to pay in another currency.` | Screen-reader text |
| `a11y.typeRate` | `Double tap to type your own exchange rate.` | Screen-reader text |
| `a11y.changeCategory` | `Double tap to change category.` | Screen-reader text |
| `a11y.editCategory` | `Double tap to edit this category.` | Screen-reader text |
| `a11y.editRecurring` | `Double tap to edit this recurring expense.` | Screen-reader text |
| `a11y.addToGoal` | `Double tap to add money to this goal.` | Screen-reader text |
| `a11y.deleteNamed` | `Delete {name}` | Screen-reader text |
| `a11y.previousMonth` | `Previous month, {month}` | Screen-reader text |
| `a11y.nextMonth` | `Next month, {month}` | Screen-reader text |
| `a11y.previousYear` | `Previous year, {year}` | Screen-reader text |
| `a11y.nextYear` | `Next year, {year}` | Screen-reader text |
| `a11y.amount` | `Amount, {amount}` | Screen-reader text |
| `a11y.doubleTapToChange` | `Double tap to change.` | Screen-reader text |
| `a11y.notSyncedYet` | `not synced yet` | Screen-reader text |
| `a11y.couldNotSync` | `could not sync` | Screen-reader text |
| `a11y.cannotBeDeleted` | `cannot be deleted` | Screen-reader text |
| `a11y.noExpenses` | `No expenses` | Screen-reader text |
| `a11y.expenseOne` | `1 expense` | Screen-reader text |
| `a11y.expenseMany` | `{count} expenses` | Screen-reader text |
| `notFound.headerTitle` | `Not found` | Not-found screen |
| `notFound.title` | `This screen does not exist.` | Not-found screen |
| `notFound.action` | `Go to the start` | Not-found screen |
| `boot.title` | `Expense Tracker could not start` | Start-up failure screen |
| `settings.renameCategories` | `Rename default categories` | Settings row |
| `settings.renameCategoriesHint` | `Switch the starter names to Vietnamese.` | Settings row, hint |
| `categoryRename.title` | `Rename {count} categories?` | Settings, rename offer |
| `categoryRename.body` | `Only the starter names you have not changed are renamed, on all your devices.` | Settings, rename offer |
| `categoryRename.confirm` | `Rename` | Settings, rename offer, button |
| `categoryRename.dismiss` | `Not now` | Settings, rename offer, button |
| `category.defaultsRenamed` | `Categories renamed.` | snackbar |
