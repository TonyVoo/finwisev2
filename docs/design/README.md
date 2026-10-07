# Expense Tracker — Design Specs

Owner: Designer · Status: ready for implementation · Last updated: 2026-10-06

These are the flows and screen specs the Mobile Dev builds from. They are written to be
implementable without asking a designer a question: every element is named, every piece of
copy is literal, every state is specified.

Plan of record is [`docs/PLAN.md`](../PLAN.md). Where this doc and the plan disagree, the
plan wins and this doc is the bug — raise it with Chief.

## Read in this order

| #   | Doc                                                  | What it covers                                                                        |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| —   | [`00-foundations.md`](./00-foundations.md)           | Colour, type, spacing, radii, elevation, icons, default categories, a11y baseline     |
| —   | [`01-flows.md`](./01-flows.md)                       | Flow diagrams: first launch, returning user, add/edit/delete expense, delete category |
| —   | [`02-offline-and-sync.md`](./02-offline-and-sync.md) | **Read before any screen spec.** The shared state vocabulary every screen refers to   |
| 1   | [`03-auth.md`](./03-auth.md)                         | Welcome, Sign up, Log in                                                              |
| 2   | [`04-expense-list.md`](./04-expense-list.md)         | Home screen — grouped by date, month total                                            |
| 3   | [`05-month-switcher.md`](./05-month-switcher.md)     | The shared month control used by Home and Summary                                     |
| 4   | [`06-expense-form.md`](./06-expense-form.md)         | Add / Edit expense, incl. the amount keypad                                           |
| 5   | [`07-categories.md`](./07-categories.md)             | Category list, create, rename, delete                                                 |
| 6   | [`08-monthly-summary.md`](./08-monthly-summary.md)   | Month total + per-category chart                                                      |
| —   | [`09-copy-deck.md`](./09-copy-deck.md)               | Every string in one place, incl. error-code → message map                             |
| —   | [`tokens.json`](./tokens.json)                       | The foundations as a machine-readable export. Import this; don't retype hex values    |

## Conventions used in every screen spec

Each screen spec has the same sections, in this order:

1. **Purpose** — one sentence.
2. **Route** — the expo-router path.
3. **Layout** — an ASCII wireframe. Boxes are regions, not pixel-accurate.
4. **Elements** — a table: every element, its token-referenced style, its literal copy, its
   tap target, and its `accessibilityLabel`/`accessibilityRole`.
5. **States** — a table covering **default, empty, loading, error, offline-with-pending**. Every
   screen has all five rows; "same as default" is an acceptable value, "TBD" is not.
6. **Behaviour** — interaction rules and validation, written as numbered rules.
7. **Accessibility** — focus order, screen-reader notes, dynamic-type notes, anything beyond
   the baseline in `00-foundations.md`.

### Terms

- **Minor units** — money is always an integer of the currency's smallest unit (`amountMinor`).
  The UI formats for display; it never parses a user-typed decimal string. See
  [`06-expense-form.md`](./06-expense-form.md) §Behaviour.
- **Pending** — a local row whose change has not yet been accepted by the server. Normal, not an
  error. See [`02-offline-and-sync.md`](./02-offline-and-sync.md).
- **Tap target** — the touchable area, which is often larger than the visible glyph. Minimum
  44×44 pt everywhere, no exceptions.

## Scope notes (decisions, not omissions)

- **Light theme only for the MVP.** Dark mode is not in `docs/PLAN.md` scope. Tokens in
  `tokens.json` are namespaced under `color.light.*` so adding `color.dark.*` later is an
  additive change, not a refactor. Until then, the app pins
  `<StatusBar style="dark" />` and does not read the OS colour scheme.
- **No onboarding carousel, no tooltips tour.** The first-run empty state on Home does the
  teaching. See [`04-expense-list.md`](./04-expense-list.md) §States.
- **No avatar, no profile editing.** Settings holds the account email, the currency (read-only
  after signup), and Log out. Anything more is out of MVP scope.

## Relationship to the wire contract

`shared/src/` is the source of truth for anything that crosses the wire, and these specs are
written against it as it stands. Where they referenced something it does not have, the specs
changed — see the `docs(design): align foundations and flows to the landed wire contract`
commit. In particular the seeded category list, the `isDefault` semantics and the error-code
names in the flow diagrams all come from `shared/`, not from this doc.

Two earlier open items are now **closed** by the landed contract:

- `SignupRequest` carries an optional `currency` (defaulting to `USD`), which is what
  [`03-auth.md`](./03-auth.md) §1.2 needs.
- `ERROR_CODES` in `shared/src/errors.ts` is an exhaustive, documented list, and
  [`09-copy-deck.md`](./09-copy-deck.md) §2.1 maps **every** entry to copy.

## Settled contract items

Both items the design could not settle on its own were resolved on 2026-10-06. No screen spec
changed as a result — neither one was ever load-bearing for a layout.

| #   | Item                                   | Resolution                                                                                                                                                                                                                                                                                                                                    |
| --- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Category colours did not meet contrast | **Fixed in the contract**, approved by the board. `DEFAULT_CATEGORIES` now carries the six accessible hexes from [`00-foundations.md`](./00-foundations.md) §1.3 (4.83-5.18:1 on `bg.surface`) in place of the Tailwind 500-weights it held (2.28-3.96:1, three below even 3:1). Six constants, no wire-shape change, no consumers to update. |
| 2   | Who writes the seeded categories       | **The server does**, per `openapi.yaml` §`signup`. The client reads them and never mints them — see [`00-foundations.md`](./00-foundations.md) §7 note 7. The design previously assumed the opposite; that assumption was wrong and the specs are corrected.                                                                                  |

Item 2 corrected three places that had described client-side seeding: the §2 flow diagram in
[`01-flows.md`](./01-flows.md) (now a `GET /v1/categories` after the 201, not a local seed plus
push), §7 of the foundations, and the "no categories exist" rule in
[`06-expense-form.md`](./06-expense-form.md) §4, which had called that state unreachable and is
now reachable by exactly one route — a failed post-signup fetch, which the next sync repairs.

`shared/tests/tokens.test.ts` holds item 1 in place: it asserts `DEFAULT_CATEGORIES` and
[`tokens.json`](./tokens.json) agree on name, order, **colour** and `isDefault`, and it measures
both sides against the 4.5:1 floor. A colour that stops being accessible, on either side, fails
the build rather than shipping.
