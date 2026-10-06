# Visual Foundations

Owner: Designer · Last updated: 2026-10-06 · Machine-readable export: [`tokens.json`](./tokens.json)

Light theme only for the MVP (see [`README.md`](./README.md) §Scope notes). Every contrast
ratio in this doc was computed, not estimated; the numbers are reproducible from the hex values.

---

## 1. Colour

### 1.1 Semantic palette

Reference these by name. Do not use a raw hex value in a component.

| Token             | Hex                   | Use                                                                       |
| ----------------- | --------------------- | ------------------------------------------------------------------------- |
| `bg.canvas`       | `#F7F8FA`             | Screen background behind cards                                            |
| `bg.surface`      | `#FFFFFF`             | Cards, rows, sheets, the app bar                                          |
| `bg.sunken`       | `#EFF1F4`             | Inset wells: keypad backdrop, skeletons, disabled fills                   |
| `bg.scrim`        | `rgba(17,24,39,0.45)` | Behind modals and sheets                                                  |
| `text.primary`    | `#111827`             | Body copy, amounts, titles                                                |
| `text.secondary`  | `#4B5563`             | Supporting copy, row subtitles                                            |
| `text.tertiary`   | `#6B7280`             | Metadata, section headers, placeholders                                   |
| `text.inverse`    | `#FFFFFF`             | Text on `primary` / `danger` fills                                        |
| `text.disabled`   | `#8C939E`             | Disabled control labels                                                   |
| `primary.default` | `#0D7A64`             | Primary actions, selected state, focus ring                               |
| `primary.pressed` | `#0A5F4E`             | Pressed state of a primary fill                                           |
| `primary.subtle`  | `#E6F4F1`             | Selected-row tint, primary-tinted chips                                   |
| `danger.default`  | `#B3261E`             | Destructive actions, error text and icons                                 |
| `danger.subtle`   | `#FDECEA`             | Error banner / inline error background                                    |
| `warning.default` | `#8A5300`             | Pending-sync and "waiting" messaging                                      |
| `warning.subtle`  | `#FFF4E0`             | Background of the same                                                    |
| `success.default` | `#1B6B3A`             | "Synced", confirmation                                                    |
| `success.subtle`  | `#E7F5EC`             | Background of the same                                                    |
| `info.default`    | `#1A4FA0`             | Neutral informational notices                                             |
| `info.subtle`     | `#E8F0FD`             | Background of the same                                                    |
| `border.hairline` | `#E2E5EA`             | 1px row separators, card edges (decorative)                               |
| `border.strong`   | `#C8CDD6`             | Dividers that need to read as structural                                  |
| `border.input`    | `#8C939E`             | **The resting border of a text input or stepper.** 3.10:1 on `bg.surface` |
| `border.focus`    | `#0D7A64`             | 2px focus ring, inset 0                                                   |

### 1.2 Verified contrast

Measured with the WCAG 2.1 relative-luminance formula. Body text needs ≥4.5:1; large text
(≥24px, or ≥19px bold) and UI component boundaries need ≥3:1.

| Pair                                  | Ratio | Bar | Pass |
| ------------------------------------- | ----- | --- | ---- |
| `text.primary` on `bg.surface`        | 17.74 | 4.5 | yes  |
| `text.primary` on `bg.canvas`         | 16.69 | 4.5 | yes  |
| `text.secondary` on `bg.surface`      | 7.56  | 4.5 | yes  |
| `text.secondary` on `bg.canvas`       | 7.11  | 4.5 | yes  |
| `text.tertiary` on `bg.surface`       | 4.83  | 4.5 | yes  |
| `text.tertiary` on `bg.canvas`        | 4.55  | 4.5 | yes  |
| `text.inverse` on `primary.default`   | 5.27  | 4.5 | yes  |
| `text.inverse` on `primary.pressed`   | 7.61  | 4.5 | yes  |
| `primary.default` on `bg.surface`     | 5.27  | 4.5 | yes  |
| `primary.default` on `primary.subtle` | 4.66  | 4.5 | yes  |
| `danger.default` on `bg.surface`      | 6.54  | 4.5 | yes  |
| `text.inverse` on `danger.default`    | 6.54  | 4.5 | yes  |
| `danger.default` on `danger.subtle`   | 5.72  | 4.5 | yes  |
| `warning.default` on `warning.subtle` | 5.81  | 4.5 | yes  |
| `success.default` on `success.subtle` | 5.81  | 4.5 | yes  |
| `info.default` on `info.subtle`       | 6.86  | 4.5 | yes  |
| `border.input` on `bg.surface`        | 3.10  | 3.0 | yes  |
| `border.focus` on `bg.surface`        | 5.27  | 3.0 | yes  |

