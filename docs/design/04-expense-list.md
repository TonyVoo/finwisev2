# 2. Expense list (Home)

Owner: Designer · Last updated: 2026-10-06

### Purpose

Show this month's expenses grouped by day, with the month's total always visible, and get the
user into Add in one tap.

### Route

`/(app)/(tabs)/index` — the first tab and the app's landing screen.

---

## Layout

```
+----------------------------------------+
| Expenses        [(!) 2 pending]  (gear)|  app bar, 56
+----------------------------------------+
| ( < )     October 2026       ( > )     |  month switcher, 05-month-switcher.md
+----------------------------------------+
|  Total this month                      |  type.caption, text.tertiary
|  $1,284.50                             |  type.display, tabular-nums
+----------------------------------------+   <- header ends, list scrolls below
|  Today                                 |  section header, type.caption
| +------------------------------------+ |
| | (o) Groceries            $12.50    | |  Row, 56 min
| |     Milk, eggs                     | |
| +------------------------------------+ |
| | (o) Transport       (c) $3.20      | |  (c) = pending clock glyph
| +------------------------------------+ |
|  Yesterday                             |
| +------------------------------------+ |
| | (o) Eating out           $24.00    | |
| |     Dinner with Sam                | |
| +------------------------------------+ |
|  Mon 4 Oct                             |
| +------------------------------------+ |
| | (o) Bills               $89.00     | |
| +------------------------------------+ |
|                                        |
|                              ( + )     |  FAB, 56, above tab bar
+----------------------------------------+
| [ Expenses ]        [ Summary ]        |  tab bar
+----------------------------------------+
```

`(o)` is the 24x24 category swatch: a `radius.sm` filled square in the category's colour.

---

## Elements

| #   | Element             | Style                                                                                     | Copy                                                                  | Tap target      | Accessibility                                                  |
| --- | ------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------- | -------------------------------------------------------------- |
| 1   | App bar             | `bg.surface`, 56 tall, `elevation.1` once the list is scrolled past 0                     | —                                                                     | —               | —                                                              |
| 2   | Screen title        | `type.headline` / `text.primary`, leading, `space.4` from edge                            | `Expenses`                                                            | none            | `role="header"`                                                |
| 3   | Sync pill           | [`02-offline-and-sync.md`](./02-offline-and-sync.md) §3                                   | per state                                                             | 44x44 `hitSlop` | per that spec                                                  |
| 4   | ~~Settings button~~ (removed: a tab, rule 14) | `settings` 24, `text.secondary`, trailing                                                 | —                                                                     | 44x44           | `role="button"`, label `Settings`                              |
| 5   | Month switcher      | [`05-month-switcher.md`](./05-month-switcher.md)                                          | per that spec                                                         | per that spec   | per that spec                                                  |
| 6   | Total label         | `type.caption` / `text.tertiary`                                                          | `Total this month` for the current month; `Total` for any other month | none            | grouped with 7                                                 |
| 7   | Total amount        | `type.display` / `text.primary`, `tabular-nums`                                           | formatted money, e.g. `$1,284.50`                                     | none            | one element with 6: `Total this month, 1,284 dollars 50 cents` |
| 8   | Section header      | `type.caption` / `text.tertiary`, `bg.canvas`, `space.2` vertical, `space.4` leading      | `Today` / `Yesterday` / `EEE d MMM`                                   | none            | `role="header"`                                                |
| 9   | Expense row         | `Row`, 56 min                                                                             | see 10-14                                                             | full row        | one composed element — see §Accessibility                      |
| 10  | Category swatch     | 24x24, `radius.sm`, category colour                                                       | —                                                                     | none            | `accessibilityElementsHidden` (the name carries it)            |
| 11  | Category name       | `type.body` / `text.primary`, `numberOfLines={1}`                                         | category name                                                         | none            | part of 9                                                      |
| 12  | Note                | `type.callout` / `text.secondary`, `numberOfLines={1}`                                    | the note                                                              | none            | part of 9; row omits this line when the note is null or empty  |
| 13  | Pending glyph       | `clock` 14, `warning.default`, `space.1` before 14                                        | —                                                                     | none            | contributes `, not synced yet` to 9's label                    |
| 14  | Amount              | `type.bodyStrong` / `text.primary`, `tabular-nums`, trailing                              | formatted money                                                       | none            | part of 9, read as money                                       |
| 15  | FAB                 | 56x56, `radius.pill`, `primary.default`, `elevation.2`, `plus` 24 in `text.inverse`       | —                                                                     | 56x56           | `role="button"`, label `Add expense`                           |
| 16  | Swipe delete action | revealed behind the row, `danger.default` fill, `trash-2` 20 + `Delete` in `text.inverse` | `Delete`                                                              | ≥64 wide        | not exposed to screen readers — see §Accessibility             |

