# 3. Month switcher

Owner: Designer · Last updated: 2026-10-06

### Purpose

Move between months, and make the month currently in view unmistakable. Used identically by
**Home** ([`04-expense-list.md`](./04-expense-list.md)) and **Summary**
([`08-monthly-summary.md`](./08-monthly-summary.md)).

### Route

Not a screen. A component pinned directly below the app bar on both tab screens, plus one
`Sheet` (`/(app)/month-picker`, presented modally) for jumping further than a step at a time.

---

## Layout

### The bar

```
+----------------------------------------+
|  ( < )      October 2026       ( > )   |   48 tall, bg.surface
+----------------------------------------+   1px border.hairline bottom
```

- Full-bleed `bg.surface`, 48 tall, 1px `border.hairline` bottom border.
- Arrows at each end, `space.2` from the screen gutter. Label centred and flexed.
- The whole centre label is itself a button that opens the month picker sheet.

### The picker sheet

```
+--------------------------------+
|  ====                          |
|  Jump to month             [x] |
|                                |
|  ( < )       2026       ( > )  |   year stepper, 44 tall
|                                |
|  +------+ +------+ +------+    |
|  | Jan  | | Feb  | | Mar  |    |   3-column grid, 48 tall cells
|  +------+ +------+ +------+    |   space.2 gap
|  | Apr  | | May  | | Jun  |    |
|  +------+ +------+ +------+    |
|  | Jul  | | Aug  | | Sep  |    |
|  +------+ +------+ +------+    |
|  |[Oct ]| | Nov  | | Dec  |    |   Oct = selected
|  +------+ +------+ +------+    |
|                                |
|  [ This month ]                |   ghost, full width
+--------------------------------+
```

---

## Elements

### Bar

| # | Element | Style | Copy | Tap target | Accessibility |
|---|---------|-------|------|------------|---------------|
| 1 | Previous month | `chevron-left` 20, `text.primary` | — | 44x44 | `role="button"`, label `Previous month, {MonthName} {Year}` |
| 2 | Month label | `type.headline` / `text.primary`, centred | `MMMM yyyy`, e.g. `October 2026` | ≥44 tall, flexes to fill between the arrows | `role="button"`, label `{MonthName} {Year}`, hint `Double tap to jump to another month.` |
| 3 | Next month | `chevron-right` 20, `text.primary` | — | 44x44 | `role="button"`, label `Next month, {MonthName} {Year}` |

### Sheet

| # | Element | Style | Copy | Tap target | Accessibility |
|---|---------|-------|------|------------|---------------|
| 4 | Sheet title | `type.title2` / `text.primary` | `Jump to month` | none | `role="header"` |
| 5 | Close | `x` 24, `text.secondary` | — | 44x44 | `role="button"`, label `Close` |
| 6 | Previous year | `chevron-left` 20 | — | 44x44 | `role="button"`, label `Previous year, {Year - 1}` |
| 7 | Year label | `type.headline` / `text.primary`, centred, `tabular-nums` | `yyyy` | none | `role="header"`, label `{Year}` |
| 8 | Next year | `chevron-right` 20 | — | 44x44 | `role="button"`, label `Next year, {Year + 1}` |
| 9 | Month cell | 48 tall, `radius.md`, `type.subhead`; see cell states below | `MMM`, e.g. `Oct` | full cell, ≥48 | `role="button"`, label `{MonthName} {Year}`, `accessibilityState={{ selected }}` |
| 10 | This month | `Button` `ghost`, full width | `This month` | full button, 44 | `role="button"`, label `Go to this month, {MonthName} {Year}` |

### Month cell states

| Cell state | Fill | Label | Border | Also marked by |
|------------|------|-------|--------|----------------|
| Default | `bg.surface` | `text.primary` | 1px `border.hairline` | — |
| Has expenses | `bg.surface` | `text.primary` | 1px `border.hairline` | a 4x4 `radius.pill` `primary.default` dot, `space.1` below the label |
| Selected | `primary.default` | `text.inverse`, weight 600 | none | `accessibilityState={{ selected: true }}` |
| Current month (not selected) | `primary.subtle` | `primary.default`, weight 600 | 1px `primary.default` | — |
| Future (beyond current month) | `bg.sunken` | `text.disabled` | none | `accessibilityState={{ disabled: true }}` |

The "has expenses" dot is **not** the only differentiator from an empty month — see Behaviour
rule 8 for why it is additive rather than load-bearing.

---

## States