`border.hairline` (1.26:1) and `border.strong` (1.60:1) are **decorative only**. They may
separate rows; they may never be the only thing that identifies an interactive control. An
input or stepper outline uses `border.input`.

`text.disabled` on `bg.sunken` is 2.74:1 and deliberately below the bar — WCAG exempts
disabled controls. Because of that, disabled state is never signalled by colour alone: every
disabled control also sets `accessibilityState={{ disabled: true }}`, and any disabled primary
button renders its blocking reason as adjacent helper text (see §6).

### 1.3 Default category colour set

Ten colours. A new category is assigned the first colour not already in use by one of the
user's live categories, wrapping to the start if all ten are taken (duplicates are allowed —
the name disambiguates).

| #   | Token             | Hex       | On white | Seeded for                   |
| --- | ----------------- | --------- | -------- | ---------------------------- |
| 1   | `category.green`  | `#2F8044` | 4.89     | Groceries                    |
| 2   | `category.orange` | `#A85C12` | 4.99     | Eating out                   |
| 3   | `category.blue`   | `#2F6FD0` | 4.88     | Transport                    |
| 4   | `category.purple` | `#8E4EC6` | 5.18     | Bills                        |
| 5   | `category.red`    | `#C73B3B` | 5.10     | Health                       |
| 6   | `category.slate`  | `#6B7280` | 4.83     | **Uncategorized** (reserved) |
| 7   | `category.indigo` | `#5B57C7` | 5.78     | _(picker only)_              |
| 8   | `category.teal`   | `#277573` | 5.41     | _(picker only)_              |
| 9   | `category.pink`   | `#BC4186` | 4.95     | _(picker only)_              |
| 10  | `category.ochre`  | `#8A7012` | 4.77     | _(picker only)_              |

All ten clear 4.5:1 on `bg.surface`, so a category colour is safe as a swatch, an icon tint, a
chart slice, or text.

**`category.slate` is reserved.** It is the Uncategorized colour and is not offered in the
colour picker for user-created categories.

> **These hex values differ from `DEFAULT_CATEGORIES` in `shared/src/category.ts`,
> deliberately.** The six colours currently in the contract are Tailwind 500-weights and none
> of them reaches 4.5:1 on white — measured: `#9ca3af` 2.54, `#22c55e` 2.28, `#f97316` 2.80,
> `#3b82f6` 3.68, `#ef4444` 3.76, `#a855f7` 3.96. A category colour is used here as a chart
> legend label and as a swatch beside small text, so it needs to clear 4.5:1. The tokens above
> are same-hue replacements that do. `CategoryColor` is any `#RRGGBB`, so this is a change of
> six constants, not a change of wire shape. Raised with Chief — see
> [`README.md`](./README.md) §Open contract items item 1.

#### The rule that follows from these numbers

The ten colours are separated by **hue**, not by lightness — they sit in a narrow luminance
band so all of them pass contrast on the same white surface. The pairwise luminance contrast
between the closest two (`category.green` and `category.blue`) is **1.00:1**. They are
identical in brightness.

That is a deliberate trade, and it has a consequence the implementation must honour:

> **Colour is never the only carrier of category identity.** Every swatch sits beside the
> category name. Every chart slice has a legend row with the name and the amount. Chart slices
> are separated by a 2px `bg.surface` stroke, because adjacent slices cannot be told apart by
> luminance and will not be distinguishable in greyscale or to a user with deuteranopia.

