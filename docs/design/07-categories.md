# 5. Category management

Owner: Designer · Last updated: 2026-10-06

### Purpose

List, create, rename, recolour and delete categories — and make it unmistakable that deleting
one **moves** its expenses rather than destroying them.

### Route

`/(app)/settings/categories`, pushed from the `Categories` row in Settings
([`04-expense-list.md`](./04-expense-list.md) §Behaviour rule 14).

Flow: [`01-flows.md`](./01-flows.md) §5.

---

## 1. Category list

### Layout

```
+----------------------------------------+
| (<)     Categories                     |   app bar
+----------------------------------------+
| +------------------------------------+ |
| | (o) Bills                 4    (>) | |   Row, 56
| +------------------------------------+ |
| | (o) Eating out           12    (>) | |
| +------------------------------------+ |
| | (o) Groceries            23    (>) | |
| +------------------------------------+ |
| | (o) Health                0    (>) | |
| +------------------------------------+ |
| | (o) Transport             7    (>) | |
| +------------------------------------+ |
| | (o) Uncategorized         2    (>) | |   pinned last, no swipe action
| +------------------------------------+ |
|                                        |
|                              ( + )     |   FAB
+----------------------------------------+
```

### Elements

| # | Element | Style | Copy | Tap target | Accessibility |
|---|---------|-------|------|------------|---------------|
| 1 | Back | `chevron-left` 24, `text.primary` | — | 44x44 | `role="button"`, label `Back` |
| 2 | Title | `type.headline` / `text.primary` | `Categories` | none | `role="header"` |
| 3 | Category row | `Row` 56 min | see 4-7 | full row | one composed element — see §5 |
| 4 | Swatch | 24x24, `radius.sm`, the category's colour | — | none | `accessibilityElementsHidden` |
| 5 | Name | `type.body` / `text.primary`, `numberOfLines={1}` | the name | none | part of 3 |
| 6 | Count | `type.callout` / `text.tertiary`, `tabular-nums`, trailing before 7 | the live expense count, e.g. `23` | none | read as `23 expenses` / `1 expense` / `No expenses` |
| 7 | Chevron | `chevron-right` 20, `text.tertiary` | — | none | decorative |
| 8 | Swipe delete | behind the row, `danger.default`, `trash-2` 20 + `Delete` in `text.inverse` | `Delete` | ≥64 wide | via `accessibilityAction`, see §5 rule 3 |
| 9 | FAB | 56x56, `radius.pill`, `primary.default`, `elevation.2`, `plus` 24 | — | 56x56 | `role="button"`, label `Add category` |

### States

