# 4. Add / Edit expense

Owner: Designer · Last updated: 2026-10-06

### Purpose

Capture or correct one expense: amount, category, date, note. Optimised so the common case —
add an amount and a category, save — is three taps and a few digits.

### Route

- Add: `/(app)/expense/new`
- Edit: `/(app)/expense/[id]`

**One screen, two modes**, distinguished by whether the route carries an `id`
([`01-flows.md`](./01-flows.md) §1 note 2). Differences are confined to the title, the Delete
button, and prefill — listed in §Behaviour rule 1.

---

## Layout

```
+----------------------------------------+
| (x)      Add expense          Save     |   app bar; Save is a text action
+----------------------------------------+
|                                        |
|                 $12.50                 |   type.amountHero, centred,
|                                        |   tabular-nums
+----------------------------------------+
|  (tag)  Category        Groceries  (>) |   Row, 56
+----------------------------------------+
|  (cal)  Date               Today   (>) |   Row, 56
+----------------------------------------+
|  (doc)  Note                           |   Row, grows
|         Milk, eggs                     |
+----------------------------------------+
|                                        |
|            [ Delete expense ]          |   edit mode only, ghost danger
|                                        |
+----------------------------------------+
|   1      2      3                      |
|   4      5      6         keypad       |   bg.sunken backdrop
|   7      8      9                      |
|   .      0      (<x)                   |
+----------------------------------------+
```

The keypad is **pinned to the bottom and always visible** — it is not a system keyboard and it
never dismisses. The rows between the amount and the keypad scroll if they do not fit.

---

## Elements

| #   | Element         | Style                                                                                                                                                     | Copy                                                                                      | Tap target                             | Accessibility                                                                       |
| --- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | Close           | `x` 24, `text.primary`                                                                                                                                    | —                                                                                         | 44x44                                  | `role="button"`, label `Close without saving`                                       |
| 2   | Title           | `type.headline` / `text.primary`, centred                                                                                                                 | `Add expense` / `Edit expense`                                                            | none                                   | `role="header"`                                                                     |
| 3   | Save            | `type.bodyStrong` / `primary.default`, trailing, `space.4` from edge                                                                                      | `Save`                                                                                    | 44x44 min                              | `role="button"`; disabled state per rule 6                                          |
| 4   | Amount display  | `type.amountHero` / `text.primary`, centred, `tabular-nums`, `space.6` vertical                                                                           | formatted live value, e.g. `$12.50`                                                       | **the display itself is not tappable** | `role="header"`, label `Amount, $12.50`, `accessibilityLiveRegion="polite"`         |
| 5   | Amount error    | `type.footnote` / `danger.default`, centred, replaces nothing (reserves its line)                                                                         | per rule 8                                                                                | none                                   | announced                                                                           |
| 6   | Category row    | `Row` 56; leading `tag` 20 `text.tertiary`; label `type.body`; value = 16x16 swatch + name in `type.body` / `text.secondary`; trailing `chevron-right` 20 | label `Category`                                                                          | full row                               | `role="button"`, label `Category, Groceries`, hint `Double tap to change category.` |
| 7   | Date row        | `Row` 56; leading `calendar` 20; trailing `chevron-right` 20                                                                                              | label `Date`, value `Today` / `Yesterday` / `EEE d MMM yyyy`                              | full row                               | `role="button"`, label `Date, Today, 6 October 2026`                                |
| 8   | Note row        | `Row`, min 56, grows; leading `file-text` 20                                                                                                              | label `Note`; value = the note, or placeholder `Add a note (optional)` in `text.tertiary` | full row                               | `role="button"`, label `Note, Milk and eggs` or `Note, empty`                       |
| 9   | Delete          | `Button` `ghost` with `danger.default` label, full width, `space.6` above                                                                                 | `Delete expense`                                                                          | full button, 44                        | `role="button"`, label `Delete expense`                                             |
| 10  | Keypad backdrop | `bg.sunken`, full-bleed, respects bottom safe inset                                                                                                       | —                                                                                         | —                                      | `accessibilityElementsHidden` on the backdrop itself                                |
| 11  | Digit key       | 4 rows x 3 cols; each cell flexes, min 56 tall, `radius.md`, `bg.surface`, `type.title2` / `text.primary`; `space.2` gap                                  | `0`-`9`                                                                                   | full cell, ≥56x56                      | `role="button"`, label the digit                                                    |
| 12  | Decimal key     | as 11                                                                                                                                                     | the locale decimal separator, `.` or `,`                                                  | full cell                              | `role="button"`, label `Decimal point`; see rule 3                                  |
| 13  | Backspace key   | as 11, glyph `delete` 24 `text.primary`                                                                                                                   | —                                                                                         | full cell                              | `role="button"`, label `Delete last digit`                                          |
| 14  | Conflict notice | per [`02-offline-and-sync.md`](./02-offline-and-sync.md) §5.4                                                                                             | per that spec                                                                             | 44 on its action                       | announced                                                                           |