Enforced in [`08-monthly-summary.md`](./08-monthly-summary.md) §Behaviour rules 3-5.

---

## 2. Type scale

System font: San Francisco on iOS, Roboto on Android. In React Native that is the platform
default — **do not bundle a custom font for the MVP.**

| Token             | Size / Line | Weight | Tracking | Use                                                    |
| ----------------- | ----------- | ------ | -------- | ------------------------------------------------------ |
| `type.amountHero` | 34 / 40     | 700    | -0.6     | The keypad's live amount display                       |
| `type.display`    | 32 / 40     | 700    | -0.5     | Month total on Home and Summary                        |
| `type.title1`     | 24 / 32     | 700    | -0.3     | Screen titles on large-title screens                   |
| `type.title2`     | 20 / 28     | 600    | -0.2     | Sheet titles, dialog titles, empty-state headlines     |
| `type.headline`   | 17 / 24     | 600    | 0        | App-bar title, row primary text when emphasised        |
| `type.body`       | 16 / 24     | 400    | 0        | Body copy, input text, row primary text                |
| `type.bodyStrong` | 16 / 24     | 600    | 0        | Row amounts, button labels                             |
| `type.callout`    | 15 / 20     | 400    | 0        | Secondary row text, dialog body                        |
| `type.subhead`    | 14 / 20     | 500    | 0        | Field labels, tab labels                               |
| `type.footnote`   | 13 / 18     | 400    | 0        | Helper text, inline errors, timestamps                 |
| `type.caption`    | 12 / 16     | 500    | 0.2      | Section headers (sentence case, not uppercase), badges |

**Money is always tabular.** Every element that renders an amount sets
`fontVariant: ['tabular-nums']`, so a column of amounts aligns on the decimal and digits do
not jitter as a total changes. Tokens that always carry it: `type.amountHero`, `type.display`,
and `type.bodyStrong` when used for an amount.

**Dynamic type.** All sizes are specified at the OS default. The app does **not** disable font
scaling — `allowFontScaling` stays at its default `true`. Consequences the implementation must
handle:

1. No fixed-height text containers. Rows grow.
2. The expense row switches from a single line to a stacked layout above `fontScale > 1.3`
   (see [`04-expense-list.md`](./04-expense-list.md) §Accessibility).
3. Icon-and-label pairs wrap to a column rather than truncating the label.
4. `numberOfLines` is only ever set on free text the user authored (note, category name), never
   on an amount or a system string.

---

## 3. Spacing scale

4pt base. Reference by token; never write a raw number.

| Token      | px  | Typical use                                                    |
| ---------- | --- | -------------------------------------------------------------- |
| `space.0`  | 0   | —                                                              |
| `space.1`  | 4   | Icon-to-label, chip inner padding                              |
| `space.2`  | 8   | Tight stacks, badge padding                                    |
| `space.3`  | 12  | Row inner vertical padding, input inner padding                |
| `space.4`  | 16  | **Default.** Screen horizontal gutter, card padding, stack gap |
| `space.5`  | 20  | Gap between unrelated rows                                     |
| `space.6`  | 24  | Section gap, space above a primary button                      |
| `space.8`  | 32  | Large section gap, empty-state inner spacing                   |
| `space.10` | 40  | Empty-state top offset                                         |
| `space.12` | 48  | Hero spacing on Welcome                                        |
| `space.16` | 64  | Welcome logo offset                                            |

**Screen gutter is `space.4` (16) on both edges, always.** Full-bleed is reserved for row
separators and the chart.

**Safe areas.** Every screen wraps in `SafeAreaView` (or uses `useSafeAreaInsets`). The bottom
inset is additive to the specified padding, never a substitute for it — a screen with a bottom
button has `space.4` of padding _plus_ the inset.

---

## 4. Radii, elevation, motion

| Token         | Value | Use                                       |
| ------------- | ----- | ----------------------------------------- |
| `radius.none` | 0     | Full-bleed separators                     |
| `radius.sm`   | 6     | Badges, swatches, chips                   |
| `radius.md`   | 10    | Inputs, buttons, keypad keys              |
| `radius.lg`   | 14    | Cards, sheets (top corners only), dialogs |
| `radius.pill` | 999   | Sync pill, month chip, filter chip        |