FAB position: trailing, `space.4` from the edge, `space.4` above the tab bar. The list gets
`contentContainerStyle.paddingBottom` of 56 + `space.4` + `space.4` so the last row can always
be scrolled clear of the FAB.

---

## States

| State                         | What the user sees                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default`                     | As drawn. Rows grouped by `date` descending, newest day first; within a day, `createdAt` descending so a just-added expense appears at the top of its group.                                                                                                                                                                                                                                                                                                                                                                                          |
| `empty` — **first run**       | No expenses _at all_ in the database. Centred in the list area, `space.10` from the header: `pie-chart` 48 in `text.tertiary`; `space.6`; headline `No expenses yet` in `type.title2`; `space.2`; body `Add your first expense and it will show up here, with your monthly total.` in `type.callout` / `text.secondary`, centred, max 280 wide; `space.6`; `Button` `primary` `Add your first expense`. **The month total still renders, showing the formatted zero (`$0.00`)** — hiding it would make the number appear to pop into existence later. |
| `empty` — **this month only** | Expenses exist in other months but none in the selected month. Different copy, no illustration, no primary button: headline `Nothing in {Month}` in `type.title2`, body `You have no expenses recorded for this month.` in `type.callout` / `text.secondary`, and a `ghost` button `Go to {CurrentMonth}` which is omitted when the selected month _is_ the current month. Rationale: a user who has used the app does not need to be taught what the app is for, and the useful action is navigation, not creation.                                  |
| `loading:first-paint`         | Skeleton: the total area shows a 160x32 `bg.sunken` `radius.sm` block; three skeleton rows, each a 24x24 swatch block + a 120x16 block + a trailing 64x16 block, `bg.sunken`. No shimmer animation (it would violate Reduce Motion for no gain). **Replaced by `empty` after 300ms** if the query returned no rows, per [`02-offline-and-sync.md`](./02-offline-and-sync.md) §1.                                                                                                                                                                      |
| `loading:hydrating`           | Only reachable in the frames after a fresh log in on a new install. Same skeleton as above, plus a `type.footnote` / `text.tertiary` line centred under the skeleton rows: `Getting your expenses…` This is the one read in the app that genuinely waits on the network.                                                                                                                                                                                                                                                                              |
| `error`                       | **No reachable error state for the list itself.** It reads local SQLite, which cannot fail on the network. Two sub-cases that are _not_ list errors: (a) a row with `needs-attention`, which is rendered on that row per [`02-offline-and-sync.md`](./02-offline-and-sync.md) §5.1 while every other row stays normal; (b) a sync transport failure, which is rendered in the sync pill and never as a list error. A genuine SQLite failure (corrupt database) is an unrecoverable crash, not a screen state, and is out of scope.                    |
| `offline-pending`             | Identical layout. Rows with undrained outbox entries show glyph 13; the sync pill shows state 4 or 5. **Nothing is disabled, nothing is greyed, no banner covers the list.** The month total includes pending rows. A deleted-but-unsynced expense is absent from the list, exactly as a synced delete would be.                                                                                                                                                                                                                                      |

---

## Behaviour

1. **Grouping.** Group on the expense's calendar `date`, never on `createdAt`. A row dated last
   Tuesday that was typed today belongs under last Tuesday. `date` is zone-less
   (`shared/src/primitives.ts`), so grouping must use the raw `YYYY-MM-DD` string and must not
   pass it through a `Date` that could shift it a day.
2. **Section header copy.** `Today` and `Yesterday` are computed against the device's local
   calendar day. Every other day is `EEE d MMM` (`Mon 4 Oct`). A date in a different calendar
   year gets `EEE d MMM yyyy`. Headers are sentence case, not uppercase.
3. **The month total is computed in SQLite** with
   `SELECT SUM(amountMinor) WHERE date BETWEEN ? AND ? AND deletedAt IS NULL`, summed in minor
   units as an integer and formatted once for display. It is never computed by reducing over the
   rendered page — that would be wrong the moment the list is paginated.
4. **The total updates optimistically.** It recalculates in the same render pass as the row
   change, so adding, editing or deleting never leaves the total briefly stale.
5. **Formatting.** `Intl.NumberFormat` with the user's `currency` and the device locale, with
   `minimumFractionDigits` equal to the currency's decimals. The zero total renders as `$0.00`,
   not as `—` or a blank.
6. **Tapping a row** pushes `/(app)/expense/[id]` in edit mode. The whole row is the target; the
   swatch, name, note and amount are not separately tappable.
7. **Swipe to delete.** A leading-to-trailing swipe on a row reveals action 16. Releasing past
   50% of the row width, or tapping the revealed action, commits. **There is no confirmation
   dialog** — the Undo snackbar is the confirmation ([`01-flows.md`](./01-flows.md) §4). A
   partial swipe springs back under `motion.fast`.
8. **Delete is a soft delete**: set `deletedAt = now`, append one outbox row, both in one
   transaction. The row animates out over `motion.base` (a cross-fade under Reduce Motion) and
   the total recalculates immediately.
9. **The Undo snackbar.** Copy `Expense deleted.` with an `Undo` action. Visible 5s, or 10s when
   a screen reader is active (`00-foundations.md` §6). `Undo` sets `deletedAt = null`, appends a
   second outbox row, and the row returns to its position. Rules:
   - Undo stays available **even if the delete has already synced** — undeleting is a normal
     update in this protocol (`CategorySyncFields`/`ExpenseSyncFields` accept
     `deletedAt: null`), so there is no race to lose.
   - **If the app is killed while the snackbar is up, the delete stands.** It was committed to
     SQLite the moment it happened; the snackbar is an undo affordance, not a pending
     transaction. Nothing is held in memory waiting to be flushed.
   - Deleting a second expense while a snackbar is showing replaces it, and the first delete
     stands. Undo only ever applies to the most recent delete, which is what the visible
     snackbar refers to.
10. **The FAB** pushes `/(app)/expense/new`. It is always enabled — there is no state in this
    app where adding an expense is unavailable.
11. **Pagination.** `FlatList` over a windowed SQLite query, page size 50
    (`LIMITS.EXPENSE_LIST_DEFAULT_LIMIT`), `onEndReachedThreshold={0.5}`. In practice a month
    rarely exceeds one page. **No footer spinner**: the next local page resolves within a frame,
    so a spinner would flash rather than inform.
12. **Pull-to-refresh triggers a sync**, not a reload — the list is already current. The
    `RefreshControl` spinner is tied to the sync attempt, and is the one place the user can ask
    for a sync by hand on a normal screen. When offline it stops immediately and the sync pill
    carries the explanation; it does **not** show an error.
13. **Month changes** are owned by [`05-month-switcher.md`](./05-month-switcher.md). The list
    re-queries on change; the scroll position resets to top.
14. **Settings** is the third tab of the tab bar (`/(app)/(tabs)/settings`); element 4, the app-bar
    button that used to push it, was removed once Settings outgrew three rows. Its sub-screens are
    pushed on top of the tabs. Originally it held exactly three rows — the
    account email as read-only text, the currency as read-only text with the helper
    `Set when you created your account.`, and `Categories` — plus a `destructive` `Log out`
    button. Log out revokes the refresh token via `POST /v1/auth/logout` on a best-effort basis,
    clears secure store, **wipes the local database**, and replaces the stack with
    `/(auth)/welcome`. It is gated by a `Dialog`: title `Log out?`, body
    `Changes that have not synced yet will be lost.` shown **only when the outbox is non-empty**,
    otherwise body `You can log back in at any time.`, actions `Log out` (destructive) and
    `Cancel`.

---

## Accessibility

1. **An expense row is one accessibility element.** Set `accessible={true}` on the row and
   suppress its children, so a screen-reader user swipes once per expense rather than four
   times. The composed label, in order, omitting absent parts:

   > `{category}, {formatted amount}, {note}, {date}` + `, not synced yet` when pending +
   > `, could not sync` when it needs attention.

   Example: `Groceries, $12.50, Milk and eggs, Today, not synced yet`.

   The date is included because section headers are easy to miss when swiping element to
   element, and a row read without its date is ambiguous.

2. **`accessibilityHint`** on a row: `Double tap to edit this expense.`
3. **The swipe-to-delete gesture is not screen-reader accessible**, and must not be the only
   path to delete. Delete is therefore also available as a `destructive` button inside Edit
   expense ([`06-expense-form.md`](./06-expense-form.md)), which is the path assistive
   technology uses. Additionally the row exposes an `accessibilityAction` named `delete` with
   the label `Delete expense`, so VoiceOver's Actions rotor and TalkBack's local context menu
   can reach it directly.
4. **Dynamic type.** Above `fontScale > 1.3` the row switches from `[swatch | name / note |
amount]` to a stacked layout: swatch and name on the first line, note on the second, amount
   on its own third line, leading-aligned, still one accessibility element. The amount must
   never truncate or ellipsise — a clipped amount is worse than a taller row.
5. **The month total is one element**, labelled as money (`00-foundations.md` §8 rule 3), and is
   `accessibilityLiveRegion="polite"` so a change following an add or delete is announced
   without stealing focus.
6. **Focus order**: 2 → 3 (when present) → 4 → 5 → 6/7 → first section header → rows in visual
   order → 15. The FAB is last, after the list, so a screen-reader user is not forced past it to
   reach their expenses.
7. **The empty state's illustration** is `accessibilityElementsHidden`; the headline carries
   `role="header"` and is the first element announced after the total.
8. **Delete and Undo are both announced**: `Expense deleted.` on commit and
   `Expense restored.` on undo, via `announceForAccessibility`.
