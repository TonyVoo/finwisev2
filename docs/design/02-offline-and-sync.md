# Offline & Sync — the shared state vocabulary

Owner: Designer · Last updated: 2026-10-06

**Read this before any screen spec.** Every screen's §States table uses the terms defined
here, and none of them redefine these states locally. If a screen needs to deviate, it says so
explicitly.

The governing decision from `docs/PLAN.md` §Mobile:

> `expo-sqlite` is the single source of truth the UI reads from. The UI never awaits the
> network to render.

Everything below follows from that. **Offline is not a state this app enters — it is the
assumption it is built on.** "Online" only means a background process is succeeding.

---

## 1. The rule that replaces a hundred decisions

> **No screen has a network loading state for reading data.**

There is no spinner waiting on a `GET`. A screen reads SQLite, which is local and fast, and
renders on the first frame. The only two places in the entire app where the user waits on a
server are **Sign up** and **Log in** (`03-auth.md`), because minting an identity is the one
thing that cannot be done locally.

This has a consequence worth stating plainly, because it is the most common way an
offline-first app gets built wrong:

| Wrong                                   | Right                                                |
| --------------------------------------- | ---------------------------------------------------- |
| Spinner on Home while expenses load     | Home renders rows from SQLite immediately            |
| "Failed to load expenses. Retry"        | Impossible — a local read cannot fail on the network |
| Disable Save while offline              | Save always works; it writes locally                 |
| Toast "You are offline" on every screen | A persistent, quiet sync pill; no interruption       |
| Block the UI until a write is confirmed | The write is confirmed by SQLite, not the server     |

A **loading** state in a screen spec therefore means one of exactly two things, and each spec
says which:

- **`loading:first-paint`** — the SQLite query has not returned yet. Lasts one or two frames in
  practice. Shown as a skeleton. Never shown for longer than 300ms without becoming the
  `empty` state, because if the query returned nothing, the answer is "empty", not "loading".
- **`loading:hydrating`** — a genuinely empty local database being filled by a first full pull,
  i.e. the frames right after a fresh log in on a new device. This is the **only** state in the
  app where the user waits on the network to see data, and it happens once per install.

---

## 2. Record-level state: `pending`

Every syncable row carries a local-only flag the server never sees. The outbox is its source of
truth: **a row is `pending` if an undrained outbox row references its id.**

| Local state       | Meaning                                | Where it shows                                                                  |
| ----------------- | -------------------------------------- | ------------------------------------------------------------------------------- |
| `synced`          | No outbox row. The server has it.      | Nothing. This is the default and is visually silent.                            |
| `pending`         | Outbox row queued or in flight.        | A `clock` glyph, 14px, `warning.default`, leading the row's amount              |
| `needs-attention` | A push returned `invalid` for this row | An `alert-circle` glyph, 14px, `danger.default`, plus a tappable row affordance |

### The three rules for `pending`

1. **`pending` is not an error and is never coloured as one.** It uses `warning.*`, never
   `danger.*`. The user did nothing wrong; the phone is just in a tunnel. It must not be red
   and must not carry an alert icon.
2. **`pending` is never a blocker.** A `pending` expense is fully editable, deletable, and
   counts toward the month total exactly like a synced one. Editing a `pending` row updates the
   same row and coalesces into the outbox — it does not queue a second mutation.
3. **`pending` disappears silently.** When the push returns `applied`, the glyph is removed
   with a `motion.fast` cross-fade. **No success toast, no "Synced!" confirmation.** Confirming
   something the user already considers done is noise; the local write was the confirmation.

### Why a per-row indicator at all

It would be defensible to show nothing. The reason it exists is the multi-device case: someone
who adds an expense on a plane and then opens the app on a tablet needs a way to understand why
it is not there yet. The glyph is the smallest honest answer. It is deliberately 14px and
`warning.default` rather than a badge — legible if you look for it, invisible if you do not.

---

## 3. App-level state: the sync pill

One shared component. Appears in the app bar on **Home** and **Summary** only — not on pushed
screens, not on sheets, not on auth screens. It is the single place the app talks about
connectivity.

```
+----------------------------------+
| Expenses        [ (!) 3 pending ]|   <- app bar, pill trailing
+----------------------------------+
```

`radius.pill`, height 24, `space.2` horizontal padding, `space.1` gap between glyph and label,
icon 14px, label `type.caption`. **Tap target is 44x44** via `hitSlop`, even though the pill is
24 tall.