| State | What the user sees |
|-------|--------------------|
| `default` | As drawn. Alphabetical by name, case-insensitive, with the `isDefault` category pinned last regardless of its name (`00-foundations.md` §7 note 5). |
| `empty` | **Structurally unreachable** — the `isDefault` category cannot be deleted, so the list always holds at least one row. Specified anyway as a defensive state, because a sync from a peer that violated the invariant could produce it: show the §4 rule 9 repair path, not an empty-state illustration. |
| `loading:first-paint` | A single-frame skeleton of four rows (24x24 block + 120x16 block + trailing 24x16 block, all `bg.sunken`). The count query is a local `GROUP BY` and resolves with the list; counts never render as a spinner or as `—`. |
| `error` | **No reachable error state.** The screen reads local SQLite. A failed *push* of a category change surfaces in the sync pill on Home, never here. A rejected rename (`category_name_taken` from a peer's concurrent create) is handled per §4 rule 8. |
| `offline-pending` | Identical layout. A category with an undrained outbox row shows the `clock` 14 `warning.default` glyph between its name and count. **Create, rename, recolour and delete all work normally while offline** — every one is a local write. No banner, no disabled rows. |

### Behaviour

1. **Counts are live, local and all-time.** `SELECT categoryId, COUNT(*) FROM expenses WHERE
   deletedAt IS NULL GROUP BY categoryId`. They count every month, not the month selected on
   Home — this screen is not month-scoped, and a count that silently meant "this month" would
   make the delete dialog's promise wrong.
2. A count of zero renders as `0`, not as blank, so the column stays scannable.
3. **Tapping a row** opens the edit sheet (§3). **Swiping** reveals Delete (§4).
4. **The `isDefault` row has no swipe action at all** — it is not revealed-then-blocked, because
   offering an action that always fails is worse than not offering it. The explanatory snackbar
   in [`01-flows.md`](./01-flows.md) §5 covers the case where delete is reached by another path
   (the sheet's Delete button, or an `accessibilityAction`).
5. **The FAB** opens the create sheet (§2).

---

## 2. Create category

A `Sheet`.

```
+--------------------------------+
|  ====                          |
|  New category              [x] |
|                                |
|  Name                          |
|  +--------------------------+  |
|  |                          |  |
|  +--------------------------+  |
|  helper / error               |
|                                |
|  Colour                        |
|  (o)(o)(o)(o)(o)               |   9 swatches, 2 rows
|  (o)(o)(o)(o)                  |
|                                |
|  +--------------------------+  |
|  |          Create          |  |
|  +--------------------------+  |
+--------------------------------+
```

| # | Element | Style | Copy | Tap target | Accessibility |
|---|---------|-------|------|------------|---------------|
| 1 | Title | `type.title2` | `New category` | none | `role="header"` |
| 2 | Close | `x` 24 | — | 44x44 | `role="button"`, label `Close` |
| 3 | Name label | `type.subhead` / `text.secondary` | `Name` | none | bound to 4 |
| 4 | Name field | `TextField`, autofocused | placeholder `e.g. Coffee` | 48 tall | `autoCapitalize="sentences"`, `maxLength={64}`, `returnKeyType="done"` |
| 5 | Name helper/error | `type.footnote` | per rule 3 | none | in the field's label when in error |
| 6 | Colour label | `type.subhead` / `text.secondary` | `Colour` | none | `role="header"` |
| 7 | Colour swatch | 40x40, `radius.md`, filled; selected gets a 2px `text.primary` ring with a 2px `bg.surface` inset gap **and** a `check` 20 in `text.inverse` | — | 44x44 `hitSlop` | `role="button"`, label the colour name (`Green`, `Orange`, …), `accessibilityState={{ selected }}` |
| 8 | Create | `Button` `primary`, full width | `Create` | full, 48 | `role="button"`; disabled per rule 2 |

### States

| State | What the user sees |
|-------|--------------------|
| `default` | Name empty and focused; the first unused colour preselected (`00-foundations.md` §1.3); Create disabled with helper `Enter a name.` |
| `empty` / `loading` | Neither applies — the sheet has no data to load and renders complete. The colour palette is a static token list. |
| `error` | Inline on the Name field only: per rule 3. No network error is reachable; the create is a local write. |
| `offline-pending` | Identical. The category is created locally and queued. **No indication that it is unsynced is shown in the sheet** — the row in the list behind it carries the `clock` glyph, which is the right place for it. |

### Behaviour

1. **Nine colours are offered**, not ten: `category.slate` is reserved for the `isDefault`
   category (`00-foundations.md` §1.3). The order is `tokens.json` → `categoryPickerOrder`.
2. **Create is disabled** while the trimmed name is empty, with the helper `Enter a name.`
   (`type.footnote` / `text.tertiary`).
3. **Name validation**, matching `CategoryName` in `shared/src/category.ts`:
   - Trimmed, 1-64 characters. The field hard-caps at 64 via `maxLength`; no error is needed for
     a limit that cannot be exceeded.
   - **Unique among live categories, compared case-insensitively.** Checked locally against
     SQLite on blur and on submit. Error copy: `You already have a category called "{name}".`
   - Validation runs on blur and then on every keystroke once an error has been shown, matching
     [`03-auth.md`](./03-auth.md) §Behaviour rule 2.
   - A name matching a **deleted** category is allowed; uniqueness is among live rows only, as
     the contract specifies.
4. **On Create**: write the row with a client-minted UUIDv7, `isDefault: false`, and the chosen
   hex; append one outbox row; both in one transaction. Dismiss the sheet. Snackbar
   `{name} created.`
5. **Colour is not unique.** Two categories may share a colour — the name disambiguates, and
   forcing uniqueness would make the tenth category impossible. The picker shows no warning for
   a colour already in use, but a colour in use by a live category gets a small `type.caption` /
   `text.tertiary` label `In use` beneath its swatch, so a user who wants distinct colours can
   avoid collisions without being blocked.
6. Opened from the category picker in [`06-expense-form.md`](./06-expense-form.md) §4, the new
   category is auto-selected for the expense and both sheets dismiss.

---

## 3. Rename / edit category

The same `Sheet` as §2 with four differences:

| | Create | Edit |
|---|--------|------|
| Title | `New category` | `Edit category` |
| Name field | empty, placeholder | prefilled with the current name, text selected on focus |
| Primary button | `Create` | `Save`, disabled until name or colour differs, helper `Make a change to save.` |
| Extra element | — | a `Delete category` `ghost` button with a `danger.default` label, full width, `space.6` below Save |

Behaviour differences:

1. **Uniqueness excludes the row being edited**, so saving a category without changing its name
   is not a conflict with itself.
2. **The `isDefault` category can be renamed**, and the sheet offers it normally. The contract
   permits it (`CategoryUpdateRequest` accepts `name` on any category; only *delete* is guarded
   by `category_not_deletable`), and nothing depends on its literal name because it is
   identified by its flag (`00-foundations.md` §7 note 3). Its colour picker, however, is
   **read-only**: `category.slate` is reserved so the fallback category stays visually
   consistent, and the swatch row is replaced by a single non-interactive swatch with the
   `type.footnote` / `text.tertiary` caption `This colour is reserved.`
3. **The `isDefault` category's sheet shows no Delete button.** Same reasoning as §1 rule 4.
4. Snackbar on save: `{name} updated.`
5. A rename is one `UPDATE` + one outbox row in a transaction. **Expenses are untouched** —
   they reference `categoryId`, so a rename is invisible to them and no reassignment occurs.

---

## 4. Delete category

The flow the acceptance criteria single out. See [`01-flows.md`](./01-flows.md) §5 for the
diagram.

### The dialog

A `Dialog` (`00-foundations.md` §6). Two variants by count.

**With expenses (`count > 0`):**

```
+------------------------------+
|  Delete Groceries?           |   type.title2
|                              |
|  Its 23 expenses will move   |   type.callout, text.secondary
|  to Uncategorized. They      |
|  won't be deleted.           |
|                              |
|  +------------------------+  |
|  |    Delete category     |  |   destructive, on top
|  +------------------------+  |
|  +------------------------+  |
|  |         Cancel         |  |
|  +------------------------+  |
+------------------------------+
```

**Without expenses (`count === 0`):**

```
+------------------------------+
|  Delete Health?              |
|                              |
|  It has no expenses.         |
|                              |
|  [    Delete category    ]   |
|  [         Cancel        ]   |
+------------------------------+
```

| Element | Style | Copy |
|---------|-------|------|
| Title | `type.title2` / `text.primary` | `Delete {name}?` |
| Body, `count > 1` | `type.callout` / `text.secondary` | `Its {count} expenses will move to {fallbackName}. They won't be deleted.` |
| Body, `count === 1` | same | `Its 1 expense will move to {fallbackName}. It won't be deleted.` |
| Body, `count === 0` | same | `It has no expenses.` |
| Confirm | `Button` `destructive`, full width | `Delete category` |
| Cancel | `Button` `secondary`, full width | `Cancel` |

### Behaviour

1. **The count is exact, local and all-time** (§1 rule 1). It is computed at the moment the
   dialog opens, not cached from the list render, so it cannot be stale.
2. **The copy states the outcome twice** — "will move to {fallbackName}" and "They won't be
   deleted." The second sentence exists because `Delete` is the louder word in the dialog, and
   losing spend history is the actual fear. This is the one place in the app where the copy is
   deliberately redundant.
3. **`{fallbackName}` is interpolated from the `isDefault` row**, never hardcoded to
   "Uncategorized" — the user may have renamed it (§3 rule 2).
4. **The confirm button says `Delete category`, not `Delete`.** In a dialog about expenses
   moving, a bare "Delete" invites misreading it as deleting them.
5. **The destructive action sits above Cancel**, and scrim tap plus Android back both resolve as
   Cancel (`00-foundations.md` §6).
6. **One SQLite transaction, in this order:** reassign every live expense with this
   `categoryId` to the `isDefault` category's id, bumping each one's `updatedAt`; soft-delete
   the category (`deletedAt = now`); append one outbox row **per changed record** — the category
   plus every reassigned expense. If these were separate transactions, a crash between them
   would leave expenses pointing at a deleted category.
7. **Push order is categories then expenses** (`SYNC_APPLY_ORDER`), which the outbox drain
   already guarantees. Note the reassignment pushes the *expenses'* new `categoryId`, so a peer
   converges on the same state without needing to re-derive the reassignment.
8. **A rejected push does not roll back the local delete.** If the server returns `invalid` for
   the category row, the local state stands and the affected records enter `needs-attention`
   per [`02-offline-and-sync.md`](./02-offline-and-sync.md) §5.1. Reverting a reassignment the
   user has already seen applied would be more surprising than leaving it and flagging it.
9. **The `isDefault` invariant and its repair.** Exactly one live category must have
   `isDefault: true`. The client resolves the fallback category as
   `SELECT id FROM categories WHERE isDefault = 1 AND deletedAt IS NULL LIMIT 1`. If that
   returns nothing — only reachable via a buggy peer or a hostile push — the client **recreates
   it locally** with a fresh UUIDv7, the name `Uncategorized`, `category.slate`, and
   `isDefault: true`, pushes it, and proceeds. It must never block a delete on a missing
   fallback, and must never pick an arbitrary other category as the target.
10. **No Undo.** Reversing this means un-reassigning exactly the expenses this operation touched
    — a set of ids held across a 5-second window while a sync may already be pushing them. The
    dialog is the gate instead, which is why this flow has one and expense delete does not. The
    data is not lost either way: the user can re-create the category and reassign.
11. **Result snackbar**, which confirms what actually happened rather than just that it
    happened:
    - `count > 1`: `{name} deleted. {count} expenses moved to {fallbackName}.`
    - `count === 1`: `{name} deleted. 1 expense moved to {fallbackName}.`
    - `count === 0`: `{name} deleted.`
12. **Deleting the `isDefault` category is impossible by design** and is guarded at three
    levels: no swipe action (§1 rule 4), no Delete button in its sheet (§3 rule 3), and the
    server's `category_not_deletable`. If it is somehow attempted, the snackbar reads
    `{fallbackName} can't be deleted. It's where expenses go when you delete a category.`
13. **Expenses currently open in the Edit form** when their category is deleted follow
    [`02-offline-and-sync.md`](./02-offline-and-sync.md) §5.4.

---

## 5. Accessibility

1. **A category row is one accessibility element** with the composed label
   `{name}, {count} expenses` (`, 1 expense` / `, no expenses` for the singular and zero cases),
   plus `, not synced yet` when pending. Hint: `Double tap to edit this category.`
2. The `isDefault` row appends `, cannot be deleted` to its label, so a screen-reader user
   learns the constraint before trying.
3. **Swipe-to-delete is not screen-reader accessible.** Every row therefore exposes an
   `accessibilityAction` named `delete` with the label `Delete {name}`, and Delete is also
   reachable from the edit sheet (§3). The `isDefault` row exposes **no** delete action.
4. Focus order: 1 → 2 → rows in visual order → 9.
5. In the sheets: title → close → name field → colour swatches in order → primary button →
   Delete (edit mode only).
6. **Colour swatches are labelled by colour name**, and selection is carried by
   `accessibilityState={{ selected }}` plus the `check` glyph — never by the ring alone, which
   is a purely visual cue (`00-foundations.md` §8 rule 4).
7. The delete dialog moves focus to its title on open, announces its body, and returns focus to
   the originating row on Cancel.
8. **The result snackbar is announced** via `announceForAccessibility`, including the
   reassignment count — this is the only confirmation that the expenses survived, so it must not
   be visual-only.
9. **Dynamic type.** Rows grow; the name wraps to two lines before the count column is allowed
   to shrink. Above `fontScale > 1.3` the count moves below the name, leading-aligned. Swatches
   stay 24x24 — they are not text and do not scale.
