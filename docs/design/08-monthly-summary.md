# 6. Monthly summary

Owner: Designer · Last updated: 2026-10-06

### Purpose

Answer "where did my money go this month?" with one total and one chart, on one screen, with no
interaction required.

### Route

`/(app)/(tabs)/summary` — the second tab.

---

## Layout

```
+----------------------------------------+
| Summary          [(!) 2 pending]       |   app bar, 56
+----------------------------------------+
| ( < )     October 2026       ( > )     |   05-month-switcher.md
+----------------------------------------+
|  Total this month                      |   type.caption, text.tertiary
|  $1,284.50                             |   type.display, tabular-nums
|  42 expenses                           |   type.footnote, text.tertiary
+----------------------------------------+
|                                        |
|            .-''''''-.                  |
|          .'          '.                |   donut, 180 diameter,
|         /   $1,284.50  \               |   28 stroke, centred
|        |     October     |             |
|         \              /               |
|          '.          .'                |
|            '-......-'                  |
|                                        |
+----------------------------------------+
|  (o) Housing        $520.00     40%    |   legend row, 48 min
|  (o) Groceries      $312.50     24%    |
|  (o) Eating out     $198.00     15%    |
|  (o) Transport      $142.00     11%    |
|  (o) Bills           $72.00      6%    |
|  (o) Health          $40.00      3%    |
+----------------------------------------+
| [ Expenses ]        [ Summary ]        |   tab bar
+----------------------------------------+
```

Chart: `victory-native` (`docs/PLAN.md` §Mobile). One chart, kept simple.

---

## Elements

| #   | Element        | Style                                                                                                        | Copy                                                   | Tap target                       | Accessibility                                                              |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------- | -------------------------------------------------------------------------- |
| 1   | App bar        | `bg.surface`, 56, `elevation.1` when scrolled                                                                | —                                                      | —                                | —                                                                          |
| 2   | Title          | `type.headline` / `text.primary`, leading                                                                    | `Summary`                                              | none                             | `role="header"`                                                            |
| 3   | Sync pill      | [`02-offline-and-sync.md`](./02-offline-and-sync.md) §3                                                      | per state                                              | 44x44 `hitSlop`                  | per that spec                                                              |
| 4   | Month switcher | [`05-month-switcher.md`](./05-month-switcher.md)                                                             | per that spec                                          | per that spec                    | per that spec                                                              |
| 5   | Total label    | `type.caption` / `text.tertiary`                                                                             | `Total this month` for the current month, else `Total` | none                             | grouped with 6                                                             |
| 6   | Total amount   | `type.display` / `text.primary`, `tabular-nums`                                                              | e.g. `$1,284.50`                                       | none                             | one element with 5 and 7                                                   |
| 7   | Count          | `type.footnote` / `text.tertiary`                                                                            | `42 expenses` / `1 expense`                            | none                             | part of the group                                                          |
| 8   | Donut chart    | 180 diameter, 28 stroke, centred, `space.6` vertical                                                         | —                                                      | **not interactive** — see rule 6 | `accessibilityElementsHidden`; the legend is the accessible representation |
| 9   | Slice          | the category's colour, separated by a 2px `bg.surface` stroke                                                | —                                                      | none                             | —                                                                          |
| 10  | Centre total   | `type.bodyStrong` / `text.primary`, `tabular-nums`, with the month in `type.caption` / `text.tertiary` below | amount + `MMMM`                                        | none                             | hidden with 8                                                              |
| 11  | Legend row     | 48 min, `space.4` gutter, 1px `border.hairline` separator                                                    | see 12-15                                              | full row                         | one composed element per row                                               |
| 12  | Legend swatch  | 16x16, `radius.sm`, the category's colour                                                                    | —                                                      | none                             | `accessibilityElementsHidden`                                              |
| 13  | Legend name    | `type.body` / `text.primary`, `numberOfLines={1}`, flexes                                                    | category name                                          | none                             | part of 11                                                                 |
| 14  | Legend amount  | `type.bodyStrong` / `text.primary`, `tabular-nums`, trailing                                                 | e.g. `$520.00`                                         | none                             | part of 11, read as money                                                  |
| 15  | Legend percent | `type.callout` / `text.tertiary`, `tabular-nums`, fixed 44 wide, trailing                                    | e.g. `40%`                                             | none                             | part of 11                                                                 |