| #   | State             | Condition                               | Glyph                   | Label                   | Fill / text                          | Tappable |
| --- | ----------------- | --------------------------------------- | ----------------------- | ----------------------- | ------------------------------------ | -------- |
| 1   | Idle              | online, outbox empty                    | —                       | —                       | **renders nothing at all**           | no       |
| 2   | Syncing           | a push or pull is in flight             | `refresh-cw` (rotating) | `Syncing…`              | `info.subtle` / `info.default`       | no       |
| 3   | Pending           | outbox non-empty, online, not in flight | `clock`                 | `{n} pending`           | `warning.subtle` / `warning.default` | yes      |
| 4   | Offline           | netinfo reports unreachable             | `cloud-off`             | `Offline`               | `bg.sunken` / `text.secondary`       | yes      |
| 5   | Offline + pending | unreachable, outbox non-empty           | `cloud-off`             | `Offline · {n} pending` | `warning.subtle` / `warning.default` | yes      |
| 6   | Error             | last sync attempt failed while online   | `alert-circle`          | `Sync failed`           | `danger.subtle` / `danger.default`   | yes      |

### Rules

1. **State 1 renders nothing — not an empty pill, not a green tick.** The steady state of a
   working app is silence. A permanent "Synced" badge trains the user to ignore the one spot
   they need to read when it matters.
2. **`Syncing…` is suppressed for the first 800ms** of any sync. Most syncs finish faster than
   that, and a pill that flickers on every write is worse than one that never appears. If the
   sync completes inside 800ms, the pill never renders.
3. **State 4 is not an error.** Grey and quiet. Being offline is the expected condition of this
   app, and the copy never apologises for it or implies something is broken.
4. **Tapping states 3, 4 and 5 opens the Sync detail sheet** (§4). Tapping state 6 does the
   same with the error section expanded.
5. **`{n}` counts distinct records with undrained outbox rows**, not outbox rows, so three
   edits to one expense read as `1 pending`. The singular form is `1 pending`, never
   `1 pendings`.
6. The pill is **`accessibilityRole="button"`** in states 3-6 and `accessibilityElementsHidden`
   in state 1. Its `accessibilityLabel` is the full sentence from `09-copy-deck.md` §4, not the
   terse label — `"Offline, 3 changes waiting to sync. Double tap for details."`, not
   `"Offline · 3 pending"`.
7. **The pill never moves layout.** It occupies a fixed-width trailing slot in the app bar,
   sized to its widest state, so the screen title does not shift when sync state changes.

---

## 4. The Sync detail sheet

A `Sheet` (`00-foundations.md` §6). The only place sync is explained in words, and the only
place a manual retry exists.

```
+--------------------------------+
|  ====                          |
|  Sync                      [x] |
|                                |
|  (cloud-off)  Offline          |
|  Your changes are saved on     |
|  this device and will sync     |
|  automatically when you are    |
|  back online.                  |
|                                |
|  3 changes waiting             |
|   Groceries    $12.50  Added   |
|   Transport     $3.20  Edited  |
|   Eating out    $4.00  Deleted |
|                                |
|  Last synced 2 hours ago       |
|                                |
|  [ Try again ]   (error only)  |
+--------------------------------+
```

| Element                | Style                                 | Copy                                                   | Notes                                   |
| ---------------------- | ------------------------------------- | ------------------------------------------------------ | --------------------------------------- |
| Title                  | `type.title2` / `text.primary`        | `Sync`                                                 | `accessibilityRole="header"`            |
| Status icon            | 20px, state colour                    | —                                                      | `accessibilityElementsHidden`           |
| Status headline        | `type.bodyStrong`                     | state label, `09-copy-deck.md` §4                      |                                         |
| Status body            | `type.callout` / `text.secondary`     | state explanation, `09-copy-deck.md` §4                |                                         |
| Pending section header | `type.caption` / `text.tertiary`      | `{n} changes waiting` / `1 change waiting`             | omitted when `n === 0`                  |
| Pending item           | `type.callout`; amount `tabular-nums` | `{category}` · `{amount}` · `Added`/`Edited`/`Deleted` | max 5 shown, then `and {n} more`        |
| Last synced            | `type.footnote` / `text.tertiary`     | `Last synced {relative}` / `Not synced yet`            | relative format in `09-copy-deck.md` §5 |
| `Try again`            | `Button` `secondary`, full width      | `Try again`                                            | **present only in the Error state**     |

### Rules

1. **There is no "Sync now" button in the Offline or Pending states.** Offering a retry that
   cannot succeed, or that would happen in a moment anyway, invites the user to tap something
   that does nothing. `Try again` appears only in state 6, where the app actually reached a
   server and failed, and a retry is therefore meaningful.
2. **`Try again` enters a Busy state** for the duration of the attempt, then the sheet updates
   in place. It does not close.
3. The sheet is **read-only otherwise.** No per-item retry, no "discard this change", no
   editing from here. Those are the list's job.
4. `Deleted` items show the category and amount of the deleted expense, read from the
   tombstoned local row, so the list is not a column of blanks.
5. **The sheet is reachable only via the pill,** which makes it unreachable in the idle state.
   That is intended: there is nothing to say.

---

## 5. The four states that are genuinely unusual

Each one gets a precise treatment because each one is easy to get wrong.

### 5.1 A push returned `invalid` — `needs-attention`

A row the server refused. In the MVP the only realistic cause is `unknown_category`: an expense
whose category was deleted on another device between the local write and the push.