| Token         | Spec                                                                                 | Use                                 |
| ------------- | ------------------------------------------------------------------------------------ | ----------------------------------- |
| `elevation.0` | none                                                                                 | Rows inside a card                  |
| `elevation.1` | `shadowColor #111827`, opacity 0.06, radius 8, offset (0,2); Android `elevation: 2`  | Cards, the app bar once scrolled    |
| `elevation.2` | `shadowColor #111827`, opacity 0.12, radius 16, offset (0,6); Android `elevation: 6` | FAB, snackbar, bottom sheet, dialog |

| Token         | Value              | Use                                     |
| ------------- | ------------------ | --------------------------------------- |
| `motion.fast` | 120ms, ease-out    | Press feedback, checkbox, swatch select |
| `motion.base` | 200ms, ease-out    | Sheet/dialog enter, snackbar in         |
| `motion.slow` | 280ms, ease-in-out | Month transition, screen push           |

**Reduce Motion.** When `AccessibilityInfo.isReduceMotionEnabled()` is true, all three
durations collapse to 0ms and transitions become cross-fades. The month transition in
particular must not slide, and the `refresh-cw` sync glyph must not rotate. No motion in this
app is load-bearing for meaning.

---

## 5. Icons

`@expo/vector-icons` → **Feather**, one set, no mixing. Default size 20, stroke 2, colour
inherited from the adjacent text token.

| Purpose               | Icon                             | Default size                             |
| --------------------- | -------------------------------- | ---------------------------------------- |
| Add                   | `plus`                           | 24 (in FAB)                              |
| Back                  | `chevron-left`                   | 24                                       |
| Previous / next month | `chevron-left` / `chevron-right` | 20                                       |
| Close / dismiss       | `x`                              | 24                                       |
| Delete                | `trash-2`                        | 20                                       |
| Edit                  | `edit-2`                         | 20                                       |
| Category              | `tag`                            | 20                                       |
| Date                  | `calendar`                       | 20                                       |
| Note                  | `file-text`                      | 20                                       |
| Settings              | `settings`                       | 24                                       |
| Summary tab           | `pie-chart`                      | 24                                       |
| List tab              | `list`                           | 24                                       |
| Pending sync          | `clock`                          | 14                                       |
| Syncing               | `refresh-cw`                     | 14 (rotates; static under Reduce Motion) |
| Offline               | `cloud-off`                      | 14                                       |
| Sync error            | `alert-circle`                   | 14                                       |
| Backspace (keypad)    | `delete`                         | 24                                       |
| Check / selected      | `check`                          | 20                                       |

**No icon is ever the sole label of an action** unless it also carries an
`accessibilityLabel` _and_ is one of the four universally-understood glyphs (`plus`, `x`,
`chevron-left`, `chevron-right`). Everything else pairs with visible text.

---

## 6. Component baseline

The shared primitives the screen specs assume exist. Each spec references these rather than
redescribing them.

### `Button`

| Variant       | Fill              | Label                                | Border             | Height |
| ------------- | ----------------- | ------------------------------------ | ------------------ | ------ |
| `primary`     | `primary.default` | `text.inverse`, `type.bodyStrong`    | none               | 48     |
| `secondary`   | `bg.surface`      | `primary.default`, `type.bodyStrong` | 1px `border.input` | 48     |
| `ghost`       | transparent       | `primary.default`, `type.bodyStrong` | none               | 44     |
| `destructive` | `danger.default`  | `text.inverse`, `type.bodyStrong`    | none               | 48     |

- `radius.md`. Horizontal padding `space.5`. Full-width when it is a screen's main action.
- **Pressed**: `primary` takes `primary.pressed`; `destructive` darkens equivalently;
  `secondary` and `ghost` take a `primary.subtle` fill. `motion.fast`.