---

## States

| State                                | What the user sees                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `default`                            | As drawn. Legend sorted by amount descending; ties broken by category name ascending so the order is stable between renders.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `empty` — no expenses this month     | No chart at all. Centred, `space.10` below the total: `pie-chart` 48 in `text.tertiary`; `space.6`; headline `Nothing to summarise` in `type.title2`; `space.2`; body `Add an expense this month and you will see where your money went.` in `type.callout` / `text.secondary`, centred, max 280 wide. **The total still renders as `$0.00` with `0 expenses`**, consistent with Home. A zero-value donut is **never** drawn — an empty ring reads as a loading state or a bug. There is no primary CTA here; the Expenses tab holds the add action, and duplicating the FAB on a summary screen would be a second, competing entry point. |
| `empty` — a category with zero spend | Excluded from both the chart and the legend. A 0% slice is invisible and a `$0.00 / 0%` legend row is noise. The category still exists in [`07-categories.md`](./07-categories.md), which is where "all my categories" is answered.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `loading:first-paint`                | Skeleton: a 160x32 `bg.sunken` block for the total, a 180x180 `bg.sunken` circle for the chart, four legend skeleton rows. No shimmer. Becomes `empty` after 300ms if the query returned nothing ([`02-offline-and-sync.md`](./02-offline-and-sync.md) §1).                                                                                                                                                                                                                                                                                                                                                                                |
| `loading:hydrating`                  | Same skeleton plus the centred `type.footnote` / `text.tertiary` line `Getting your expenses…`. Only reachable right after a fresh log in on a new install.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `error`                              | **No reachable error state.** Every number here comes from one local `GROUP BY` over SQLite; there is no server reporting endpoint in the MVP (`docs/PLAN.md` §Mobile), so there is nothing to fail. A sync transport failure appears in the sync pill and must not blank or grey the chart — stale-but-real numbers beat an error screen.                                                                                                                                                                                                                                                                                                 |
| `offline-pending`                    | Identical layout. **Pending expenses are included in the total, the chart and the legend**, exactly as synced ones are, because they are real expenses that exist locally. The chart shows no per-slice pending indicator — a slice is an aggregate, and marking it would imply something about the whole category. The sync pill carries the state. A `needs-attention` row is also included; it is still a real expense.                                                                                                                                                                                                                 |

---

## Behaviour

1. **One query feeds everything on this screen:**
   ```sql
   SELECT categoryId, SUM(amountMinor) AS total, COUNT(*) AS n
   FROM expenses
   WHERE date BETWEEN ? AND ? AND deletedAt IS NULL
   GROUP BY categoryId
   ORDER BY total DESC
   ```
   The month total is the sum of those group totals, and the expense count is the sum of the
   counts — so the total, the chart, the legend and the count can never disagree with each
   other. They are the same data, aggregated once.
2. **The month bounds are the inclusive `YYYY-MM-DD` string pair** from
   [`05-month-switcher.md`](./05-month-switcher.md) rule 11. No `Date` arithmetic.
3. **Percentages are computed in minor units and rounded for display only.**
   `round(categoryTotal * 100 / monthTotal)`. Consequences that must be handled rather than
   hidden:
   - **Displayed percentages may not sum to exactly 100%.** This is expected from independent
     rounding and the screen does not try to correct it by adjusting the largest slice, which
     would make a legend row disagree with its own arithmetic. No "100%" total is displayed
     anywhere, so no visible contradiction arises.
   - **A non-zero amount never displays as `0%`.** Any category with a non-zero total that
     rounds below 1% displays `<1%` instead.
   - **Slice angles use the exact ratio, not the rounded percentage**, so the geometry stays
     true even where the label is rounded.
4. **Slices are drawn in legend order** (amount descending), starting at 12 o'clock and going
   clockwise, so the largest slice is immediately readable and the chart order matches the list
   order beneath it.
5. **Every slice is separated by a 2px `bg.surface` stroke.** This is required, not cosmetic:
   the category palette is separated by hue at near-identical luminance
   (`00-foundations.md` §1.3), so two adjacent slices can be indistinguishable in greyscale or
   to a user with deuteranopia. The stroke is what keeps the boundary visible.