| State | What the user sees |
|-------|--------------------|
| `default` | Current month selected on first launch. Both arrows enabled unless rule 2 disables Next. |
| `empty` | The switcher itself has no data, so no empty state. Selecting a month with no expenses is handled by the host screen's `empty` state, not here — the switcher keeps working and keeps showing the month. |
| `loading` | **None.** The month label is derived from local state, and month boundaries are computed, not fetched. The switcher renders on the first frame and never shows a placeholder. The "has expenses" dots in the sheet come from one local `GROUP BY` query; until it returns, cells render in their Default state and dots fade in under `motion.fast`. A missing dot never blocks selection. |
| `error` | **No reachable error state.** Nothing here performs I/O. |
| `offline-pending` | Identical to `default`. The switcher has no sync-dependent behaviour — month boundaries and dot counts are local. The sync pill above it carries connectivity; the switcher never duplicates it. |

---

## Behaviour

1. **The arrows step one calendar month.** Stepping back from January 2026 goes to December
   2025; the year follows automatically.
2. **Next is disabled at the current month.** The user cannot navigate into the future, because
   an expense cannot be dated in the future either
   ([`06-expense-form.md`](./06-expense-form.md) §Behaviour rule 9) — so every future month is
   guaranteed empty, and allowing navigation into an endless run of empty months is a dead end.
   Per `00-foundations.md` §6, a disabled control needs a stated reason, and in a 48-tall bar
   there is no room for helper text. The reason is therefore delivered on interaction: the
   disabled Next arrow keeps `accessibilityState={{ disabled: true }}`, and tapping it shows the
   snackbar `This is the current month.` rather than doing nothing silently.
3. **There is no lower bound.** The user may step back indefinitely, including to months before
   they signed up. Those months are simply empty. A floor computed from the earliest expense
   would move as data arrives and would make the control feel inconsistent.
4. **The centre label opens the picker sheet.** This is the only path to a non-adjacent month.
5. **Selecting a month cell applies it and dismisses the sheet immediately.** No confirm button
   — the selection *is* the confirmation, and a one-tap action should not cost two.
6. **Future cells are not selectable**, matching rule 2. They are visibly disabled rather than
   hidden, so the grid keeps a stable 3x4 shape in every year.
7. **The month is shared app state, not per-screen state.** It lives above both tabs (a context
   provider or a store slice). Changing month on Home and then switching to Summary shows the
   same month. This is the single most important rule here: two tabs showing different months
   while both say "this month" would make the total look wrong.
8. **The month is session state and resets to the current month on cold start.** It is not
   persisted. A user who reopens the app after reading about August 2025 expects to land on
   today, not on where they were last week. Within a session — including across backgrounding —
   the selection holds.
9. **The "has expenses" dot is additive.** The grid is fully usable before the count query
   resolves, and an empty month is still selectable. The dot is a convenience for finding where
   data is, never a gate. The query is
   `SELECT strftime('%Y-%m', date) AS ym, COUNT(*) FROM expenses WHERE deletedAt IS NULL GROUP BY ym`,
   run once per sheet presentation.
10. **`This month`** jumps to the current month and dismisses the sheet. It is hidden — not
    disabled — when the current month is already selected, since a no-op button is worse than
    no button.
11. **Month boundaries** are computed in the device's local calendar and compared against the
    zone-less `date` string: a month is `[YYYY-MM-01, YYYY-MM-LL]` inclusive, both as
    `YYYY-MM-DD` strings. **Comparison is string-based**, never via `Date` arithmetic, so no
    expense can shift month across a timezone (`docs/PLAN.md` §Data model).
12. **Month names are from `Intl.DateTimeFormat`** with the device locale, so the label
    localises for free even though copy is English-only in the MVP. `MMMM yyyy` on the bar,
    `MMM` in the grid.

---

## Accessibility

1. Focus order on the bar: 1 → 2 → 3. In the sheet: 4 → 5 → 6 → 7 → 8 → cells in reading order
   → 10.
2. **Arrow labels name their destination**, not their direction: `Previous month, September
   2026` tells a screen-reader user where they are going. `Previous` alone does not.
3. **A month change is announced** via `announceForAccessibility` with the host screen's new
   headline figure — `October 2026, total $1,284.50` — so the consequence of the tap is audible
   without hunting for the total. This is why the switcher needs to know its host screen's
   summary line; it is passed in as a prop.
4. Month cells use `accessibilityState={{ selected }}` so the selected month is conveyed as
   state and not only by its fill colour.
5. The sheet traps focus and restores it to element 2 on dismiss.
6. **Dynamic type.** The bar grows taller than 48 rather than truncating `October 2026`. At very
   large scales the label wraps to two lines and the bar grows with it; the arrows stay
   vertically centred. The grid drops from three columns to two above `fontScale > 1.5`.
7. **Reduce Motion.** The month transition on the host screen is a cross-fade with no horizontal
   slide (`00-foundations.md` §4). Nothing about the switcher implies a swipe gesture, because
   horizontal swipe between months is **not** implemented — it conflicts with swipe-to-delete on
   the rows underneath.