- The expense row on Home gains a trailing `alert-circle` in `danger.default`, and its subtitle
  is replaced by `Couldn't sync — tap to fix` in `type.footnote` / `danger.default`.
- Tapping opens **Edit expense** with the Category field in its error state, carrying the copy
  `This category no longer exists. Pick another.` Category is the only pre-focused field.
- Saving re-queues the row and clears the flag. **The row is never silently discarded or
  auto-reassigned** — the user chose a category, and picking a different one on their behalf
  loses information they may care about.
- The row still counts toward the month total. It is a real expense that exists locally.
- The sync pill does **not** enter the Error state for this. State 6 is for transport failures;
  a per-record rejection is a per-record problem and is surfaced on the record.

### 5.2 `conflict_server_wins` — the user's edit was dropped

The server held a newer `updatedAt`, so the local write lost and the client overwrites its row
with the authoritative server row from the response (`docs/PLAN.md` §Push).

**The user is not notified.** This is a deliberate and slightly uncomfortable choice, so the
reasoning is recorded rather than left implicit:

- LWW _is_ the product decision (`docs/PLAN.md` §4). A notification cannot offer a remedy —
  there is no merge UI in the MVP and no way to recover the dropped value, because it was
  overwritten by design.
- A toast reading "your change was overwritten", with no action attached, is pure anxiety.
- The realistic frequency in a single-user, two-device app is near zero, and the realistic cause
  is editing the same expense on two devices — where the last edit winning is what the user
  would expect anyway.

What the implementation **must** do: overwrite the local row, clear the `pending` flag, and let
the list re-render. If that row is open in the Edit form at that moment, rule 5.4 applies.

### 5.3 `resyncRequired` — the 90-day takeover

The client's cursor predates the tombstone horizon, so the server cannot answer incrementally
without risking resurrected rows. The client wipes local state and pulls from `since=0`.

This is the **one** full-screen blocking state in the app, because the local database is about
to be deleted and the UI cannot read from it mid-wipe.

```
+--------------------------------+
|                                |
|         (refresh-cw)           |
|                                |
|          Catching up           |
|                                |
|   You have not used the app    |
|   in a while, so we are        |
|   refreshing your expenses     |
|   from scratch. This only      |
|   takes a moment.              |
|                                |
|         [====------]           |
|                                |
+--------------------------------+
```

- Full-screen over `bg.canvas`, centred, replaces the tab bar. Not dismissible.
- Headline `Catching up` in `type.title2`. Body `type.callout` / `text.secondary`.
- A determinate progress bar when `hasMore` allows a page estimate, otherwise an indeterminate
  one. `primary.default` fill on a `bg.sunken` track.
- Announced via `announceForAccessibility` on appear and on completion.
- **The copy never says "resync", "cursor", "horizon" or "wiped".** The user's mental model is
  "my expenses"; the mechanism is not their problem.
- **Precondition the implementation must honour:** this is only safe when the outbox is empty.
  A wipe with undrained local writes destroys data the server has never seen. If the outbox is
  non-empty when `resyncRequired` arrives, **push first, then wipe.** If the push cannot
  complete, **do not wipe** — stay on the normal UI in the pill's Error state and retry later.
  A stale-but-intact local database is strictly better than a clean one missing the user's work.

### 5.4 A row changes underneath an open Edit form

A pull or a conflict overwrites the row the user is currently editing.

- **The form does not change under the user's hands.** In-progress input is never replaced
  mid-edit; that loses typing and is deeply disorienting.
- A non-blocking inline notice appears directly below the app bar: `info.subtle` background,
  `type.footnote` / `info.default`, copy `This expense changed on another device.`, with a
  trailing `Reload` ghost action.
- `Reload` discards local edits and reloads from SQLite. Not tapping it means **Save wins**: the
  save writes the user's values with a fresh `updatedAt`, which LWW then resolves in their
  favour. The user finished their edit last, so their edit should win.
- If the row was **deleted** elsewhere, the notice reads `This expense was deleted on another
device.` and the trailing action becomes `Close`. Save becomes disabled with the helper text
  `This expense no longer exists.` — saving would undelete a row the user never asked to
  restore.

---

## 6. What every screen spec must specify

The §States table of each screen spec has exactly these rows. This list is the checklist; a
spec with a missing row is incomplete.

| Row               | Question it answers                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `default`         | Data present, nothing unusual                                                                                            |
| `empty`           | No data — and whether this is first-run empty or filtered-empty, because they differ                                     |
| `loading`         | Which of `first-paint` / `hydrating`, and what is shown                                                                  |
| `error`           | What can actually fail _on this screen_ — often "nothing can", which is a valid answer that must be stated and justified |
| `offline-pending` | What the user sees with local unsynced changes, per §2 and §3                                                            |

The `error` row deserves emphasis. For most screens in this app the honest answer is **"no
reachable error state: this screen reads local SQLite and cannot fail on the network."** That is
a real specification, and it is what the acceptance criteria mean by "no element without stated
behaviour". What it must not be is blank.