6. **The chart is not interactive.** No tap-to-select, no tooltip, no legend filtering, no
   animation on mount beyond a `motion.base` fade. Rationale: the legend already shows every
   value the chart encodes, in text, permanently — a tooltip would reveal nothing new while
   adding a hit-testing surface that is unreachable by assistive technology and fiddly on a
   180px donut. The chart is a picture of the legend.
7. **Small categories are not grouped into "Other".** Every category with spend gets its own
   slice and its own legend row. With a realistic maximum of a dozen or so user categories, an
   "Other" bucket would hide data to solve a crowding problem this screen does not have. If the
   legend is long, it scrolls.
8. **Tapping a legend row** navigates to the Expenses tab filtered to that category for the
   selected month, with a dismissible filter chip reading `{name}` and a trailing `x` in the
   month-switcher row. This is the one piece of drill-down, and it is on the legend — which is
   text, and therefore accessible — rather than on the chart.
9. **The month is shared with Home** ([`05-month-switcher.md`](./05-month-switcher.md) rule 7).
   Switching month here and returning to Expenses shows the same month.
10. **Recomputation is synchronous with local writes.** Adding an expense on the other tab and
    switching here shows it immediately; the query is re-run on SQLite change notification, not
    on a timer and not on focus alone.
11. **The donut is drawn only when `monthTotal > 0`.** This is the guard that prevents a
    division by zero in the percentage calculation, and it is the same condition as the `empty`
    state.
12. **Pull-to-refresh triggers a sync**, as on Home ([`04-expense-list.md`](./04-expense-list.md)
    §Behaviour rule 12). The figures do not change as a result unless the sync brings in rows
    from another device.

---

## Accessibility

1. **The chart is hidden from assistive technology** (`accessibilityElementsHidden`,
   `importantForAccessibility="no-hide-descendants"`) and the legend is its accessible
   equivalent. An SVG donut cannot be read usefully; a list of labelled amounts can. This is
   why the legend is mandatory and always visible rather than collapsible.
2. **Each legend row is one element** with the composed label
   `{name}, {formatted amount}, {percent} percent of the month` — for example
   `Housing, $520.00, 40 percent of the month`. The `<1%` case reads `less than 1 percent of the
month`. Hint: `Double tap to see these expenses.`
3. **The total block (5, 6, 7) is one element**: `Total this month, $1,284.50, 42 expenses`, and
   is `accessibilityLiveRegion="polite"` so a month change announces the new figure.
4. **Colour is never the only carrier of category identity here** — every slice has a legend row
   naming it in text, and every legend swatch sits beside its name
   (`00-foundations.md` §1.3). The chart is readable in full greyscale because nothing depends on
   telling two slices apart by colour alone.
5. **Reduce Motion**: the mount fade is suppressed and the chart renders at full opacity
   immediately. No slice-growth or rotation animation exists in any case.
6. **Dynamic type.** Above `fontScale > 1.3` the legend row stacks — name on the first line,
   amount and percent on the second, leading-aligned. The donut does **not** scale with font
   size (it carries no body text); its centre label drops to `type.callout` and, above
   `fontScale > 1.5`, is omitted entirely, since the same figure is already shown at
   `type.display` directly above the chart.
7. Focus order: 2 → 3 (when present) → 4 → 5/6/7 → legend rows in visual order. The chart is
   skipped entirely, which is intended.
8. The filter chip from rule 8 is `role="button"` with the label
   `Filtered by {name}. Double tap to clear.`


## Trend card (added after the MVP)

Below the legend (and below the empty state), a card titled `Last 6 months`: one bar per calendar
month for the six months ending at the selected one, oldest first. The selected month is the solid
`primary` bar, the others the muted `border.strong` tint; a month with no spend keeps a 2px stub so
six slots always show. Month labels are the short names (`Oct`).

- Computed from local SQLite like everything else here (`monthlyTotals`), soft-deleted rows excluded,
  pending expenses included. No network, no error state.
- Shown only when at least two of the six months hold spend - one bar compares to nothing.
- Unlike the donut it is accessible: each bar is one element labelled `{Month Year}, {amount}`.
- Stepping the month switcher moves the window, so the card always ends at the month on screen.