- **Disabled**: fill `bg.sunken`, label `text.disabled`, no border,
  `accessibilityState={{ disabled: true }}`, **and** the blocking reason rendered as
  `type.footnote` / `text.tertiary` helper text directly below. A disabled primary button with
  no stated reason is a spec violation.
- **Busy**: the label is replaced by a 20px `ActivityIndicator` in the label colour; the width
  is held so the button does not resize; `accessibilityLabel` becomes `"<label>, in progress"`;
  taps are ignored. Used for exactly two actions in the whole app — Sign up and Log in — because
  those are the only two that must wait on the network.

### `TextField`

```
Label                                    <- type.subhead, text.secondary, space.2 below
+--------------------------------------+
| Value or placeholder                 |  <- 48 tall, radius.md, 1px border.input,
+--------------------------------------+     space.3 inner padding, type.body
Helper or error text                     <- type.footnote, space.1 above
```

- **Focused**: border becomes 2px `border.focus`, drawn inset so the field does not shift.
- **Error**: border 1px `danger.default`, helper slot shows the error in `danger.default`, and
  the field gets `accessibilityLabel="<Label>, invalid: <error text>"`. The error text
  _replaces_ the helper text; the two never stack.
- Validation timing is specified per screen. The global rule: **never show an error for a field
  the user has not yet left.** See [`03-auth.md`](./03-auth.md) §Behaviour.

### `Row`

A 56-tall (minimum) `bg.surface` touchable. `space.4` horizontal padding, `space.3` vertical,
1px `border.hairline` bottom separator inset to the content's leading edge. Pressed:
`bg.sunken`. Grows with content and font scale — 56 is a floor, not a fixed height.

### `Snackbar`

Bottom-anchored, `space.4` above the safe-area bottom (and above the tab bar when present),
`bg.surface` at `elevation.2`, `radius.md`, `space.4` padding. Message `type.callout` /
`text.primary`; optional action `type.bodyStrong` / `primary.default`, right-aligned, 44 target.
Auto-dismisses after **5s**, or **10s** when `AccessibilityInfo.isScreenReaderEnabled()` is
true. One at a time; a new snackbar replaces the current one. Always announced via
`AccessibilityInfo.announceForAccessibility`.

### `Dialog`

Centred, `bg.surface`, `radius.lg`, `elevation.2`, max width 320, `space.5` padding, over
`bg.scrim`. Title `type.title2`; body `type.callout` / `text.secondary`; actions stacked
full-width with the **destructive action on top** and Cancel below it, `space.2` gap.
Dismissible by scrim tap and Android back — both of which resolve as **Cancel**, never as the
destructive action.

### `Sheet`

Bottom sheet, `bg.surface`, `radius.lg` top corners, `elevation.2`, over `bg.scrim`. A 36x4
`border.strong` grabber `space.2` from the top. Header row: title `type.title2` leading, an `x`
close button trailing (44 target). Content gets `space.4` padding and respects the bottom safe
area. Dismiss by grabber drag, scrim tap, `x`, or Android back.

---

## 7. Default categories seeded on signup

Created client-side immediately on successful signup, with client-minted UUIDv7 ids, and pushed
through the normal outbox. They are ordinary rows with `isDefault: true` — **not** a server-side
fixture the client waits for. A user who signs up on a plane gets a working category list.

This list is **`DEFAULT_CATEGORIES` in `shared/src/category.ts`** — the contract owns it, this
table mirrors it. Six categories, in the contract's order, with the accessible colour tokens
from §1.3 substituted for the contract's hex values (see the note there).

| Order | Name              | Colour token      | Hex       | `isDefault` | Deletable | Renameable |
| ----- | ----------------- | ----------------- | --------- | ----------- | --------- | ---------- |
| 1     | **Uncategorized** | `category.slate`  | `#6B7280` | **`true`**  | **no**    | yes        |
| 2     | Groceries         | `category.green`  | `#2F8044` | `false`     | yes       | yes        |
| 3     | Transport         | `category.blue`   | `#2F6FD0` | `false`     | yes       | yes        |
| 4     | Eating out        | `category.orange` | `#A85C12` | `false`     | yes       | yes        |
| 5     | Bills             | `category.purple` | `#8E4EC6` | `false`     | yes       | yes        |
| 6     | Health            | `category.red`    | `#C73B3B` | `false`     | yes       | yes        |