Element 5 **reserves its line height even when empty**, so showing an error never shifts the
keypad or the rows.

---

## States

| State                 | What the user sees                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default` — add       | Amount `$0.00` in `text.tertiary` (the zero reads as a placeholder, not a value); Category prefilled with the last-used category, or the `isDefault` category on the very first expense; Date `Today`; Note empty; no Delete button; Save **disabled** with helper text. Keypad visible and ready — **no field needs to be tapped first.**                                                                                                                                                                                      |
| `default` — edit      | Every field prefilled from SQLite. Amount in `text.primary`. Delete button present. Save disabled until something actually changes (rule 6).                                                                                                                                                                                                                                                                                                                                                                                    |
| `empty`               | Not applicable to a form. The nearest case is "no categories exist", covered in rule 4.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `loading:first-paint` | **Add mode: none** — there is nothing to load; the screen renders complete on the first frame. **Edit mode:** a single-frame skeleton (a 120x34 `bg.sunken` block in place of the amount, three skeleton rows) while the row is read by id from SQLite. If the id is not found, see `error`.                                                                                                                                                                                                                                    |
| `loading` — on save   | **None.** Save writes to SQLite and pops immediately. There is no spinner, no disabled-while-saving state, and no waiting on the network. This is the core offline promise: a save is as fast offline as online.                                                                                                                                                                                                                                                                                                                |
| `error`               | Two reachable cases. **(a) Invalid amount** — inline at element 5, per rule 8; Save stays disabled. **(b) Edit mode with an id that is absent or tombstoned** (a deep link, or the row was deleted on another device): the form is replaced by a centred message, `alert-circle` 48 in `text.tertiary`, headline `Expense not found` in `type.title2`, body `It may have been deleted on another device.` in `type.callout` / `text.secondary`, and a `secondary` button `Back to expenses`. No network error is possible here. |
| `offline-pending`     | Identical to `default` in every respect. **No banner, no sync pill on this screen, no disabled controls, no warning that the save will not reach the server yet.** The save will be queued, which is the normal path, and saying so would imply something is wrong. In edit mode on an already-`pending` row, the form shows no special treatment — the edit coalesces into the outbox ([`02-offline-and-sync.md`](./02-offline-and-sync.md) §2 rule 2).                                                                        |

---

## Behaviour

### 1. Add vs edit

|                   | Add                                       | Edit                                                                     |
| ----------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| Title             | `Add expense`                             | `Edit expense`                                                           |
| Amount            | `0` minor units, rendered `text.tertiary` | the row's `amountMinor`                                                  |
| Category          | last-used, else the `isDefault` category  | the row's `categoryId`                                                   |
| Date              | today                                     | the row's `date`                                                         |
| Note              | empty                                     | the row's `note`                                                         |
| Delete button     | absent                                    | present                                                                  |
| Save enabled when | `amountMinor > 0`                         | `amountMinor > 0` **and** at least one field differs from the loaded row |
| On save           | `INSERT` + outbox row, one transaction    | `UPDATE` + `updatedAt = now` + outbox row, one transaction               |
| Snackbar          | `Expense saved.`                          | `Changes saved.`                                                         |

"Last-used category" is the `categoryId` of the most recently created expense, read from SQLite,
**not** a separate persisted preference — so it is correct after a sync and needs no migration.
If that category has since been deleted, fall back to the `isDefault` category.

### 2. The amount model — the rule everything else follows from

> **The amount is held in state as an integer number of minor units. There is no string, and
> there is no `parseFloat`, at any point.**

The keypad mutates that integer directly. `12.50` on screen is the integer `1250` formatted for
display; it is never a text value that gets parsed back. This is why the spec can promise there
is no such thing as a malformed amount: a malformed amount is not representable.

```
digit d pressed:   next = value * 10 + d
backspace:         next = floor(value / 10)
```

Both are integer operations on minor units, so the digits shift in from the right exactly like a
cash register or a card terminal:

| Keys pressed | `amountMinor` | Displayed (USD) |
| ------------ | ------------- | --------------- |
| _(start)_    | `0`           | `$0.00`         |
| `1`          | `1`           | `$0.01`         |
| `2`          | `12`          | `$0.12`         |
| `5`          | `125`         | `$1.25`         |
| `0`          | `1250`        | `$12.50`        |
| backspace    | `125`         | `$1.25`         |
| backspace x3 | `0`           | `$0.00`         |

The consequences, which the implementation must not "improve" on:

- **There is no cursor, no selection, and no insertion point.** Digits only ever arrive at the
  right-hand end and only ever leave from it.
- **The display is not an editable `TextInput`.** It is a `Text`. A keyboard can never be
  focused into it, so free text can never reach it, so `0.1.2`, `12.3.4`, `--5`, `1e9`, `١٢` and
  an empty string are all unreachable inputs rather than cases to validate.
- **No currency symbol, grouping separator or decimal separator is ever part of the value.**
  They exist only in the formatted output.

### 3. The decimal key

The decimal key is a **convenience that is almost always a no-op**, because the shifting model
above already places the decimal point. Its exact behaviour:

- Pressing it sets a flag meaning "the next digits are the minor part".
- With the flag set and `k` digits already entered after it, a further digit multiplies and adds
  as usual **until `k` reaches the currency's decimal count, after which further digits are
  ignored** (see rule 5).
- Pressing it when the flag is already set does nothing. **Two decimal points cannot be
  entered.**
- Backspace clears the flag when the value returns to having no minor digits.
- **The key is hidden entirely for zero-decimal currencies** (`JPY`). Not disabled — hidden, and
  the `0` key expands to fill its cell, so the grid stays 4x3 with no gap. A decimal key on a
  currency without a minor unit is a control that can only confuse.

The decimals count comes from the user's `currency`, chosen at signup
([`03-auth.md`](./03-auth.md) §Behaviour rule 9), resolved via `Intl.NumberFormat(locale, {
currency }).resolvedOptions().minimumFractionDigits`. It is **not** hardcoded to 2.

### 4. Category

- The row opens a `Sheet` listing every live category, alphabetical with the `isDefault`
  category pinned last (`00-foundations.md` §7 note 5). Each row: 24x24 swatch, name in
  `type.body`, trailing `check` 20 in `primary.default` on the selected one. Tapping selects and
  dismisses.
- The sheet has a trailing `New category` `ghost` button that opens the create sheet from
  [`07-categories.md`](./07-categories.md) §3 inline. On create, the new category is selected
  automatically and both sheets dismiss — the user came here to pick a category, not to manage
  them.
- **A category is always set.** There is no "none" option; the `isDefault` category is the
  "I will sort this out later" choice, which is exactly what it exists for.
- **If no categories exist at all**, the sheet shows `No categories yet` with a `primary`
  `Create a category` button, and Save is disabled with the helper `Add a category first.` Two
  routes reach it: the post-signup category fetch failed and no sync has succeeded since
  ([`01-flows.md`](./01-flows.md) §2), or the user deleted every deletable one — and the second
  still leaves the undeletable `isDefault` row, so in practice the first is the only one. Both
  self-repair on the next successful sync.

### 5. Amount bounds

- `amountMinor` must satisfy `0 < amountMinor <= LIMITS.AMOUNT_MINOR_MAX` (999,999,999,999).
- **Input is capped, not rejected.** Once the value would exceed the maximum, further digit
  presses are **ignored** and the display is unchanged. On the first ignored press the key
  animates a `motion.fast` shake and the snackbar `That is the largest amount you can enter.`
  appears. The user is never shown an error about a number they cannot see, and never ends up
  with a value they must manually trim back.
- Equivalently, a digit is accepted only while `value * 10 + d <= AMOUNT_MINOR_MAX`.

### 6. Save enablement

Save is disabled when `amountMinor === 0`, and in edit mode also when nothing has changed. Per
`00-foundations.md` §6, a disabled button must state its reason, so the app bar's Save is
accompanied by helper text at element 5:

| Condition                  | Helper text at element 5      |
| -------------------------- | ----------------------------- |
| `amountMinor === 0`        | `Enter an amount above zero.` |
| edit mode, nothing changed | `Make a change to save.`      |
| no categories exist        | `Add a category first.`       |

The helper is `type.footnote` / `text.tertiary` (not `danger.default` — this is guidance, not an
error) and it occupies the same reserved line as the amount error.

**Zero is not a valid expense.** The contract permits `amountMinor: 0`
(`AmountMinor` is `.min(0)`), but a zero-value expense carries no information and is far more
likely to be an accidental save than an intention. The client therefore requires `> 0`; the
server stays permissive, which is the correct asymmetry.

### 7. Date

- The row opens a `Sheet` with three quick options as 56-tall rows — `Today`, `Yesterday`,
  `Choose a date…` — followed by the platform date picker (`@react-native-community/datetimepicker`)
  in `inline` display when `Choose a date…` is selected.
- Most expenses are entered the day they happen or the day after, so the two quick options cover
  the common case without opening a calendar at all.
- The selected date is stored as a `YYYY-MM-DD` string **built from the picker's local
  year/month/day components directly**. It must never be produced via `toISOString()`, which
  converts to UTC and shifts the date by a day for any user west of Greenwich in the evening.
  This is the single most likely date bug in this app.

### 8. Invalid amount — what "invalid" can actually mean

Because of rule 2, the classic invalid-amount cases are structurally unreachable. The table is
explicit about this so that no one implements validation for inputs that cannot occur:

| Case                                                      | Reachable?                                                 | Behaviour                                                                                                                                                                             |
| --------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-numeric characters                                    | **No** — the display is a `Text`, not an input             | nothing to handle                                                                                                                                                                     |
| Multiple decimal points                                   | **No** — rule 3                                            | nothing to handle                                                                                                                                                                     |
| Negative value                                            | **No** — no minus key exists; expenses are always positive | nothing to handle                                                                                                                                                                     |
| Empty value                                               | **No** — the value is an integer, minimum `0`              | nothing to handle                                                                                                                                                                     |
| More decimals than the currency allows                    | **No** — rule 3 caps them                                  | nothing to handle                                                                                                                                                                     |
| Zero                                                      | **Yes** — the initial state                                | Save disabled, helper `Enter an amount above zero.` (rule 6)                                                                                                                          |
| Above the maximum                                         | **Yes**                                                    | digits ignored + snackbar (rule 5)                                                                                                                                                    |
| A stored row with an out-of-range amount arriving by sync | **Yes** (a hostile or buggy peer)                          | render the value as-is, do not crash, do not auto-correct. Element 5 shows `This amount is out of range.` in `danger.default` and Save is disabled until the user changes the amount. |

The last row is the only genuine amount _error_ state, and it originates from data, not from
typing.

### 9. Date bounds

- A date **in the future is rejected**: the picker's `maximumDate` is today, and the quick
  options cannot produce one. An expense that has not happened yet is a budget, which is
  explicitly out of scope (`docs/PLAN.md` §Out of scope).
- There is no lower bound, matching [`05-month-switcher.md`](./05-month-switcher.md) rule 3.
- **Saving an expense dated outside the month currently selected on Home is allowed**, and the
  row then does not appear in the list the user returns to. That would be silently confusing, so
  the snackbar carries the month: `Expense saved to September 2026.` with a `View` action that
  switches Home to that month. Same-month saves keep the plain `Expense saved.`

### 10. Note

- Opens a `Sheet` with a multiline `TextInput`, 4 lines tall, autofocused, max 500 characters
  (`LIMITS.EXPENSE_NOTE_MAX`), with a `type.footnote` / `text.tertiary` counter `{n}/500` that
  turns `warning.default` above 450.
- Input is **hard-capped** at 500 characters; the 501st keystroke is dropped. No error is shown
  — the counter already communicates the limit, and an error for a limit the user cannot exceed
  is noise.
- Trailing and leading whitespace is trimmed on save (matching `ExpenseNote`'s `.trim()`). A note
  that is empty after trimming is stored as `null`, not as `""`, so the row renders without a
  subtitle line.
- `Done` dismisses the sheet and keeps the text; it does not save the expense.

### 11. Discarding

- `x` (element 1) and Android back: if nothing has been edited, close immediately. If anything
  has, show a `Dialog` — title `Discard changes?`, body `Your edits will not be saved.`, actions
  `Discard` (destructive) and `Keep editing`. Scrim tap and back resolve as `Keep editing`
  (`00-foundations.md` §6).
- In add mode, a nonzero amount counts as "something has been edited".

### 12. Delete (edit mode)

- Element 9 performs the same soft delete as the swipe on Home, so a screen-reader user has a
  reachable path ([`04-expense-list.md`](./04-expense-list.md) §Accessibility rule 3).
- **No confirmation dialog**, matching the swipe path: pop to Home, then show the
  `Expense deleted.` + `Undo` snackbar. Two different confirmation models for one action would
  be worse than either.

### 13. Save, concretely

In one SQLite transaction: write the expense row (with a client-minted UUIDv7 in add mode), set
`updatedAt` to the device clock, and append one outbox row carrying a fresh `clientMutationId`
(a UUIDv7). Then `router.back()` and show the snackbar. **The transaction must contain both
writes** — a row written without its outbox entry is a change that never syncs, and an outbox
entry without its row is a push of nothing.

---

## Accessibility

1. Focus order: 1 → 2 → 3 → 4 → 5 (when non-empty) → 6 → 7 → 8 → 9 → keypad keys in reading
   order. The keypad is last, so a screen-reader user reaches the fields and Save without
   traversing twelve keys first.
2. **The amount display is `accessibilityLiveRegion="polite"`** and announces the full formatted
   amount after each key press — `$1.25`, not `five`. A keypad that announces only the digit
   pressed leaves a non-sighted user unable to tell what the running value is, which is the one
   thing that matters here.
3. Keypad keys are each ≥56x56, comfortably past the 44 minimum, and are laid out in a standard
   phone-dial arrangement so muscle memory transfers.
4. **The keypad never covers content.** The scrollable region between the amount and the keypad
   has `paddingBottom` equal to the keypad's height, so Delete is always reachable by scrolling.
5. **Dynamic type.** The keypad's row height grows with `fontScale`; above `fontScale > 1.4` the
   amount display drops from `type.amountHero` to `type.display` to keep the keypad on screen.
   Key labels never truncate.
6. Save being disabled is conveyed by `accessibilityState={{ disabled: true }}` **and** by the
   helper text at element 5, which is part of the screen's reading order — so the reason is
   available without sight.
7. The `Discard changes?` dialog moves focus to its title and returns focus to element 1 on
   cancel.
8. **Reduce Motion**: the over-maximum shake (rule 5) is suppressed; the snackbar alone carries
   the message.