Notes the implementation must honour:

1. **`isDefault: true` means "protected", and exactly one category has it.** Per
   `shared/src/category.ts`, `isDefault` is "true for the seeded `Uncategorized` category,
   which always exists and cannot be deleted". The other five seeds are ordinary rows with
   `isDefault: false` — a user who never buys groceries can delete Groceries.
2. **Uncategorized is structural.** It is the reassignment target when a category is deleted
   (`docs/PLAN.md` §Deletes), so it must always exist. The server enforces this: deleting it
   returns `category_not_deletable`.
3. **Identify it by `isDefault`, never by name.** The flag is the contract's marker; the name
   is user-visible data. This matters because rename is _not_ blocked — `CategoryUpdateRequest`
   accepts `name` on any category and `category_not_deletable` only guards delete. A user may
   rename Uncategorized to "Misc" and everything keeps working, because the reassignment target
   is resolved by flag.
4. **Therefore every string that names the fallback category interpolates it.** Copy says
   "move to {fallbackName}", resolved at render time from the `isDefault` row, not the literal
   word "Uncategorized". See [`09-copy-deck.md`](./09-copy-deck.md) §3 and
   [`07-categories.md`](./07-categories.md) §Behaviour rule 9.
5. Display order in the picker and in the category list is **alphabetical by name**, with the
   `isDefault` category pinned last regardless. The `Order` column above is seed order only,
   and matches the contract array so a diff against it is readable.
6. Names are sentence-case as written ("Eating out", not "Eating Out"), and are not localised
   in the MVP (English only).
7. **Who writes these rows is a contract question, not a design one.** `DEFAULT_CATEGORIES`
   living in `shared/` reads as a server-side signup fixture, while `docs/PLAN.md` §Mobile
   requires a user who signs up on a plane to get a working category list. Both can be true
   only if the client seeds them locally and the push converges by id. Raised with Chief — see
   [`README.md`](./README.md) §Open contract items item 2. **The screen specs do not depend on
   the answer**: Home and the category picker read whatever rows SQLite holds, and the
   first-run empty state is specified for a zero-category list regardless.

---

## 8. Accessibility baseline

Applies to every screen. A screen spec's §Accessibility section lists only what it adds.

1. **Minimum tap target 44x44 pt.** Use `hitSlop` to grow a small glyph rather than padding the
   layout. Verified per screen in the Elements table.
2. **Every touchable has an `accessibilityRole`** (`button`, `link`, `switch`, `tab`, `header`)
   and a label that makes sense read alone — `"Delete Groceries"`, not `"Delete"`.
3. **Amounts are read as money, not digits.** An amount's `accessibilityLabel` is the formatted
   currency string, which VoiceOver and TalkBack both read correctly from `"$12.50"`. Never let
   a screen reader read a raw `amountMinor`.
4. **Colour is never the sole carrier of meaning.** Sync state pairs an icon with text; category
   colour pairs with a name; errors pair `danger.default` with an icon and literal text.
5. **Focus order is visual order** — top to bottom, leading to trailing. Decorative views set
   `accessibilityElementsHidden` / `importantForAccessibility="no-hide-descendants"`.
6. **Row grouping.** An expense row is one accessibility element, not four — the whole row has a
   composed label (see [`04-expense-list.md`](./04-expense-list.md) §Accessibility), so a
   screen-reader user swipes once per expense instead of four times.
7. **State changes are announced**, not just rendered: save confirmations, delete-with-undo,
   validation failures, and the `resyncRequired` takeover all call `announceForAccessibility`.
8. **Reduce Motion** is respected (§4). **Bold Text** is inherited from the system — no weight
   is hardcoded below 400 anywhere.
9. **No timed interaction has a deadline shorter than 5s**, and the only timed element is the
   snackbar, whose action is always also reachable another way (an undone delete can be
   re-created; see [`04-expense-list.md`](./04-expense-list.md) §Behaviour rule 8).
