# MVP Test Plan

Owner: QA Tester · Status: ready to execute · Last updated: 2026-10-09

Written in Wave 1 against the contract and the designs, **before** the features land, so that it
is ready the moment they do — and so that the gaps in §11 were found by writing it rather than by
hitting them in Wave 3.

**Revised 9 Oct** against the auth, CRUD and sync work that landed on 8–9 Oct. Five of the ten
gaps in §11 have closed, four of them by that work; the cases they blocked now carry real expected
results. Three cases were re-pointed because the settled contract contradicted what this plan
first assumed — `API-02`, `API-03` and `API-04`, where a bad row in a push batch is a per-record
`invalid` rather than a `400` for the whole batch. Those would have produced wrong verdicts, which
is the hazard a plan written early carries and the reason it is re-read against the code before
being executed rather than after.

Inputs this plan was derived from, and the authority order when they disagree:

1. [`docs/api/openapi.yaml`](../api/openapi.yaml) — the HTTP surface (statuses, headers, codes).
2. [`shared/src/`](../../shared/src) — the wire bodies. Where a body and the YAML disagree the zod
   schema wins, and `shared/tests/contract.test.ts` should have caught it already.
3. [`docs/design/`](../design) — screen behaviour, states and copy.
4. [`docs/PLAN.md`](../PLAN.md) — scope and architecture.

Where all four are silent, the case is listed in §11 as a gap rather than guessed at. **This plan
does not invent expected behaviour.** A case whose expected result is not derivable from an input
above is marked `[BLOCKED-BY-GAP n]` and is not executed until that gap closes.

---

## 1. How to read a case

Every case has the same four parts, and the expected result is written so that two different
people running it reach the same verdict.

| Part       | Meaning                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------- |
| **Layer**  | `API` (supertest against a live server), `Unit` (vitest/jest, no I/O), `E2E` (driven app), `Manual` |
| **Pre**    | Exact starting state, reached by a named fixture from §3 — never by "run the previous case first"   |
| **Steps**  | Numbered, one action each. No step says "verify"; verification lives entirely in Expect             |
| **Expect** | Observable, specific and falsifiable. Names statuses, codes, field values and screen copy           |

Rules this plan holds itself to:

- **No expected result is "it works" or "no errors".** Every one names what to look at.
- **Pass/fail is binary.** A case that needs judgement to call is split until it does not.
- **Fixtures, not ordering.** Cases are independent and may run in any order.
- A case that cannot fail is not a test. Each one below has a way to come out red.

### Traceability

IDs are stable and are quoted in bug reports and in commit messages.

| Prefix | Area                       | §   |
| ------ | -------------------------- | --- |
| `AUTH` | Sign up, log in, session   | 4   |
| `EXP`  | Expense CRUD               | 5   |
| `CAT`  | Category management        | 6   |
| `SUM`  | Monthly totals and chart   | 7   |
| `SYNC` | Offline use and sync       | 8   |
| `EDGE` | The named edge cases       | 9   |
| `API`  | Cross-cutting API contract | 10  |

---

## 2. Environment and tooling

### Layers and what each is for

| Layer  | Runner                                                                        | Scope                                                                                                                         |
| ------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Unit   | `vitest` (backend, shared); `jest` + `@testing-library/react-native` (mobile) | Pure logic: the sync resolver per branch, money formatting, month bounds, the amount keypad reducer, the outbox state machine |
| API    | `vitest` + `supertest` against the Express app on a throwaway Postgres        | Every status, code and body in the contract. All of §10 and most of §8                                                        |
| E2E    | The app driven on a simulator/emulator, plus at least one physical device     | The flows a user performs, and every case whose precondition is "aeroplane mode"                                              |
| Manual | Scripted, against the §12 matrix                                              | Accessibility, dynamic type, Reduce Motion, and anything needing a real radio                                                 |

### The E2E driver is not yet chosen — [GAP 9]

`docs/PLAN.md` §7 names vitest/supertest and jest/RNTL but no end-to-end driver, and several cases
below (`SYNC-01`–`SYNC-05`, `SYNC-19`, `SYNC-20`) are only meaningful against a running app with
real connectivity control. QA's recommendation is **Maestro**: YAML flows, first-class Expo
support, and a built-in `setAirplaneMode`, which is precisely the control this plan needs most.
Until it is agreed those cases run as `Manual`, which is slower and less repeatable but not
blocking.

### Controlling the network

Offline is the subject of this plan, so how it is produced matters more than usual. Three
mechanisms, used deliberately and never interchangeably:

| Mechanism                                                                                    | Produces                                                      | Used for                                                                                                                                  |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| OS aeroplane mode / `setAirplaneMode`                                                        | `netinfo` reports unreachable; sockets fail fast              | The honest offline case. Every `SYNC-0x` E2E case                                                                                         |
| A proxy that forwards the request and drops the **response** (toxiproxy, or a stub in front) | A request the server applied and the client never heard about | `SYNC-07`, `SYNC-08`. Aeroplane mode cannot produce this, which is exactly why it is listed separately — it is the retry bug's only cause |
| A jest mock of the `fetch` transport                                                         | Any status or body on demand                                  | Client-side unit cases: `token_expired` handling, per-record `invalid`, `resyncRequired`                                                  |

**Killing the app** (`SYNC-19`, `SYNC-20`) means `adb shell am force-stop` on Android and
`xcrun simctl terminate` on iOS. Not a backgrounding and not a JS reload — both leave the process
alive and would make those cases pass vacuously.

### Controlling the clocks

Two clocks matter, and they are tested separately:

- **Device clock** (`SYNC-11`, `SYNC-12`, `EDGE-07`): set on the device with automatic time
  disabled. At the unit layer, inject it rather than setting the system clock.
- **Server clock** (`SYNC-16`, `SYNC-17`): injected, and now actually injectable — closed GAP 8.
  The resolver is pure functions taking `now` as an argument (`clampClientUpdatedAt`, `wasClamped`,
  `tombstoneHorizon`), and `pruneTombstones(db, userId, now)` takes it too, so the 5-minute clamp
  and the 90-day horizon are both reachable in a unit test without waiting 90 days.

### Timezones

Every date-sensitive case runs under at least two device timezones, because the most likely date
bug in this app is a UTC round-trip (`06-expense-form.md` §Behaviour rule 7):

- `Pacific/Kiritimati` (UTC+14) — local day **ahead** of UTC
- `Pacific/Niue` (UTC−11) — local day **behind** UTC
- `Europe/London` — the control

A date case that passes only in the control timezone is a fail. Run the UTC+14 pass in the
morning and the UTC−11 pass in the evening local time, so the device's local date and the UTC date
genuinely differ.

---

## 3. Fixtures

Named starting states, built by helpers rather than by replaying UI steps, so a precondition is
reached identically every time.

| Fixture       | State it creates                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `F-FRESH`     | A signed-up user, `currency: USD`, the six `DEFAULT_CATEGORIES`, no expenses. The baseline                                 |
| `F-FRESH-JPY` | As `F-FRESH` but `currency: JPY` — the zero-decimal path. Used by `EDGE-03` and `EXP-12`                                   |
| `F-MONTH`     | `F-FRESH` plus 42 expenses in the current month across six categories, and 5 in the previous month                         |
| `F-TWO-DEV`   | One account authenticated as two independent clients `D1` and `D2`, each with its own SQLite store and its own sync cursor |
| `F-STALE`     | A client whose `since` cursor predates the 90-day tombstone horizon. Built by injecting the server clock, never by waiting |
| `F-SKEWED`    | A client whose device clock is set `+6h`. Used by `SYNC-11` and `SYNC-12`                                                  |
| `F-OTHER`     | A second, unrelated account with its own rows. Used by every tenancy case in §10                                           |
| `F-BIG-BATCH` | A client with 501 undrained outbox rows. Used by `SYNC-21`                                                                 |

Fixtures assert their own postconditions on build. A fixture that silently builds the wrong state
turns every case that uses it into a false green, which is worse than a fixture that fails loudly.

---

## 4. Auth

### AUTH-01 — Sign up creates an account and a usable session

- **Layer** API
- **Pre** No account for `sam@example.com`
- **Steps**
  1. `POST /v1/auth/signup` with `{ email: "sam@example.com", password: "correct-horse-battery", currency: "USD" }`
  2. `GET /v1/me` with `Authorization: Bearer <accessToken>` from step 1
- **Expect** Step 1 is `201`. Body matches `AuthResponse`: `user.id` is a UUID, `user.email` is
  `sam@example.com`, `user.currency` is `USD`, `accessTokenExpiresIn` is `3600`, and
  `refreshTokenExpiresAt` is ~60 days out. `X-Request-Id` is present. Step 2 is `200` and
  `user.id` equals the id from step 1.

### AUTH-02 — Email is normalised, so case and whitespace do not create a second account

- **Layer** API
- **Pre** `F-FRESH` for `sam@example.com`
- **Steps**
  1. `POST /v1/auth/signup` with email `"  SAM@Example.COM  "` and any valid password
  2. `POST /v1/auth/login` with email `"SAM@EXAMPLE.COM"` and the original password
- **Expect** Step 1 is `409` with `error.code = "email_already_exists"`. Step 2 is `200` and
  returns the same `user.id` as the fixture.

### AUTH-03 — Signup defaults currency to USD when omitted

- **Layer** API
- **Pre** No account for the test email
- **Steps** `POST /v1/auth/signup` with `{ email, password }` and **no** `currency` key
- **Expect** `201`, and `user.currency` is `"USD"` (`DEFAULT_CURRENCY`).

### AUTH-04 — Password length is enforced at both bounds

- **Layer** API
- **Pre** No account for the test emails
- **Steps**
  1. `POST /v1/auth/signup` with a 7-character password
  2. `POST /v1/auth/signup` with a 129-character password
  3. `POST /v1/auth/signup` with an 8-character password
  4. `POST /v1/auth/signup` with a 128-character password
- **Expect** Steps 1 and 2 are `400` with `error.code = "validation_error"` and
  `error.details.issues[].path` containing `password`. Steps 3 and 4 are `201`. The boundary is
  inclusive on both ends, matching `LIMITS.PASSWORD_MIN`/`PASSWORD_MAX`.

### AUTH-05 — Login does not reveal which half of the credential was wrong

- **Layer** API
- **Pre** `F-FRESH`
- **Steps**
  1. `POST /v1/auth/login` with the correct email and a wrong password
  2. `POST /v1/auth/login` with an email that has no account, and any password
- **Expect** Both are `401` with `error.code = "invalid_credentials"`. The two `error.message`
  strings are **byte-identical**, and neither body nor headers differ in any field other than
  `X-Request-Id`. An account cannot be enumerated from the response.

### AUTH-06 — Refresh rotates the pair and single-uses the old token

- **Layer** API
- **Pre** `F-FRESH`, holding refresh token `R1`
- **Steps**
  1. `POST /v1/auth/refresh` with `R1`. Call the result `R2`
  2. `POST /v1/auth/refresh` with `R1` again
  3. `POST /v1/auth/refresh` with `R2`
- **Expect** Step 1 is `200`, and `R2 !== R1`. Step 2 is `401` with
  `error.code = "token_invalid"` — a replayed, already-rotated token. Step 3 is `200`, proving
  step 2 did not revoke the whole chain, only the presented token.

### AUTH-07 — Logout is idempotent and forgiving

- **Layer** API
- **Pre** `F-FRESH`, holding refresh token `R1`
- **Steps**
  1. `POST /v1/auth/logout` with `R1`
  2. `POST /v1/auth/logout` with `R1` again
  3. `POST /v1/auth/logout` with `{ refreshToken: "v1.never-issued" }`
  4. `POST /v1/auth/refresh` with `R1`
  5. `POST /v1/auth/logout` with `{}`
- **Expect** Steps 1, 2 and 3 are all `204` with no body — logout must succeed from the client's
  point of view so the app can always clear local credentials. Step 4 is `401 token_invalid`.
  Step 5 is `400 validation_error`; only a malformed body is an error.

### AUTH-08 — Session survives an app restart

- **Layer** E2E
- **Pre** `F-MONTH`, logged in, app closed
- **Steps**
  1. Force-stop the app
  2. Relaunch it
- **Expect** The app opens on Home (`/(app)/(tabs)/index`), not on Welcome. The month total and
  the expense rows are rendered on the **first frame** after the splash — no spinner, no skeleton
  (`01-flows.md` §3 rule 2). The tokens were read from `expo-secure-store`.

### AUTH-09 — Being offline never logs the user out

- **Layer** E2E
- **Pre** `F-MONTH`, logged in. Aeroplane mode on
- **Steps**
  1. Force-stop and relaunch the app
  2. Pull to refresh on Home
  3. Leave the app in aeroplane mode for 70 minutes, so the 1h access token expires
  4. Relaunch again, still offline
- **Expect** At every point the app stays on Home with the user's data visible. The sync pill
  shows state 4 (`cloud-off` / `Offline`), grey, not red. The app never navigates to
  `/(auth)/welcome`. A failed request, a timeout and a DNS failure must all leave the session
  intact — only an actual `401 token_invalid` from a server we reached may clear it
  (`01-flows.md` §3 rule 1).

### AUTH-10 — An expired access token is refreshed transparently mid-action

- **Layer** E2E + Unit
- **Pre** `F-MONTH`, logged in, online. The stored access token is expired; the refresh token is
  valid
- **Steps**
  1. Add an expense, so a push is triggered
- **Expect** The push gets `401 token_expired`, the client calls `POST /v1/auth/refresh`, stores
  the rotated pair and **retries the push once**. The expense ends up `applied`. The user sees no
  banner, no re-login prompt and no error — the only visible artefact is the `pending` clock glyph
  clearing. Exactly one refresh call is made, not one per queued outbox row.

### AUTH-11 — An expired refresh token ends the session, with the right copy

- **Layer** E2E
- **Pre** `F-MONTH`, logged in, online. **Outbox empty.** The stored refresh token is past its
  60-day expiry
- **Steps**
  1. Relaunch the app
- **Expect** Home renders first from SQLite. In the background the refresh returns `401`
  (`token_expired` or `token_invalid`); the client clears `expo-secure-store` and **replaces** the
  stack with `/(auth)/welcome`. Welcome shows the `info.subtle` banner
  `Your session expired. Please log in again.` and announces it on mount. Android back from
  Welcome exits the app rather than returning to a dead Home (`03-auth.md` §1.1 rule 3).

### AUTH-12 — An expired refresh token with undrained local writes

- **Layer** E2E
- **Pre** `F-MONTH`, logged in. The refresh token is expired. **Three local expenses are in the
  outbox and have never reached the server**
- **Steps**
  1. Relaunch the app
  2. Log back in as the same user
- **Expect** `[BLOCKED-BY-GAP 4]` — the designs do not say whether a forced session clear wipes
  the local database and the outbox. Explicit logout does wipe, and warns first
  (`04-expense-list.md` §Behaviour rule 14); the forced path has only a banner. The two
  candidate outcomes are "three expenses silently destroyed" and "three expenses survive and
  push after re-login", and the difference is user data. Not executed until GAP 4 closes.

### AUTH-13 — Welcome shows no session banner on a genuine cold first launch

- **Layer** E2E
- **Pre** Fresh install, no tokens in secure store
- **Steps** Launch the app
- **Expect** Welcome renders with **no** session-expired banner. The user was not kicked out, they
  simply are not logged in, and claiming otherwise would be a lie (`03-auth.md` §1.1 rule 4). The
  banner is navigation-action state, not persisted.

### AUTH-14 — Signup is the only screen offline genuinely blocks

- **Layer** E2E
- **Pre** Fresh install. Aeroplane mode on
- **Steps**
  1. Welcome → `Create account`
  2. Fill in a valid email and password, tap `Create account`
- **Expect** A `danger.subtle` banner with a leading `alert-circle` 16 and the copy
  `You need to be online to create an account.` Submit returns to **enabled**. Both fields keep
  their typed values — in particular the password is not cleared (`03-auth.md` §1.2 rule 10). No
  sync pill is shown on this screen.

### AUTH-15 — `email_already_exists` offers the login path with the email carried over

- **Layer** E2E
- **Pre** `F-FRESH` for `sam@example.com`. Online
- **Steps**
  1. Sign up with `sam@example.com` and a valid password
  2. Tap `Log in instead`
- **Expect** Step 1 puts the Email field into its error state with the copy
  `That email is already registered.` and renders a `Log in instead` ghost link below the helper
  text with a ≥44pt target. Step 2 navigates to `/(auth)/login` with Email **prefilled** as
  `sam@example.com` and focus starting on Password.

### AUTH-16 — Login does not seed a second set of default categories

- **Layer** E2E
- **Pre** `F-FRESH` (six categories server-side). A second, clean install of the app
- **Steps**
  1. Log in on the clean install
  2. Wait for the first full pull to settle
  3. Open Settings → Categories
- **Expect** Exactly **six** categories, with the same six ids as the server holds. Seeding is a
  signup-only action (`03-auth.md` §1.3 rule 4); seeding on login would produce twelve.

### AUTH-17 — Signup seeds exactly six categories, exactly one of them default

- **Layer** E2E + API
- **Pre** No account
- **Steps**
  1. Sign up, online
  2. Let the outbox drain
  3. `GET /v1/categories`
  4. Open Settings → Categories in the app
- **Expect** Exactly **six** categories, never twelve. `GET /v1/categories` returns six rows, all
  with server-assigned ids, exactly one with `isDefault: true` and named `Uncategorized`. The app
  lists the same six, the default pinned last. No two share a name.
- **Why six and not twelve** `00-foundations.md` §7 rule 7 settles ownership: "The server writes
  these rows; the client never seeds." The client reads them on its first pull and treats them as
  ordinary synced data. The sync create path hard-codes `isDefault: false`
  (`backend/src/services/syncPushService.ts`), so a client cannot mint a second default even by
  accident — which is the invariant this case is really guarding.

---

## 5. Expense CRUD

### EXP-01 — Create an expense through the REST path

- **Layer** API
- **Pre** `F-FRESH`; `C1` is the id of the `Groceries` category
- **Steps** `POST /v1/expenses` with `{ categoryId: C1, amountMinor: 1234, currency: "USD", date: "2026-10-06", note: "Weekly shop" }`
- **Expect** `201`. Body matches `ExpenseResponse`. `data.amountMinor` is the integer `1234` (not
  `12.34`, not `"1234"`), `data.date` is exactly `"2026-10-06"`, `data.deletedAt` is `null`,
  `data.revision` is a positive integer, and `data.createdAt` equals `data.updatedAt`.

### EXP-02 — A client-minted id is accepted as-is

- **Layer** API
- **Pre** `F-FRESH`
- **Steps**
  1. `POST /v1/expenses` with an explicit UUIDv7 `id` of the client's choosing
  2. `POST /v1/expenses` with the **same** `id` again
- **Expect** Step 1 is `201` and `data.id` is byte-identical to the id sent — no remapping. Step 2
  is **also** `201`, carrying the row exactly as step 1 stored it: the retried body's fields are
  ignored rather than applied, and `revision` is unchanged from step 1. It is idempotent, not an
  upsert — a client whose response was dropped may retry safely, and a client that wants to change
  a field uses `PATCH`.
- **Also** Repeat step 2 with a **different** `amountMinor`. Still `201`, still the original
  amount and the original `revision`: the re-post is ignored, not merged.
- **Also** As a second user, `POST /v1/expenses` with the first user's `id`. `400
validation_error`, and the body names no owner — the id is the global primary key, so the server
  can neither honour the create nor admit whose row it is.

### EXP-03 — `currency` defaults to the user's currency and may not differ from it

- **Layer** API
- **Pre** `F-FRESH` (`USD`)
- **Steps**
  1. `POST /v1/expenses` omitting `currency`
  2. `POST /v1/expenses` with `currency: "EUR"`
  3. `POST /v1/expenses` with `currency: "usd"`
- **Expect** Step 1 is `201` with `data.currency = "USD"`. Step 2 is `400 validation_error` —
  there is no conversion in the MVP. Step 3 is `400 validation_error`: `CurrencyCode` requires
  three **uppercase** letters.

### EXP-04 — An unknown category is rejected as `422 unknown_category`

- **Layer** API
- **Pre** `F-FRESH`; `C_OTHER` is a category id belonging to `F-OTHER`; `C_DEL` is a category of
  this user that has been soft-deleted
- **Steps**
  1. `POST /v1/expenses` with a syntactically valid UUID that names no category
  2. `POST /v1/expenses` with `categoryId: C_OTHER`
  3. `POST /v1/expenses` with `categoryId: C_DEL`
- **Expect** All three are `422` with `error.code = "unknown_category"`. Step 2 in particular
  must not be `403` and must not succeed — a category of another user is not a live category of
  this one. Step 3 confirms "live" excludes tombstones.

### EXP-05 — PATCH is partial, and `note` can be cleared

- **Layer** API
- **Pre** `F-MONTH`; `E1` has `note: "Weekly shop"`, `amountMinor: 1234`
- **Steps**
  1. `PATCH /v1/expenses/E1` with `{ amountMinor: 1499 }`
  2. `PATCH /v1/expenses/E1` with `{ note: null }`
  3. `PATCH /v1/expenses/E1` with `{}`
- **Expect** Step 1 is `200`; `amountMinor` is `1499`, `note` is still `"Weekly shop"`, `date` and
  `categoryId` unchanged, and `updatedAt` and `revision` have both advanced. Step 2 is `200` with
  `note: null`. Step 3 is `400 validation_error` (`minProperties: 1`).

### EXP-06 — Delete is soft, returns the tombstone, and is idempotent

- **Layer** API
- **Pre** `F-MONTH`; `E1` is live
- **Steps**
  1. `DELETE /v1/expenses/E1`. Record `updatedAt` and `revision`
  2. `DELETE /v1/expenses/E1` again
  3. `GET /v1/expenses`
  4. `GET /v1/expenses?includeDeleted=true`
- **Expect** Step 1 is `200` **with a body** (not `204`); `data.deletedAt` is non-null. Step 2 is
  `200` and returns the **same** `updatedAt` and `revision` as step 1 — an idempotent re-delete
  does not advance either. Step 3 omits `E1`. Step 4 includes it with `deletedAt` set.
- **Also, a tombstone is `404` to every other REST verb** `GET /v1/expenses/E1` and
  `PATCH /v1/expenses/E1` are both `404 not_found` once `E1` is tombstoned — the same answer as a
  row that never existed and as another user's row (`API-01`). The reason is specific: no update
  schema declares `deletedAt`, so this path has no un-delete, and a `200` here would tell the
  client a deleted row was live again. Do the same against a tombstoned **category** with
  `PATCH /v1/categories/{id}`. `POST /v1/sync` is the only way a row comes back (`SYNC-31`).

### EXP-07 — The expense list is keyset-paginated and stable under a concurrent write

- **Layer** API
- **Pre** `F-MONTH` with 42 expenses in the current month
- **Steps**
  1. `GET /v1/expenses?limit=20`
  2. `POST /v1/expenses` creating a new expense dated **today**
  3. `GET /v1/expenses?limit=20&cursor=<nextCursor from step 1>`
  4. Continue until `hasMore` is false
- **Expect** Page 1 holds 20 rows ordered by `date` descending with ties broken by `id`
  descending, `hasMore: true`, `nextCursor` non-null. The row inserted in step 2 sorts above
  page 1's cursor and therefore **does not appear** on page 2 — and critically, no row from page 1
  is repeated on page 2 and none is skipped. Concatenating all pages yields each of the 42
  original ids **exactly once**. This is the property offset pagination would break.

### EXP-08 — `from`/`to` are inclusive bounds on the calendar date

- **Layer** API
- **Pre** `F-FRESH` plus expenses dated exactly `2026-09-30`, `2026-10-01`, `2026-10-31` and
  `2026-11-01`
- **Steps**
  1. `GET /v1/expenses?from=2026-10-01&to=2026-10-31`
  2. `GET /v1/expenses?from=2026-10-31&to=2026-10-01`
- **Expect** Step 1 returns exactly the `2026-10-01` and `2026-10-31` rows — both bounds
  inclusive — and neither neighbour. Step 2 is `400 validation_error`, because `to` is earlier
  than `from`.

### EXP-09 — A tampered cursor is `invalid_cursor`, not a server error

- **Layer** API
- **Pre** `F-MONTH`
- **Steps**
  1. `GET /v1/expenses?limit=5` and take `nextCursor`
  2. Re-request with the cursor truncated by three characters
  3. Re-request with `cursor=not-a-cursor`
- **Expect** Steps 2 and 3 are both `400` with `error.code = "invalid_cursor"`. Never `500`, and
  never a silently empty page — a silently empty page would look like "no more data" and the
  client would stop paginating.

### EXP-10 — Add an expense in the app: one transaction, instant total, no network wait

- **Layer** E2E
- **Pre** `F-MONTH`, online, on Home. Note the current month total
- **Steps**
  1. Tap the FAB
  2. Press `1`, `2`, `5`, `0` on the keypad
  3. Tap Category, choose `Groceries`
  4. Tap Save
- **Expect** The amount display reads `$12.50` after step 2, having passed through `$0.01`,
  `$0.12`, `$1.25`. Save is enabled only once the amount exceeds zero. On Save the screen pops to
  Home **immediately**, with no spinner and no awaiting of any request; the new row appears at the
  top of today's group; the month total has increased by exactly `$12.50` in the same render pass;
  and the snackbar reads `Expense saved.` The row carries the `pending` clock glyph until the push
  returns, then loses it with a cross-fade and **no success toast**.

### EXP-11 — Edit requires an actual change, and says so

- **Layer** E2E
- **Pre** `F-MONTH`, on Home
- **Steps**
  1. Tap an existing expense row
  2. Observe Save
  3. Change the amount by one digit
- **Expect** On entry Save is disabled with `accessibilityState={{ disabled: true }}` and the
  helper text at element 5 reads `Make a change to save.` — the reason is stated, not just the
  disablement. After step 3 Save is enabled. Saving shows the snackbar `Changes saved.`, not
  `Expense saved.`

### EXP-12 — The keypad has no decimal key on a zero-decimal currency

- **Layer** E2E
- **Pre** `F-FRESH-JPY`
- **Steps**
  1. Tap the FAB
  2. Inspect the keypad
  3. Press `1`, `2`, `5`
- **Expect** The decimal key is **hidden** (not disabled, not greyed) and the `0` key has expanded
  to fill its cell, so the grid is still 4×3 with no gap. The display reads `¥125`, not `¥1.25`.
  Decimals come from `Intl.NumberFormat(locale, { currency }).resolvedOptions()` and are not
  hardcoded to 2.

### EXP-13 — Swipe to delete, then undo

- **Layer** E2E
- **Pre** `F-MONTH`, on Home. Note the month total
- **Steps**
  1. Swipe a row leading-to-trailing past 50% of its width and release
  2. Tap `Undo` in the snackbar
- **Expect** After step 1 the row animates out, the total drops by that row's amount in the same
  render pass, and the snackbar reads `Expense deleted.` with an `Undo` action, visible 5s (10s
  with a screen reader active). There is **no confirmation dialog**. After step 2 the row returns
  to its original position, the total returns to its original value, and
  `Expense restored.` is announced. The underlying row has `deletedAt` set then `null` again, with
  one outbox entry appended for each transition.

### EXP-14 — Undo still works after the delete has already synced

- **Layer** E2E
- **Pre** `F-MONTH`, online and syncing promptly
- **Steps**
  1. Delete a row
  2. Wait for the sync pill to go idle, confirming the delete reached the server
  3. Tap `Undo` (still within the snackbar window)
- **Expect** The undo succeeds and is treated as an ordinary update: `deletedAt` is set back to
  `null`, a second outbox row is appended, and the push returns `applied`. The row reappears. An
  undelete is a normal write in this protocol, so there is no race to lose
  (`04-expense-list.md` §Behaviour rule 9).

### EXP-15 — Deleting a second expense while a snackbar is up

- **Layer** E2E
- **Pre** `F-MONTH`, on Home
- **Steps**
  1. Delete row `A`
  2. Within the 5s window, delete row `B`
  3. Tap `Undo`
- **Expect** The second delete **replaces** the snackbar. Undo restores `B` only; `A`'s delete
  stands. Undo applies solely to the delete the visible snackbar refers to.

### EXP-16 — The row is a single accessibility element with a composed label

- **Layer** Manual
- **Pre** `F-MONTH` with a pending row that has a note. VoiceOver or TalkBack on
- **Steps** Swipe element to element through the list
- **Expect** One swipe per expense, not four. The label reads in order
  `{category}, {formatted amount}, {note}, {date}` with `, not synced yet` appended for the
  pending row — e.g. `Groceries, $12.50, Milk and eggs, Today, not synced yet`. The hint is
  `Double tap to edit this expense.` A `delete` accessibility action named `Delete expense` is
  exposed, so the swipe gesture is not the only route to delete.

---

## 6. Category management

### CAT-01 — The list is alphabetical with the default pinned last

- **Layer** E2E
- **Pre** `F-FRESH`
- **Steps** Settings → Categories
- **Expect** Rows read `Bills`, `Eating out`, `Groceries`, `Health`, `Transport`, then
  `Uncategorized` last — alphabetical case-insensitively, with the `isDefault` row pinned last
  regardless of where its name would otherwise sort. Each row shows an all-time expense count, and
  a count of zero renders as `0`, never as blank or `—`.

### CAT-02 — Names are unique per user among live categories, case-insensitively

- **Layer** API
- **Pre** `F-FRESH` (holds `Groceries`)
- **Steps**
  1. `POST /v1/categories` with `{ name: "groceries" }`
  2. `POST /v1/categories` with `{ name: "  Groceries  " }`
  3. `DELETE` the `Groceries` category, then `POST /v1/categories` with `{ name: "Groceries" }`
- **Expect** Steps 1 and 2 are `409` with `error.code = "category_name_taken"` — comparison is
  case-insensitive and applies after trimming. Step 3 is `201`: uniqueness is among **live** rows
  only, so a name freed by a delete may be reused.

### CAT-03 — A rename does not touch any expense

- **Layer** API
- **Pre** `F-MONTH`; `C1` is `Groceries` with 7 expenses
- **Steps**
  1. Record every expense's `revision` and `categoryId`
  2. `PATCH /v1/categories/C1` with `{ name: "Food" }`
  3. Re-read the expenses
- **Expect** Step 2 is `200` with `data.name = "Food"` and an advanced `revision`. In step 3 every
  expense still has `categoryId = C1` and an **unchanged** `revision` — expenses reference the id,
  so a rename is invisible to them and must not bump them onto the next sync page.

### CAT-04 — Renaming to its own current name is not a self-conflict

- **Layer** API
- **Pre** `F-FRESH`
- **Steps** `PATCH /v1/categories/<Groceries>` with `{ name: "Groceries", color: "#2F6FD0" }`
- **Expect** `200`, not `409`. Uniqueness excludes the row being edited.

### CAT-05 — Deleting a category reassigns its expenses rather than deleting them

- **Layer** API
- **Pre** `F-MONTH`; `C1` (`Groceries`) has exactly 7 live expenses and 1 tombstoned one; `C0` is
  the `isDefault` category
- **Steps**
  1. `DELETE /v1/categories/C1`
  2. `GET /v1/expenses?limit=200`
  3. `GET /v1/expenses?categoryId=C1&includeDeleted=true`
- **Expect** Step 1 is `200` with `data.deletedAt` set. In step 2 all **7** formerly-`C1`
  expenses are present, live, with `categoryId = C0`, and each has an advanced `updatedAt` and
  `revision`. The total expense count is unchanged — nothing was deleted. The previously
  tombstoned expense stays tombstoned. Losing spend history here would be a data-loss bug, so a
  count that drops by 7 is a P1, not a cosmetic failure.

### CAT-06 — Reassigned expenses arrive on the next pull

- **Layer** API
- **Pre** `F-MONTH`. Pull to a current cursor `V`
- **Steps**
  1. `DELETE /v1/categories/<Groceries>`
  2. `GET /v1/sync?since=V`
- **Expect** The page contains the category tombstone **and** one change per reassigned expense,
  each carrying `categoryId` equal to the `isDefault` id, all ordered by `revision` ascending. A
  client that only patched the category locally and did not re-pull would be left with expenses
  pointing at a deleted category, which is why the reassignments must be on the wire.

### CAT-07 — The default category cannot be deleted

- **Layer** API
- **Pre** `F-FRESH`; `C0` is the `isDefault` category
- **Steps** `DELETE /v1/categories/C0`
- **Expect** `409` with `error.code = "category_not_deletable"`. `C0` is still live on a
  subsequent `GET /v1/categories`.

### CAT-08 — The default category can be renamed, and the fallback is still resolved correctly

- **Layer** API + E2E
- **Pre** `F-MONTH`; `C0` is `isDefault`
- **Steps**
  1. `PATCH /v1/categories/C0` with `{ name: "Misc" }`
  2. `DELETE /v1/categories/<Groceries>`
  3. In the app, open the delete dialog for another non-default category
- **Expect** Step 1 is `200` — rename is not blocked, only delete is. Step 2 still reassigns to
  `C0`, because the target is resolved by the `isDefault` **flag** and never by matching the
  string "Uncategorized". In step 3 the dialog body reads `… will move to Misc. …`, with the
  fallback name interpolated from the `isDefault` row.

### CAT-09 — The delete dialog states the exact, all-time, local count

- **Layer** E2E
- **Pre** `F-MONTH`; `Groceries` has 23 live expenses spread across three different months, plus
  2 tombstoned ones. Home is showing a month in which `Groceries` has only 4 expenses
- **Steps**
  1. Settings → Categories, swipe the `Groceries` row, tap Delete
- **Expect** The dialog title is `Delete Groceries?` and the body is
  `Its 23 expenses will move to Uncategorized. They won't be deleted.` — **23**, not 4: the count
  is all-time, not scoped to the month on screen. Tombstoned expenses are excluded. The confirm
  button reads `Delete category`, not `Delete`, and sits **above** `Cancel`.

### CAT-10 — Singular and zero variants of the delete dialog and its snackbar

- **Layer** E2E
- **Pre** `F-MONTH`; `Transport` has exactly 1 expense; `Health` has 0
- **Steps**
  1. Open the delete dialog for `Transport`, confirm
  2. Open the delete dialog for `Health`, confirm
- **Expect** Step 1's body reads `Its 1 expense will move to Uncategorized. It won't be deleted.`
  (singular noun **and** singular pronoun) and its snackbar reads
  `Transport deleted. 1 expense moved to Uncategorized.` Step 2's body reads
  `It has no expenses.` and its snackbar reads `Health deleted.` with no second sentence. No
  string anywhere reads `1 expenses`.

### CAT-11 — Cancel, scrim and Android back all leave the category alone

- **Layer** E2E
- **Pre** `F-MONTH`
- **Steps** Open the delete dialog for `Groceries` three times, dismissing by `Cancel`, then by
  tapping the scrim, then with Android back
- **Expect** In all three cases the category is still live, its expenses still reference it, and
  **no outbox row was appended**. The destructive path is reachable only by the explicit
  `Delete category` button.

### CAT-12 — The default category offers no delete affordance at all

- **Layer** E2E + Manual
- **Pre** `F-FRESH`
- **Steps**
  1. Swipe the `Uncategorized` row in Categories
  2. Tap the row to open its edit sheet
  3. With a screen reader on, enumerate the row's accessibility actions
- **Expect** Step 1 reveals **nothing** — the row has no swipe action, rather than revealing a
  Delete that would always fail. Step 2's sheet has no `Delete category` button, and its colour
  picker is a single non-interactive swatch with the caption `This colour is reserved.` Step 3
  exposes no `delete` action. If delete is somehow reached, the snackbar reads
  `Uncategorized can't be deleted. It's where expenses go when you delete a category.`

### CAT-13 — Category create and rename work fully offline

- **Layer** E2E
- **Pre** `F-FRESH`. Aeroplane mode on
- **Steps**
  1. Categories → FAB, name it `Coffee`, pick a colour, tap `Create`
  2. Tap `Groceries`, rename it to `Food`, Save
  3. Swipe `Health`, confirm delete
- **Expect** All three succeed locally and immediately. The sheet dismisses, the snackbars read
  `Coffee created.`, `Food updated.` and `Health deleted.`, and each affected row shows the
  `clock` 14 `warning.default` glyph. Nothing is disabled, no banner covers the list, and no
  error appears. The sheet itself shows **no** unsynced indicator — that belongs on the row behind
  it.

### CAT-14 — Local name uniqueness is enforced offline too

- **Layer** E2E
- **Pre** `F-FRESH`. Aeroplane mode on
- **Steps** Categories → FAB, type `groceries`, blur the field
- **Expect** The Name field enters its error state with `You already have a category called "groceries".`
  and `Create` is disabled. The check runs against local SQLite, so it is correct offline. A name
  matching a **deleted** category is accepted.

---

## 7. Monthly totals and chart

### SUM-01 — The total is a SQL sum in minor units, not a sum over rendered rows

- **Layer** Unit + E2E
- **Pre** `F-MONTH` with 142 expenses in the current month, so the list paginates past one page
- **Steps**
  1. Read the displayed month total on Home without scrolling
  2. Compute the expected total as `SUM(amountMinor)` over all live expenses in the month
- **Expect** The two agree exactly. The total is computed by
  `SELECT SUM(amountMinor) WHERE date BETWEEN ? AND ? AND deletedAt IS NULL`, summed as an
  integer and formatted once. A total that matches only the first 50 rows is the specific bug this
  case exists to catch.

### SUM-02 — Month bounds are string comparisons and do not shift across timezones

- **Layer** Unit + E2E
- **Pre** `F-FRESH` plus expenses dated exactly `2026-09-30`, `2026-10-01`, `2026-10-31`,
  `2026-11-01`, each `amountMinor: 100`
- **Steps** With the device in `Pacific/Kiritimati` (UTC+14), then in `Pacific/Niue` (UTC−11),
  view October 2026 on Home
- **Expect** In **both** timezones the total is `$2.00` and exactly the `2026-10-01` and
  `2026-10-31` rows are listed. The bounds are the inclusive `YYYY-MM-DD` string pair
  `["2026-10-01", "2026-10-31"]` compared as strings; no `Date` arithmetic is involved, so no
  expense can change month because of where the device is.

### SUM-03 — Expenses group under their calendar date, not their creation date

- **Layer** E2E
- **Pre** `F-FRESH`. Today is `2026-10-06`
- **Steps**
  1. Add an expense and set its date to `2026-09-29` via `Choose a date…`
  2. Return to Home and switch to September 2026
- **Expect** The row appears under the `Tue 29 Sep` section header, not under `Today`. Grouping
  uses the raw `date` string and never `createdAt`. Section headers read `Today` and `Yesterday`
  for those two days and `EEE d MMM` otherwise, sentence case; a date in another calendar year
  gets `EEE d MMM yyyy`.

### SUM-04 — Saving into another month tells the user where it went

- **Layer** E2E
- **Pre** `F-MONTH`, Home showing October 2026
- **Steps**
  1. Add an expense dated `2026-09-15`, Save
  2. Tap `View` in the snackbar
- **Expect** Home pops back still showing October, and the new row is **not** in the list — which
  is why the snackbar reads `Expense saved to September 2026.` rather than the plain
  `Expense saved.` Step 2 switches Home to September 2026, where the row is present. A same-month
  save keeps the plain copy.

### SUM-05 — A month with no expenses

- **Layer** E2E
- **Pre** `F-MONTH` (current month populated, nothing in August 2026)
- **Steps** Step the month switcher back to August 2026 on both tabs
- **Expect** On Home: headline `Nothing in August`, body
  `You have no expenses recorded for this month.`, a `ghost` button `Go to October 2026`, **no**
  illustration and **no** primary Add button — and the total still renders as `$0.00`, not as `—`
  or a blank. On Summary: headline `Nothing to summarise`, body
  `Add an expense this month and you will see where your money went.`, total `$0.00` with
  `0 expenses`, and **no donut drawn at all**. A zero-value ring must never be rendered; it reads
  as a loading state.

### SUM-06 — First-run empty is distinguishable from filtered-empty

- **Layer** E2E
- **Pre** `F-FRESH` — no expenses anywhere
- **Steps** Open Home
- **Expect** The first-run empty state: `pie-chart` 48 illustration, headline `No expenses yet`,
  body `Add your first expense and it will show up here, with your monthly total.`, and a primary
  `Add your first expense` button. The total renders `$0.00`. This is deliberately different copy
  from `SUM-05`; showing `Nothing in October` to a brand-new user, or the teaching copy to an
  established one, are both failures.

### SUM-07 — The total, the chart, the legend and the count cannot disagree

- **Layer** E2E
- **Pre** `F-MONTH`
- **Steps**
  1. Read the Summary total, the expense count and every legend row amount
  2. Sum the legend amounts
- **Expect** The legend amounts sum exactly to the displayed total, and the count equals the
  number of live expenses in the month. All four figures come from one `GROUP BY`, so a
  discrepancy of even one cent means they are being computed in more than one place.

### SUM-08 — Percentages round for display only, and never read as 0%

- **Layer** Unit
- **Pre** A month total of `10000` minor units with category totals
  `[5000, 3000, 1900, 99, 1]`
- **Steps** Compute the legend rows
- **Expect** Labels are `50%`, `30%`, `19%`, `1%` and `<1%`. The `1` minor unit category — a real,
  non-zero amount that rounds to 0 — displays `<1%`, never `0%`. The displayed percentages are
  allowed to not sum to 100, and the screen must **not** adjust the largest slice to force them
  to; no "100%" figure is displayed anywhere, so no visible contradiction arises. Slice **angles**
  use the exact ratio, not the rounded label.

### SUM-09 — A category with zero spend is absent from the chart and the legend

- **Layer** E2E
- **Pre** `F-MONTH` where `Health` has no expenses this month
- **Steps** Open Summary, then Settings → Categories
- **Expect** `Health` has no slice and no legend row — a `$0.00 / 0%` row is noise. It is still
  listed in Categories with a count, which is where "all my categories" is answered.

### SUM-10 — The legend drills down; the chart does not

- **Layer** E2E + Manual
- **Pre** `F-MONTH`
- **Steps**
  1. Tap the `Groceries` legend row
  2. Tap the donut itself
  3. With a screen reader on, swipe through the Summary screen
- **Expect** Step 1 navigates to the Expenses tab for the **same month**, filtered to `Groceries`,
  with a dismissible chip reading `Groceries` and a trailing `x` in the month-switcher row. Step 2
  does nothing: no tooltip, no selection, no animation. Step 3 skips the chart entirely
  (`accessibilityElementsHidden`) and reads each legend row as one element, e.g.
  `Housing, $520.00, 40 percent of the month`; the `<1%` row reads
  `less than 1 percent of the month`.

### SUM-11 — The month is shared between the two tabs

- **Layer** E2E
- **Pre** `F-MONTH`
- **Steps**
  1. On Home, step back to September 2026
  2. Switch to the Summary tab
  3. On Summary, step forward to October 2026
  4. Switch back to Home
- **Expect** Summary shows September in step 2 and Home shows October in step 4. The two tabs can
  never display different months while both label their figure "this month".

### SUM-12 — The month resets to the current month on cold start but survives backgrounding

- **Layer** E2E
- **Pre** `F-MONTH`
- **Steps**
  1. Step back to June 2026
  2. Background the app, wait 30s, foreground it
  3. Force-stop the app and relaunch
- **Expect** Step 2 still shows June — the selection holds within a session. Step 3 shows the
  current month. The selection is session state and is not persisted.

### SUM-13 — The switcher will not navigate into the future, and says why

- **Layer** E2E + Manual
- **Pre** `F-MONTH`, Home showing the current month
- **Steps**
  1. Tap the `>` arrow
  2. Open the month picker sheet and inspect the cells after the current month
- **Expect** Step 1 does not change the month and shows the snackbar `This is the current month.`
  — not a silent no-op. The arrow keeps `accessibilityState={{ disabled: true }}`. Future cells in
  the grid are visibly disabled rather than hidden, so the grid keeps a stable 3×4 shape. Stepping
  **back** has no lower bound: January 2026 → December 2025 works, as does stepping to before the
  account existed.

### SUM-14 — The total updates optimistically and is announced

- **Layer** E2E + Manual
- **Pre** `F-MONTH`, screen reader on
- **Steps** Add an expense of `$5.00`, then delete it
- **Expect** The total changes in the **same render pass** as the row appearing and disappearing —
  it is never briefly stale. It is one accessibility element, labelled as money, with
  `accessibilityLiveRegion="polite"`, so the new figure is announced without focus being stolen.

---

## 8. Offline and sync

This is where the real risk is, so it is the longest section and the only one whose cases are
individually traced back to a protocol rule in `docs/PLAN.md` §4 and the
`POST /v1/sync` description. Every case states which rule it defends.

Vocabulary used below, from `02-offline-and-sync.md` §2–3: a row is **`pending`** if an undrained
outbox row references its id; the **sync pill** has the six states in §3; **`needs-attention`** is
a row whose push returned `invalid`.

### 8.1 Writes made offline reach the server

Defends: "full read/write offline", and the outbox being written in the same transaction as the
row.

### SYNC-01 — Create offline, reconnect, the expense is on the server

- **Layer** E2E
- **Pre** `F-FRESH`, logged in, outbox empty. Aeroplane mode **on**
- **Steps**
  1. Add an expense `$12.50 / Groceries / today / note "Milk"`, Save
  2. Confirm Home shows the row with the `clock` glyph and the pill reads `Offline · 1 pending`
  3. Turn aeroplane mode **off**
  4. Wait for the pill to render nothing
  5. `GET /v1/sync?since=0` with a separate API client
- **Expect** Step 1 never waits on the network and never shows an error. Step 5 returns an
  `expense` change whose `id` is the **client-minted UUIDv7** from the local row (no remapping),
  `amountMinor: 1250`, `currency: "USD"`, the correct `date` string, `note: "Milk"`, and
  `deletedAt: null`. On the device the `clock` glyph has gone with a cross-fade and **no success
  toast** was shown. The pill passed through state 5 → 2 → 1.

### SYNC-02 — Edit offline, reconnect, the edit reached the server

- **Layer** E2E
- **Pre** `F-MONTH`, synced, outbox empty. Aeroplane mode on
- **Steps**
  1. Open an existing expense, change the amount from `$12.50` to `$18.00` and the category to
     `Transport`, Save
  2. Reconnect, wait for the pill to clear
  3. `GET /v1/sync?since=<cursor before step 1>`
- **Expect** The server row has `amountMinor: 1800` and the `Transport` `categoryId`, with an
  advanced `revision`, and its `updatedAt` equals the client's edit time (clamped only if skewed).
  The expense's `id` and `createdAt` are unchanged.

### SYNC-03 — Delete offline, reconnect, the delete reached the server

- **Layer** E2E
- **Pre** `F-MONTH`, synced. Aeroplane mode on
- **Steps**
  1. Swipe-delete a row, let the snackbar time out
  2. Reconnect, wait for the pill to clear
  3. `GET /v1/expenses` and `GET /v1/expenses?includeDeleted=true`
- **Expect** The row is absent from the plain list and present with a non-null `deletedAt` in the
  `includeDeleted` list. It was a **soft** delete; a hard delete cannot cross this protocol. The
  deleted-but-unsynced row was absent from the local list in step 1 too, exactly as a synced
  delete would be.

### SYNC-04 — Editing a pending row coalesces instead of queueing twice

- **Layer** E2E + Unit
- **Pre** `F-FRESH`. Aeroplane mode on
- **Steps**
  1. Add an expense
  2. Edit its amount, Save
  3. Edit its note, Save
  4. Tap the sync pill
  5. Reconnect
- **Expect** The pill reads `Offline · 1 pending` throughout, not `3 pending` — `{n}` counts
  distinct records, not outbox rows. The sheet's section header reads `1 change waiting`
  (singular, never `1 changes`). On reconnect the server ends up with the **final** amount and
  note. The row remained fully editable while pending: `pending` is never a blocker.

### SYNC-05 — A full offline session of mixed writes drains in one round trip

- **Layer** E2E
- **Pre** `F-MONTH`, synced. Aeroplane mode on
- **Steps**
  1. Add 4 expenses, edit 2 existing ones, delete 1, create a category and rename another
  2. Reconnect and capture the HTTP traffic
- **Expect** Exactly **one** `POST /v1/sync` carries all nine changes, with every `category` item
  ahead of every `expense` item. Every result is `applied`. The pill goes idle and every `clock`
  glyph clears. `docs/PLAN.md` §Non-functional targets requires a day's changes to sync in a
  single round trip, so two or more pushes here is a fail even though the data would be correct.

### 8.2 The same row edited on two devices

Defends: last-write-wins on `updatedAt`, ties to the server, and "every result carries the
authoritative server row, including on conflict".

### SYNC-06 — Two devices edit the same expense offline; the newer `updatedAt` wins

- **Layer** E2E
- **Pre** `F-TWO-DEV`. Both devices hold expense `E1` at `amountMinor: 1000`, both synced, both
  then put into aeroplane mode. Both device clocks are correct
- **Steps**
  1. On `D1` at local time `T`, edit `E1` to `amountMinor: 1100`
  2. On `D2` at local time `T + 10 min`, edit `E1` to `amountMinor: 2200` and the note to `"D2"`
  3. Reconnect `D1`; wait for its pill to go idle
  4. Reconnect `D2`; wait for its pill to go idle
  5. Let `D1` pull
- **Expect** Step 3: `D1`'s push returns `applied`; the server holds `1100`. Step 4: `D2`'s push
  returns `applied` too, because its `updatedAt` is strictly newer; the server holds `2200` with
  note `"D2"`. Step 5: `D1` pulls the row and **its local copy is overwritten with the server
  row** — `D1` now shows `$22.00` and the note `"D2"`, and `D1`'s own `$11.00` is gone. The user
  on `D1` is **not** notified: there is no toast, no banner and no dialog about the overwrite.
  Both devices show identical values at the end. Divergence between the two devices is the
  failure, and so is any user-facing conflict notice.

### SYNC-07 — The loser of a conflict is overwritten with the server row

- **Layer** API
- **Pre** `F-MONTH`. Expense `E1` on the server has `updatedAt = 2026-10-06T14:30:00Z` and
  `amountMinor: 900`
- **Steps** `POST /v1/sync` with one item for `E1`, `updatedAt: 2026-10-06T13:05:00Z`,
  `fields: { amountMinor: 450 }`, a fresh `clientMutationId`
- **Expect** `200`. The single result has `status: "conflict_server_wins"`,
  `idempotentReplay: false`, `error: null`, and **`record` is non-null and holds the
  authoritative server row** — `amountMinor: 900`, `updatedAt: 2026-10-06T14:30:00Z`, the server's
  `revision`. The server's stored row is unchanged. A `conflict_server_wins` with
  `record: null` is a fail: the client would have nothing to converge on.

### SYNC-08 — An equal `updatedAt` is a conflict, not an apply

- **Layer** API + Unit
- **Pre** `F-MONTH`. `E1` on the server has `updatedAt = T` exactly
- **Steps** Push `E1` with `updatedAt: T` and a different `amountMinor`
- **Expect** `status: "conflict_server_wins"`. Ties go to the server, which is what makes the
  outcome deterministic regardless of request arrival order. An `applied` here means the resolver
  is using `>=` where it needs `>`, and two devices pushing identical timestamps would then
  diverge based on who arrived first.

### 8.3 Idempotency — a retried push must not double-apply

Defends: `clientMutationId`. `docs/PLAN.md` §Idempotency calls a double-apply "the single most
common offline-sync bug", so these cases get the proxy harness from §2 rather than aeroplane mode.

### SYNC-09 — A byte-identical retry replays the original result

- **Layer** API
- **Pre** `F-FRESH`. Expense `E1` does not exist server-side
- **Steps**
  1. `POST /v1/sync` with one item: `{ entity: "expense", id: E1, updatedAt: T, clientMutationId: M, fields: {...} }`. Record the response and `serverRevision`
  2. Send the **byte-identical** request again
  3. `GET /v1/sync?since=0`
- **Expect** Step 1: `status: "applied"`, `idempotentReplay: false`. Step 2: `200`,
  `status: "applied"`, **`idempotentReplay: true`**, and a `record` identical to step 1's
  including the same `revision` — the row was not rewritten. `serverRevision` is the same in both
  responses. Step 3 lists `E1` **exactly once**. Two rows, or a bumped `revision`, is the
  double-apply bug.

### SYNC-10 — A retry after a dropped response does not double-apply

- **Layer** E2E
- **Pre** `F-FRESH`, online through the response-dropping proxy of §2
- **Steps**
  1. Add an expense; the proxy forwards the push and drops the response
  2. Confirm the client still shows the row as `pending` and the pill as `Sync failed` or
     `1 pending`
  3. Remove the proxy and let the client retry
  4. `GET /v1/sync?since=0`
- **Expect** The retry reuses the **same** `clientMutationId` as the original mutation. The server
  returns `applied` with `idempotentReplay: true`. Step 4 shows exactly **one** expense with that
  id, with the same `revision` the first (unheard) call assigned. Two expenses, or one expense at
  a bumped revision, is a P1. This case is the reason the proxy exists: aeroplane mode produces a
  request the server never saw, which does not exercise idempotency at all.

### SYNC-11 — A reused mutation id with a changed payload is rejected, loudly

- **Layer** API
- **Pre** `F-FRESH`
- **Steps**
  1. Push `E1` with `clientMutationId: M` and `amountMinor: 450`
  2. Push `E1` with the **same** `M` but `amountMinor: 999`
- **Expect** Step 2 returns `status: "invalid"` with `error.code = "mutation_id_reused"`. The
  stored row still has `amountMinor: 450`. It is not silently accepted and not silently replayed:
  a reused id with a different payload means the client lost track of its outbox, and hiding that
  hides the bug.

### SYNC-12 — Idempotency is scoped per user

- **Layer** API
- **Pre** `F-FRESH` and `F-OTHER`
- **Steps**
  1. As user A, push a category with `clientMutationId: M`
  2. As user B, push a **different** category with the same `M`
- **Expect** Both are `applied` with `idempotentReplay: false`. `clientMutationId` is unique per
  user, so one user's ids can never collide with another's.

### SYNC-13 — How long a mutation id is remembered

- **Layer** API
- **Pre** `F-FRESH`
- **Steps** Push with `clientMutationId: M`; advance the injected server clock; push `M` again
- **Expect** `[BLOCKED-BY-GAP 3]` — still open, and now concrete rather than theoretical. The
  ledger exists (`sync_mutations`, with a `created_at`), but **nothing prunes it**:
  `pruneTombstones` deletes only from `expenses` and `categories`, and no other code path deletes
  a `sync_mutations` row. So today the answer is "forever", which is correct for de-duplication
  and wrong for a table that takes one row per mutation per user with no ceiling.
- **What to assert once it closes** The boundary in both directions: a push one tick inside the
  window replays the recorded outcome, one tick outside is processed as new. Until a window is
  stated, `SYNC-09`–`SYNC-12` cover the part that matters for correctness (a retry inside any
  plausible window never double-applies) and this case covers only the part that needs a number.
  Not executed until GAP 3 closes.

### 8.4 Deletes must not come back

Defends: soft deletes, tombstones, and the 90-day horizon.

### SYNC-14 — A delete made offline is not resurrected by a later pull

- **Layer** E2E
- **Pre** `F-TWO-DEV`. Both devices hold expense `E1`, both synced
- **Steps**
  1. Put `D1` in aeroplane mode; swipe-delete `E1`; let the snackbar time out
  2. While `D1` is still offline, on `D2` **edit** an unrelated expense so the server's revision
     advances
  3. Reconnect `D1`; let it push and then pull
  4. Reopen `D1` and inspect the list, and the month total
- **Expect** `E1` is absent from `D1`'s list after step 4 and the total excludes it. `D1`'s pull
  must not re-create `E1` from any earlier state. The local row still exists with `deletedAt` set
  — the tombstone is what prevents the next pull from treating `E1` as "never seen" and writing it
  back. A resurrected expense here is a P1.

### SYNC-15 — A tombstone pulled from a peer removes the row locally

- **Layer** E2E
- **Pre** `F-TWO-DEV`, both synced, both holding `E1`
- **Steps**
  1. On `D2`, delete `E1` and let it sync
  2. On `D1`, pull
- **Expect** `D1` receives an `expense` change for `E1` with `deletedAt` set, hides the row, and
  **excludes it from the month total in the same render pass**. A row that disappears from the
  list but is still counted in the total is the specific bug this case catches.

### SYNC-16 — A stale cursor triggers a resync rather than resurrecting rows

- **Layer** API
- **Pre** `F-STALE` — a cursor older than the 90-day tombstone horizon, built by injecting the
  server clock
- **Steps**
  1. `GET /v1/sync?since=<stale cursor>`
  2. `GET /v1/sync?since=<serverRevision + 1000>`
- **Expect** Both return `200` with `resyncRequired: true`, `changes: []`, `nextCursor: 0` and
  `hasMore: false`. Step 2 covers the restore-from-backup case, where the client holds a watermark
  from a database that no longer exists. Neither returns an incremental page, which would risk
  resurrecting pruned rows.

### SYNC-17 — The resync screen, and the precondition that protects local work

- **Layer** E2E
- **Pre** `F-STALE` on a device with 3 undrained outbox rows
- **Steps**
  1. Open the app, online
  2. Let the sync run
- **Expect** The client **pushes the outbox first and only then wipes**. If the push cannot
  complete it does **not** wipe: it stays on the normal UI with the pill in state 6
  (`Sync failed`) and retries later. A stale-but-intact local database is strictly better than a
  clean one missing the user's work, so a wipe that loses the three rows is a P1. When the wipe
  does proceed it is the app's one full-screen blocking state: centred `refresh-cw`, headline
  `Catching up`, body
  `You have not used the app in a while, so we are refreshing your expenses from scratch. This only takes a moment.`,
  a progress bar, not dismissible, tab bar replaced, announced on appear and on completion. The
  copy contains none of the words "resync", "cursor", "horizon" or "wiped".

### 8.5 Clock skew

Defends: the server's `now + 5 minutes` clamp.

### SYNC-18 — A device hours ahead does not permanently win conflicts

- **Layer** E2E
- **Pre** `F-TWO-DEV`. `D1` is `F-SKEWED` (clock `+6h`); `D2`'s clock is correct. Both hold `E1`
  at `amountMinor: 1000`
- **Steps**
  1. On `D1`, edit `E1` to `1100`; let it push
  2. Immediately after, on `D2`, edit `E1` to `2200`; let it push
  3. `GET /v1/sync?since=0` and read `E1`'s `updatedAt`
  4. On `D1`, pull
- **Expect** In step 1 the server **clamps** `D1`'s `updatedAt` to no more than its own
  `now + 5 min` before storing it, so step 3 shows an `updatedAt` within 5 minutes of real time,
  **not** six hours in the future. Step 2 therefore returns `applied` and the server holds `2200`.
  Step 4 overwrites `D1`'s local row with `2200`. Without the clamp, `D1` would hold a
  `+6h` `updatedAt` and win every conflict on this row for the next six hours, making the row
  unfixable from any other device — that is the failure mode, and it is permanent-feeling to a
  user.

### SYNC-19 — A clamped push can legitimately come back as a conflict

- **Layer** API
- **Pre** `F-MONTH`. Server row `E1` has `updatedAt = now + 2 min` (itself previously clamped)
- **Steps** Push `E1` with `updatedAt = now + 6h` (a skewed client) and a new value
- **Expect** The incoming `updatedAt` is clamped to `now + 5 min`, which is still newer than
  `now + 2 min`, so the result is `applied`. Repeat with a server row at `now + 5 min`: the
  clamped incoming value is then **equal**, so the result is `conflict_server_wins` even though
  the raw `updatedAt` looked newer. In both cases the returned `record` is the truth and the
  client takes it verbatim.

### SYNC-20 — A device hours behind is not silently ignored forever

- **Layer** API
- **Pre** `F-MONTH`
- **Steps** Push `E1` with `updatedAt` set 48 hours in the past, against a server row written
  today
- **Expect** `status: "conflict_server_wins"`, and the client overwrites its local row from the
  response — so a user on a badly-behind device loses that edit with no notice, because
  `02-offline-and-sync.md` §5.2 deliberately does not notify on `conflict_server_wins`.
- **Why this is a test and not a bug** The asymmetry is now recorded as a decision on
  `clampClientUpdatedAt` (`backend/src/sync/resolver.ts`): "Only the future is clamped. A clock
  that is _behind_ loses conflicts it should have won, which costs the user an edit — annoying,
  recoverable, and not something the server can distinguish from a genuinely older edit anyway."
  A lower clamp would break legitimate offline editing, where an `updatedAt` from last Tuesday is
  exactly correct. Settled; closed GAP 6.
- **Also** Confirm the stored row's `updatedAt` is untouched by the losing push, and that no
  `revision` was consumed — a conflict must not cost a sync page.

### 8.6 Dependency ordering

Defends: "categories, then expenses", one round trip.

### SYNC-21 — A category and an expense assigned to it, both created offline, sync together

- **Layer** E2E
- **Pre** `F-FRESH`, synced. Aeroplane mode **on**
- **Steps**
  1. Add an expense; in the category picker tap `New category`, create `Coffee`, which is
     auto-selected; set the amount and Save
  2. Reconnect and capture the HTTP traffic
  3. `GET /v1/sync?since=0`
- **Expect** Exactly **one** `POST /v1/sync`, whose `changes` array has the `category` item before
  the `expense` item. Both results are `applied`, neither is `invalid` with `unknown_category`.
  Step 3 shows the expense referencing the client-minted `Coffee` id. A first push that fails with
  `unknown_category` and only succeeds on a second attempt is a fail even though the end state
  would be right — `docs/PLAN.md` §Ordering requires one round trip.

### SYNC-22 — The server sorts the batch itself, so client order cannot break it

- **Layer** API
- **Pre** `F-FRESH`
- **Steps** `POST /v1/sync` with the **expense item first** and the category it references
  second, both new
- **Expect** Both results are `applied`. The server applies all `category` items before all
  `expense` items regardless of request order. `results` is nonetheless returned **in the order
  the items were sent**, so the client can match results to outbox rows positionally.

### SYNC-23 — A category delete and its reassignments push in order

- **Layer** E2E
- **Pre** `F-MONTH` with `Groceries` holding 7 expenses. Aeroplane mode on
- **Steps**
  1. Delete the `Groceries` category and confirm the dialog
  2. Reconnect; capture the traffic
  3. `GET /v1/sync?since=0`
- **Expect** Step 1 is one local transaction: the 7 expenses are reassigned to the `isDefault`
  category with bumped `updatedAt`, the category is tombstoned, and **8 outbox rows** are
  appended. The push sends the category item first, then the 7 expense items. Step 3 shows the
  category tombstoned and all 7 expenses live with the `isDefault` `categoryId`, so a peer
  converges on the same state without re-deriving the reassignment.
- **Also** All 8 push results are `applied` — none `conflict_server_wins`. The sync path does
  **not** reassign server-side (`applyCategoryItem` tombstones the category and touches no
  expense), so the client's 7 reassignment items are the only thing that moves those rows, and
  they carry a newer `updatedAt` than the stored ones. This is what closed GAP 2, and it is the
  branch that preserves a concurrent offline edit: had the server reassigned with its own `now`,
  every client expense item would have lost the comparison and any amount the user also corrected
  offline would have been dropped silently.
- **Also, the cost of that branch** Repeat step 1, but kill the app after the **category** item
  is acknowledged and before the expense items are sent (the client dies mid-drain). The server
  now holds 7 live expenses pointing at a tombstoned category — the state `01-flows.md` §5 rule 5
  says one transaction exists to prevent, and the sync path cannot prevent it because the
  reassignment lives in a second push. Relaunch and confirm the outbox still holds the 7 items
  and drains them. Then, separately, edit one of those 7 expenses on a **second** device that has
  pulled the tombstone but not the reassignment: the push is per-record `invalid` with
  `unknown_category`, because `requireOwnCategoryForWrite(requireLive: true)` re-checks the
  category even when `categoryId` is unchanged. Recovery is `02-offline-and-sync.md` §5.1 and
  `SYNC-30` asserts it: the row is flagged `needs-attention` and the **user** picks the new
  category. Note the wording tension — `openapi.yaml` says to "repoint it at `Uncategorized` and
  push again", while §5.1 says the row is "never silently discarded or auto-reassigned". They
  reconcile (the contract says what the server will accept, the design says who chooses), but a
  client written from the contract alone would auto-reassign and lose the user's intent. Flagged
  to Chief as a wording fix, not a blocker.

### SYNC-24 — Batch size limit

- **Layer** API
- **Pre** `F-BIG-BATCH`
- **Steps**
  1. `POST /v1/sync` with 500 items
  2. `POST /v1/sync` with 501 items
  3. `POST /v1/sync` with `{ changes: [] }`
- **Expect** Step 1 is `200` with 500 results. Step 2 is `413` with
  `error.code = "batch_too_large"` and no item applied. Step 3 is `400 validation_error`
  (`minItems: 1`). The client must split above 500 and keep categories ahead of the expenses that
  reference them.

### 8.7 Crash and kill safety

Defends: the row and its outbox entry in one transaction, and "persist `nextCursor` only after the
whole page is committed".

### SYNC-25 — App killed mid-push: nothing lost, nothing duplicated

- **Layer** E2E
- **Pre** `F-FRESH`, online through a proxy that delays the push response by 10s
- **Steps**
  1. Add 5 expenses, so one push covers all five
  2. 2s into the push, `force-stop` the app (not a background, not a reload)
  3. Relaunch, online, and let sync settle
  4. `GET /v1/sync?since=0`; also read the local list and total
- **Expect** The local list holds exactly 5 expenses both before and after the relaunch — they
  were committed to SQLite with their outbox rows in one transaction, so the kill cannot have lost
  them. Step 4 shows exactly **5** expenses server-side, with the same 5 client-minted ids. Six or
  ten expenses means the retry re-applied; four means a row was written without its outbox entry.
  Both are P1.

### SYNC-26 — App killed mid-pull: the cursor did not advance past uncommitted rows

- **Layer** E2E
- **Pre** `F-TWO-DEV`. `D2` has created 300 expenses, so `D1`'s pull takes two pages
- **Steps**
  1. Start `D1`'s pull; `force-stop` the app while page 2 is being written
  2. Relaunch `D1` and let sync settle
  3. Compare `D1`'s local expense ids against `GET /v1/sync?since=0`
- **Expect** `D1` ends up with all 300 expenses. The cursor was persisted only **after** each page
  was fully committed, so the interrupted page is simply re-delivered. A client that stored the
  watermark first would be permanently missing part of page 2, with **no error to show for it** —
  which is why this case compares the full id set rather than just the count.

### SYNC-27 — Killed while the Undo snackbar is up: the delete stands

- **Layer** E2E
- **Pre** `F-MONTH`
- **Steps**
  1. Swipe-delete a row
  2. `force-stop` the app within the 5s snackbar window
  3. Relaunch
- **Expect** The expense is deleted. It was committed to SQLite the moment the swipe released; the
  snackbar is an undo affordance, not a pending transaction, and nothing is held in memory waiting
  to be flushed. The row reappearing would mean the delete was being buffered.

### 8.8 Per-record rejection and the UI around it

Defends: `invalid` is per-record, and `needs-attention` is surfaced on the row rather than on the
app.

### SYNC-28 — One bad row does not fail the batch

- **Layer** API
- **Pre** `F-FRESH`
- **Steps** `POST /v1/sync` with three expense items: a valid one, one naming a `categoryId` that
  does not exist, and another valid one
- **Expect** `200` with three results in request order: `applied`, then `invalid` with
  `error.code = "unknown_category"` / `record: null`, then `applied`. The two valid rows **are**
  stored. A `400` for the whole batch, or a rollback of the two valid rows, would wedge the
  client's outbox forever behind one permanently-unacceptable row.

### SYNC-29 — An incomplete create is `invalid`, and a partial update is not

- **Layer** API
- **Pre** `F-FRESH`. `E_NEW` does not exist server-side; `E_OLD` does
- **Steps**
  1. Push `E_NEW` with `fields: { note: "hello" }` only
  2. Push `E_OLD` with `fields: { note: "hello" }` only
  3. Push a new category with `fields: { color: "#2F8044" }` only
  4. Push `E_OLD` with `fields: {}`
- **Expect** Step 1 is `invalid` — a row the server has never seen needs `categoryId`,
  `amountMinor` and `date`. Step 2 is `applied`: on an existing row absent keys are left alone, so
  `amountMinor`, `date` and `categoryId` keep their stored values. Step 3 is `invalid` — a new
  category needs `name`. Step 4 is `400 validation_error` for the whole request:
  `fields must not be empty`.

### SYNC-30 — A rejected row is flagged on the row, not on the app

- **Layer** E2E
- **Pre** `F-TWO-DEV`, both holding category `C1`. `D1` offline
- **Steps**
  1. On `D1`, add an expense assigned to `C1`
  2. On `D2`, delete `C1` and let it sync
  3. Reconnect `D1` and let the push run
  4. Tap the flagged row
  5. Pick another category and Save
- **Expect** `D1`'s push returns `invalid` / `unknown_category` for that expense. On Home the row
  gains a trailing `alert-circle` in `danger.default` and its subtitle is replaced by
  `Couldn't sync — tap to fix`. **The sync pill does not enter the Error state** — state 6 is for
  transport failures, and a per-record rejection is a per-record problem. The row **still counts
  toward the month total**: it is a real expense that exists locally. Step 4 opens Edit expense
  with the Category field pre-focused and in its error state reading
  `This category no longer exists. Pick another.` Step 5 re-queues the row and clears the flag.
  The row is never silently discarded and never auto-reassigned.

### SYNC-31 — `undelete` by setting `deletedAt` back to null

- **Layer** API
- **Pre** `F-MONTH`. `E1` is tombstoned server-side
- **Steps** Push `E1` with `fields: { deletedAt: null }` and a newer `updatedAt`
- **Expect** `applied`, and the returned `record` has `deletedAt: null`. The row is live again and
  appears on the next `GET /v1/expenses`. This is what makes `EXP-14` safe. `POST /v1/sync` is the
  **only** path that can do this — the REST `PATCH` declares no `deletedAt`, so a tombstone is
  `404` there (see `EXP-06`).
- **Also, undelete is blocked by a dead category** Tombstone `E1`'s category too, then push the
  same undelete. Per-record `invalid` with `unknown_category`: a row that ends up **live** must
  point at a live category, and the server re-checks even though `categoryId` is unchanged.
  Repoint at `Uncategorized` in the same push and it is `applied`.
- **Also, tombstoning is never blocked** With the category still dead, push `E1` with
  `deletedAt` set to a timestamp. `applied` — deleting must never be blocked by a category the
  user already cleaned up, which is the asymmetry `requireLive: deletedAt === null` encodes.

### 8.9 The sync pill and the detail sheet

Defends: `02-offline-and-sync.md` §3 and §4 — the app's only place for talking about
connectivity.

### SYNC-32 — The pill's six states, and the silence of the steady state

- **Layer** E2E
- **Pre** `F-MONTH`
- **Steps** Drive each condition in turn: online with an empty outbox; a push in flight for over
  800ms; outbox non-empty while online; aeroplane mode with an empty outbox; aeroplane mode with
  3 pending records; a failed attempt while online
- **Expect** State 1 **renders nothing at all** — not an empty pill, not a green tick, not
  "Synced". State 2 is `refresh-cw` + `Syncing…` in `info.*`. State 3 is `clock` + `3 pending` in
  `warning.*`. State 4 is `cloud-off` + `Offline` in **grey** (`bg.sunken` / `text.secondary`),
  **not** red — being offline is this app's expected condition. State 5 is
  `cloud-off` + `Offline · 3 pending` in `warning.*`. State 6 is `alert-circle` + `Sync failed` in
  `danger.*`. The pill never changes the app bar's layout: the screen title does not shift as the
  state changes. It appears on Home and Summary only — never on a pushed screen, a sheet or an
  auth screen.

### SYNC-33 — A sync faster than 800ms never renders the pill

- **Layer** E2E
- **Pre** `F-MONTH`, online, fast server
- **Steps** Add an expense and watch the app bar for the whole push
- **Expect** The `Syncing…` pill never appears. It is suppressed for the first 800ms, and a pill
  that flickers on every write is worse than one that never shows.

### SYNC-34 — The detail sheet, and the retry that only exists when it can work

- **Layer** E2E + Manual
- **Pre** `F-MONTH` with 3 pending records including one delete. Aeroplane mode on
- **Steps**
  1. Tap the pill
  2. Inspect the sheet
  3. Reconnect to a server that returns `500`, let the attempt fail, reopen the sheet
- **Expect** Step 2's sheet: title `Sync`, status `Offline` with the body
  `Your changes are saved on this device and will sync automatically when you are back online.`,
  the header `3 changes waiting`, three rows showing `{category} · {amount} · Added/Edited/Deleted`
  — the **deleted** row shows the category and amount read from the tombstoned local row, not
  blanks — and `Last synced {relative}`. **There is no `Try again` button** in the Offline or
  Pending states: offering a retry that cannot succeed invites a tap that does nothing. Step 3's
  sheet shows the error state **with** `Try again`; tapping it enters a Busy state and the sheet
  updates **in place** without closing. The sheet is otherwise read-only: no per-item retry, no
  "discard this change". With a screen reader the pill's label is the full sentence
  `Offline, 3 changes waiting to sync. Double tap for details.`, not the terse
  `Offline · 3 pending`.

### SYNC-35 — Pull-to-refresh is a sync, not a reload, and never errors

- **Layer** E2E
- **Pre** `F-MONTH`. Aeroplane mode on
- **Steps** Pull to refresh on Home, then on Summary
- **Expect** The `RefreshControl` spinner stops immediately and the sync pill carries the
  explanation. **No error banner, no error toast, no blanked list.** The rows and the total stay
  exactly as they were — the list was already current, because it is read from SQLite.

### SYNC-36 — A row changing under an open Edit form does not change under the user's hands

- **Layer** E2E
- **Pre** `F-TWO-DEV`, both holding `E1`
- **Steps**
  1. On `D1`, open `E1` in Edit and change the amount, but do not save
  2. On `D2`, edit `E1`'s note and let it sync
  3. On `D1`, let the pull land while the form is still open
  4. Save on `D1`
  5. Repeat steps 1–3 but with `D2` **deleting** `E1`
- **Expect** In step 3 the form's in-progress input is **not** replaced; a non-blocking inline
  notice appears below the app bar in `info.subtle` reading
  `This expense changed on another device.` with a trailing `Reload` ghost action. Not tapping
  `Reload` and saving means **Save wins**: step 4 writes the user's values with a fresh
  `updatedAt`, which LWW then resolves in their favour. In step 5 the notice reads
  `This expense was deleted on another device.`, the action becomes `Close`, and **Save is
  disabled** with the helper `This expense no longer exists.` — saving would undelete a row the
  user never asked to restore.

### SYNC-37 — Background sync is an optimisation, never a correctness guarantee

- **Layer** Manual
- **Pre** `F-MONTH` with 3 pending records. Background execution **disabled** at the OS level
  (iOS: Background App Refresh off; Android: battery optimisation set to Restricted)
- **Steps**
  1. Add an expense, background the app for an hour, never foreground it
  2. Foreground the app
- **Expect** Nothing is lost. The four foreground triggers (app open, regaining connectivity, a
  settled local write, and pull-to-refresh) are sufficient on their own: step 2 drains the outbox
  completely. The app must be fully correct if background sync never fires once, so a pending row
  that only ever syncs via `expo-background-task` is a fail.

### SYNC-38 — Pull paging terminates and delivers every row exactly once

- **Layer** API
- **Pre** `F-FRESH` plus 1,200 rows created server-side
- **Steps** `GET /v1/sync?since=0&limit=500`, then keep calling with `since = nextCursor` while
  `hasMore` is true
- **Expect** Pages are ordered by `revision` ascending with no overlap. The sequence terminates.
  The union of all pages holds each of the 1,200 ids exactly once. On the final page `hasMore` is
  `false`. A further call with the final `nextCursor` returns `changes: []` and
  `nextCursor` equal to the `since` sent — so an up-to-date client can store it unconditionally.
  `serverRevision` from a push is **not** used as the next `since`.

---

## 9. The named edge cases

These are the cases the task singles out. Each one is here because it has a plausible wrong
answer, and for several the client and the server deliberately disagree — that asymmetry is the
thing being tested.

### EDGE-01 — An amount of 0

- **Layer** E2E + API
- **Pre** `F-FRESH`
- **Steps**
  1. In Add expense, leave the amount at `0` and inspect Save
  2. `POST /v1/expenses` with `amountMinor: 0`
  3. `POST /v1/sync` with an expense whose `fields.amountMinor` is `0`
- **Expect** Step 1: Save is **disabled**, with `accessibilityState={{ disabled: true }}` and the
  helper text `Enter an amount above zero.` in `text.tertiary` (guidance, not
  `danger.default` — it is not an error). Steps 2 and 3 **succeed**: `AmountMinor` is `.min(0)`,
  so the server is permissive. This asymmetry is deliberate and documented
  (`06-expense-form.md` §Behaviour rule 6): a zero expense carries no information and is far more
  likely an accidental save, so the client requires `> 0` while the server stays permissive. A
  server that rejects `0`, or a client that accepts it, are both fails.

### EDGE-02 — Very large amounts

- **Layer** E2E + API
- **Pre** `F-FRESH`
- **Steps**
  1. In Add expense, press `9` repeatedly past 12 digits
  2. `POST /v1/expenses` with `amountMinor: 999999999999`
  3. `POST /v1/expenses` with `amountMinor: 1000000000000`
  4. `POST /v1/expenses` with `amountMinor: 1234.5`
  5. `POST /v1/expenses` with `amountMinor: "1234"`
- **Expect** Step 1: digits are **ignored** once the value would exceed
  `AMOUNT_MINOR_MAX` (999,999,999,999) — the display is unchanged, not reset and not truncated. On
  the first ignored press the key shakes (suppressed under Reduce Motion) and the snackbar
  `That is the largest amount you can enter.` appears. The user is never shown an error about a
  number they cannot see. Step 2 is `201`. Steps 3, 4 and 5 are each `400 validation_error`:
  above the max, not an integer, and not a number. The amount renders without truncation or
  ellipsis on Home at every font scale — a clipped amount is worse than a taller row.

### EDGE-03 — Decimal and rounding behaviour

- **Layer** Unit + E2E
- **Pre** `F-FRESH` (`USD`) and `F-FRESH-JPY`
- **Steps**
  1. Keypad: `1`, `2`, `5`, `0`, then backspace four times
  2. Keypad: `.` then `5`; and `.` then `.`; and `5`, `.`, `2`, `5`, `7`
  3. On `F-FRESH-JPY`, enter `1`, `2`, `5`
  4. Sum a month of `[1, 1, 1]` minor units and read the total
  5. Compute the legend for a month total of `3` split `[1, 1, 1]`
- **Expect** Step 1 displays `$0.01`, `$0.12`, `$1.25`, `$12.50`, then `$1.25`, `$0.12`, `$0.01`,
  `$0.00` — digits shift in from and out of the right-hand end only. There is no cursor, no
  selection and no insertion point, and the display is a `Text`, never a `TextInput`, so
  `0.1.2`, `--5`, `1e9`, `١٢` and an empty string are **structurally unreachable** rather than
  validated. Step 2: a second `.` does nothing, and the digit after the currency's decimal count
  is ignored, so `5 . 2 5 7` gives `$5.25`. Step 3 displays `¥125` with the decimal key hidden.
  Step 4's total is `$0.03`, summed as the integer `3` — never via a float, so no `0.030000000004`
  can arise. Step 5's labels are each `33%` and they sum to `99%`, which is **correct and
  expected**: percentages round independently, nothing adjusts the largest slice to force 100, and
  no "100%" figure is displayed anywhere.

### EDGE-04 — An expense dated in the future

- **Layer** E2E + API
- **Pre** `F-FRESH`. Today is `2026-10-06`
- **Steps**
  1. In Add expense open the date sheet and `Choose a date…`
  2. `POST /v1/expenses` with `date: "2027-01-01"`
  3. Push the same future-dated expense through `POST /v1/sync` as a peer, then pull it onto the
     app and look for it
- **Expect** Step 1: the picker's `maximumDate` is today, so a future date **cannot be selected**,
  and neither quick option (`Today`, `Yesterday`) can produce one. Step 2 is `201` — the server
  has no upper bound on `CalendarDate`, mirroring the `EDGE-01` asymmetry. Step 3 is
  `[BLOCKED-BY-GAP 5]`: the row syncs down, but the month switcher's Next arrow is disabled at the
  current month, so **no reachable month view contains it**. The expense is then invisible on
  Home, absent from every month total and absent from Summary, with no indication it exists.
  `06-expense-form.md` §8 specifies exactly this situation for an out-of-range **amount** ("render
  the value as-is, do not crash, do not auto-correct") but there is no equivalent for an
  out-of-range **date**. Not executed until GAP 5 closes.

### EDGE-05 — A month with no expenses

Covered by `SUM-05` (both tabs, both empty variants) and `SUM-06` (first-run vs. filtered-empty).
Listed here so the edge-case checklist is complete rather than duplicated.

### EDGE-06 — A category deleted while it has expenses

- **Layer** E2E + API
- **Pre** `F-MONTH`; `Groceries` has 23 live expenses across three months. Note the month total
- **Steps**
  1. Delete `Groceries` from Categories and confirm
  2. Return to Home and read the month total
  3. Open Summary
  4. `GET /v1/expenses?limit=200`
- **Expect** The 23 expenses **still exist** and now carry the `isDefault` `categoryId`. The month
  total in step 2 is **unchanged** — not reduced by the Groceries spend. In step 3 the Groceries
  slice and legend row are gone and their amount has moved into the `Uncategorized` slice; the
  total still matches the legend sum. Step 4 shows the same total expense count as before. The
  snackbar read `Groceries deleted. 23 expenses moved to Uncategorized.` A drop in the count or
  the total is a data-loss P1, not a display bug. See also `CAT-05`, `CAT-09`, `SYNC-23`.

### EDGE-07 — An expired access token mid-action

Covered by `AUTH-10` (transparent refresh and single retry). Additionally:

- **Layer** API
- **Steps**
  1. `GET /v1/me` with an expired but well-formed access token
  2. `GET /v1/me` with a token whose signature has been altered
  3. `GET /v1/me` with no `Authorization` header
  4. `GET /v1/me` with `Authorization: Basic abc`
- **Expect** Step 1 is `401 token_expired` — refresh and retry once. Step 2 is
  `401 token_invalid` — clear credentials and re-login. Steps 3 and 4 are `401 unauthorized`. The
  three codes are distinct because the client's reaction to each is different, so returning one
  code for all three is a fail even though the status matches.

### EDGE-08 — An expired refresh token

Covered by `AUTH-11` (empty outbox — the specified path), `AUTH-12` (undrained outbox —
`[BLOCKED-BY-GAP 4]`) and `AUTH-06` (single-use rotation). The gap is the case that matters: a
user offline past the 60-day refresh window has unsynced work, and no input says whether the
forced session clear destroys it.

### EDGE-09 — A note at and past its limit, and whitespace-only

- **Layer** E2E + API
- **Pre** `F-FRESH`
- **Steps**
  1. In the note sheet, paste 500 characters, then type one more
  2. Enter `"   "` (spaces only) and save the expense
  3. `POST /v1/expenses` with a 501-character note
- **Expect** Step 1: the counter reads `500/500` and turned `warning.default` above 450; the 501st
  keystroke is **dropped** with no error shown — an error for a limit the user cannot exceed is
  noise. Step 2 stores `note: null`, not `""`, and the Home row renders with **no** subtitle line.
  Step 3 is `400 validation_error`. `ExpenseNote` trims, so a 500-character note surrounded by
  spaces is accepted.

### EDGE-10 — A category name at its bounds

- **Layer** E2E + API
- **Pre** `F-FRESH`
- **Steps**
  1. Create a category named `"  A  "`
  2. Attempt one named `"   "`
  3. `POST /v1/categories` with a 65-character name
  4. `POST /v1/categories` with a 64-character name
- **Expect** Step 1 stores `"A"` — trimmed. Step 2 leaves `Create` disabled with the helper
  `Enter a name.`, and the API rejects it as `400 validation_error` (`.trim().min(1)`). Step 3 is
  `400`; step 4 is `201`. The field hard-caps at 64 via `maxLength`, so no error is needed for a
  limit that cannot be exceeded from the UI.

### EDGE-11 — A date at a month boundary entered in a shifted timezone

- **Layer** E2E
- **Pre** `F-FRESH`. Device in `Pacific/Niue` (UTC−11), local time `2026-10-31 20:00` (so UTC is
  already `2026-11-01`)
- **Steps**
  1. Add an expense, leave the date as `Today`, Save
  2. Read which month the row appears in and which month total changed
- **Expect** The stored `date` is `"2026-10-31"` — built from the picker's local year/month/day
  components directly and **never** via `toISOString()`, which would convert to UTC and store
  `"2026-11-01"`, moving the expense into the wrong month. The row appears under October 2026 and
  October's total is the one that changed. Repeat in `Pacific/Kiritimati` (UTC+14) at local
  `2026-11-01 01:00`, where UTC is still `2026-10-31`: the stored date must be `"2026-11-01"`.
  This is the single most likely date bug in the app.

### EDGE-12 — Zero-decimal currency end to end

- **Layer** E2E
- **Pre** `F-FRESH-JPY`
- **Steps** Sign up choosing `JPY`, add expenses of `125` and `1000`, open Summary
- **Expect** The keypad has no decimal key. Amounts render as `¥125` and `¥1,000` with no decimal
  places, the month total as `¥1,125`, and `minimumFractionDigits` resolves to `0` from
  `Intl.NumberFormat`, not from a hardcoded `2`. A `¥1.25` anywhere is a fail.

---

## 10. Cross-cutting API contract

One case per invariant that applies to every endpoint. These are cheap, they run on every push,
and they are where a security or correctness regression shows up first.

### API-01 — Tenancy: another user's row is `404`, never `403`

- **Layer** API
- **Pre** `F-FRESH` (user A) and `F-OTHER` (user B, owning `E_B` and `C_B`)
- **Steps** As user A: `GET`/`PATCH`/`DELETE` `/v1/expenses/E_B`; `PATCH`/`DELETE`
  `/v1/categories/C_B`; `GET /v1/expenses?categoryId=C_B`
- **Expect** Every mutation and lookup is `404` with `error.code = "not_found"` — never `403`, so
  an id cannot be probed for existence. The filtered list is `200` with `data: []`, because an
  unknown `categoryId` matches nothing rather than erroring. User B's rows are untouched
  throughout.

### API-02 — No endpoint accepts a `userId`

- **Layer** API
- **Pre** `F-FRESH` and `F-OTHER`
- **Steps** Send `userId: <user B's id>` as an extra key in a signup body, an expense create, a
  category patch, a sync push item and a sync push `fields` object
- **Expect** Every one is rejected, and none of them writes to user B. The REST bodies are
  `400 validation_error` with the offending path in `error.details.issues`. The two sync shapes
  are **per-record** `invalid` with `error.code: "immutable_field"` and an HTTP `200` for the
  batch — `userId` is in `SERVER_OWNED_FIELDS`, and the push validates each item on its own so one
  bad row cannot fail the batch (see `API-04`). Do not expect a `400` there.
- **Why it still proves the point** Tenancy comes only from the access token, so there is no
  request shape anywhere in this API that can be pointed at another user's data. Confirm the
  negative directly as well: after all five attempts, `GET /v1/expenses` and `GET /v1/categories`
  as user B return exactly what `F-OTHER` seeded, byte for byte.

### API-03 — Unknown fields are rejected everywhere

- **Layer** API
- **Pre** `F-FRESH`
- **Steps** Add a `nope: 1` key to each of: `SignupRequest`, `LoginRequest`, `RefreshRequest`,
  `CategoryCreateRequest`, `CategoryUpdateRequest`, `ExpenseCreateRequest`,
  `ExpenseUpdateRequest`, `SyncPushRequest`, a push item, and a push `fields` object. Also send
  `?nope=1` to `GET /v1/expenses` and `GET /v1/sync`
- **Expect** Every shape is validated closed, but the sync path reports at a different level:
  - The seven REST bodies and the two query strings are `400 validation_error` with
    `details.issues[].path` naming the unexpected key.
  - `SyncPushRequest` itself (a stray key beside `changes`) is `400 validation_error` — that is the
    batch envelope, not a row.
  - A stray key on a **push item** or on its `fields` is per-record `invalid` with
    `error.code: "validation_error"`, inside an HTTP `200`. `nope` is not server-owned, so this is
    the plain code, not `immutable_field`.
- **The one sync case that is a `400`** An item missing `entity`, `id` or `clientMutationId`.
  There is no way to address a per-record result at it, so the batch fails with `400` naming the
  offending index. Send a batch of three where only the middle item lacks `clientMutationId` and
  confirm the index in the message is `1`, and that neither sibling was applied.

### API-04 — Server-owned fields cannot be set by the client

- **Layer** API
- **Pre** `F-MONTH`
- **Steps** Attempt to set each of `revision`, `createdAt`, `id` and `userId` (the four in
  `SERVER_OWNED_FIELDS`) two ways: via `PATCH /v1/expenses/{id}`, and via a sync push `fields`
  object
- **Expect, sync path** Per-record `invalid` with `error.code: "immutable_field"`, and the message
  naming the offending field. This now works: `backend/src/sync/batch.ts` inspects the zod failure
  and, when the unrecognised key is one of `SERVER_OWNED_FIELDS`, reports `immutable_field` rather
  than `validation_error` — telling "you tried to set something you don't own" apart from a typo.
  Note the status is **not** `422` here: a per-record error carries a `code`, not an HTTP status.
- **Expect, REST path** `400 validation_error` naming the key — **not** `422 immutable_field`.
  `[BLOCKED-BY-GAP 7]` for this half only: `ExpenseUpdateRequest` and `CategoryUpdateRequest` are
  closed schemas that declare none of these keys, so the unknown-key rule fires first and the
  `422` is unreachable, while `openapi.yaml` still advertises `immutable_field` on four REST
  operations (lines 493, 574, 825, 884). Assert `400 validation_error` today; the fix is to drop
  the code from those four or give the REST validator the mapping `batch.ts` already has.

### API-05 — The error envelope is the only non-2xx shape

- **Layer** API
- **Pre** `F-FRESH`
- **Steps** Collect one response for every `ERROR_CODES` entry reachable from §4–§10, plus
  `GET /v1/no-such-route`
- **Expect** Every non-2xx body validates against `ApiError`: exactly `{ error: { code, message } }`
  with an optional `details` and **no other top-level keys**. Every `code` is a member of
  `ERROR_CODES`, and the HTTP status matches `ERROR_CODE_STATUS` for that code. `details.issues`
  is present for every `validation_error`. No body leaks a stack trace, a SQL fragment, a file
  path or an internal hostname. Every response, 2xx included, carries `X-Request-Id`.

### API-06 — `Content-Type` is enforced on requests with a body

- **Layer** API
- **Pre** `F-FRESH`
- **Steps**
  1. `POST /v1/auth/login` with a valid JSON body and `Content-Type: text/plain`
  2. The same with no `Content-Type` at all
  3. `POST /v1/expenses` with `Content-Type: application/json` and the body `{`
  4. `POST /v1/expenses` with `Content-Type: application/json` and no body
- **Expect** Steps 1 and 2 are `415 unsupported_media_type`. Steps 3 and 4 are
  `400 malformed_request` — unparseable JSON and a missing required body are the same code, and
  neither is a `500`.

### API-07 — Auth is required on exactly the right operations

- **Layer** API
- **Pre** None
- **Steps** Call every operation with no `Authorization` header
- **Expect** `GET /v1/health`, `POST /v1/auth/signup`, `POST /v1/auth/login`,
  `POST /v1/auth/refresh` and `POST /v1/auth/logout` behave normally. Every other operation is
  `401 unauthorized`. An endpoint that works unauthenticated when it should not is a security P1;
  one that demands a token when it should not locks a user out of logging in.

### API-08 — Health reports the database as part of liveness

- **Layer** API
- **Pre** A running server
- **Steps**
  1. `GET /v1/health`
  2. Stop Postgres and repeat
- **Expect** Step 1 is `200` with `status: "ok"`, a `version`, a `time` and `db: "up"`. Step 2 is
  `503` with the standard envelope and `error.code = "internal_error"` — this API is useless
  without Postgres, so an instance that cannot reach it must not report itself healthy. Step 2
  returning `200` would keep a dead instance in rotation.

### API-09 — Rate limiting

- **Layer** API
- **Pre** `F-FRESH`
- **Steps** Send repeated failed logins for one email, repeated logins from one address, and a
  burst of authenticated reads
- **Expect** `[BLOCKED-BY-GAP 10]` — the contract says login is "rate limited per email and per
  source address" and that `429 rate_limited` sets `Retry-After`, but **no threshold or window is
  stated anywhere**, so there is no number to assert against. What this case can assert today: a
  `429` body validates against `ApiError` with `code: "rate_limited"` and carries a
  non-negative integer `Retry-After`. The threshold assertion waits on GAP 10.

### API-10 — `GET /v1/sync` query validation

- **Layer** API
- **Pre** `F-FRESH`
- **Steps** `since=-1`; `since=abc`; `limit=0`; `limit=501`; `limit=500`; both omitted
- **Expect** `since=-1`, `since=abc`, `limit=0` and `limit=501` are each
  `400 validation_error`. `limit=500` is `200`. With both omitted the server behaves as
  `since=0, limit=200` (`SYNC_PULL_DEFAULT_LIMIT`), returning a full download whose page holds at
  most 200 changes.

### API-11 — `GET /v1/expenses` query validation

- **Layer** API
- **Pre** `F-MONTH`
- **Steps** `limit=0`; `limit=201`; `limit=200`; `from=2026-13-01`; `from=06-10-2026`;
  `categoryId=not-a-uuid`; `includeDeleted=yes`
- **Expect** The out-of-range limits and every malformed value are `400 validation_error`.
  `limit=200` is `200`. `includeDeleted` accepts the `stringbool` forms the schema defines and
  rejects the rest. With `limit` omitted the page holds at most 50
  (`EXPENSE_LIST_DEFAULT_LIMIT`).

---

## 11. Contract and design gaps found while writing this plan

Finding these now is the point of writing the plan in Wave 1. **Each one is raised as a comment on
TVO-5 and flagged to Chief**; contract changes go through Chief per `docs/PLAN.md` §7. None of
them is assumed resolved, and the cases that depend on one are marked `[BLOCKED-BY-GAP n]` above
rather than guessed at.

Ten gaps were filed when this plan was first written. **Five have since closed**, four of them in
the contract and backend work of 8–9 Oct — which is the plan paying for itself before a single
case was executed. The numbering is kept stable so the TVO-5 thread still reads correctly, and the
closed entries are kept rather than deleted so the decision is recorded where the test that
depends on it can find it.

### Closed

| #   | Gap                                                              | Closed by                                                                                                        |
| --- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | Who seeds the default categories — the duplicate-six risk        | `00-foundations.md` §7 rule 7: "The server writes these rows; the client never seeds." `AUTH-17` asserts six     |
| 2   | Does a sync-path category delete reassign expenses server-side?  | Implementation: it does **not**. `SYNC-23` now asserts the per-record statuses, and the cost of that branch      |
| 6   | The clock clamp is one-sided; a slow clock silently always loses | Recorded as intended on `clampClientUpdatedAt`. `SYNC-20` is a test rather than an open question                 |
| 8   | The server clock must be injectable                              | Resolver is pure functions over `now`; `pruneTombstones(db, userId, now)` takes it too. §2 updated               |
| 7a  | `immutable_field` unreachable on the **sync** path               | `sync/batch.ts` maps a server-owned unknown key to `immutable_field`. `API-04` asserts it; the REST half is open |

Also settled in passing, though never filed as a numbered gap: `EXP-02`'s `[CONFIRM]` on a
re-posted REST create, which `openapi.yaml` now answers — idempotent `201`, retried body ignored,
no new `revision`, and another account's id rejected as `400 validation_error`.

### Still open

| #   | Gap                                                               | Severity | Blocks               |
| --- | ----------------------------------------------------------------- | -------- | -------------------- |
| 3   | `clientMutationId` retention window — and the ledger never prunes | High     | `SYNC-13`            |
| 4   | Does a forced session clear wipe undrained local writes?          | High     | `AUTH-12`, `EDGE-08` |
| 5   | A future-dated row arriving by sync is unreachable in every view  | Medium   | `EDGE-04`            |
| 7b  | `immutable_field` is unreachable on the **REST** path             | Low      | `API-04` (half)      |
| 9   | No E2E driver is named in `docs/PLAN.md` §7                       | Low      | 7 cases run manual   |
| 10  | Rate limits are not quantified                                    | Low      | `API-09`             |

**GAP 4 is the one to settle first.** It is the only open gap whose failure mode is silent,
unrecoverable loss of the user's own data, and the user it hits is the one this app is built
for — someone who has been offline for a while.

### GAP 1 — Who seeds the default categories, and the duplicate-six risk — **CLOSED**

The contract's `POST /v1/auth/signup` says it "**seeds the default categories**", while an earlier
draft of `00-foundations.md` §7 had them created **client-side** with client-minted UUIDv7 ids and
pushed through the outbox. If both sides did it the user would hold **twelve** categories after
the first pull — six with server ids, six with client ids, five duplicated by name, and nothing to
de-duplicate them, because they differ by `id` and the protocol converges on `id`. Reachable on
the very first screen after signup.

**Resolved: the server seeds, the client never does.** `00-foundations.md` §7 rule 7 now states it
outright and records the reasoning — a client that also seeded "would push a second set beside the
server's and the user would see twelve", and offline signup is impossible anyway, so "a client
that cannot reach the server has no account to seed against". The client reads the seeded rows and
treats them as ordinary synced data from then on.

The second half closed with it. `isDefault` is settable through **no** write path — it is absent
from `CategorySyncFields`, `CategoryCreateRequest` and `CategoryUpdateRequest` — and
`applyCategoryItem` hard-codes `isDefault: false` on every sync create. Under client-side seeding
that was a hole, because a client-seeded set could not tell the server which row was the protected
default. Under server-side seeding it is the invariant that makes a second default impossible, so
the same code reads as a bug fix rather than a hole. `AUTH-17` asserts six categories and exactly
one default; `CAT-08` covers renaming the default without breaking the fallback.

One leftover to confirm rather than assume: `07-categories.md` §4 rule 9 specified a client repair
path where a client finding no live `isDefault` row "recreates it locally … and pushes it". That is
still inexpressible in the contract, and with server-side seeding it should now be unreachable —
the default cannot be deleted (`CAT-07`, `CAT-12`) and cannot be un-defaulted. The grep for that
rule in the current spec comes back empty, so it appears to have been removed along with the
client-seeding draft. Worth one confirmation from the Designer that it is gone deliberately.

### GAP 2 — Does a sync-path category delete reassign expenses server-side? — **CLOSED in code, open in prose**

`DELETE /v1/categories/{id}` explicitly reassigns the category's expenses to the `isDefault`
category. `POST /v1/sync` with `fields: { deletedAt }` on a category says **nothing** about
reassignment. The mobile app's only write path is the sync one, so this is the path that actually
runs in production.

The contract's own introduction promises "Both paths produce identical rows", and as written the
two paths cannot be shown to.

Both candidate answers have a cost:

- **If the server does not reassign**, it is relying on the client to push each expense's new
  `categoryId` (which `07-categories.md` §4 rules 6–7 does specify). A peer that tombstones a
  category through the REST path, or a client that dies between the two pushes, leaves expenses
  pointing at a deleted category — the exact state `01-flows.md` §5 rule 5 says one transaction
  exists to prevent.
- **If the server does reassign**, it writes each expense with a **server** `updatedAt` of `now`.
  Categories are applied before expenses in the same batch, so the client's own expense items —
  which carry the earlier client `updatedAt` — then come back `conflict_server_wins` and are
  dropped. For an expense the user only reassigned that is harmless. For an expense they **also**
  edited offline in the same session (a corrected amount, say), **that edit is silently lost**.

**Answered by the implementation: the server does not reassign.** `applyCategoryItem`
(`backend/src/services/syncPushService.ts`) tombstones the category and touches no expense row. So
the client's reassignment items are the only thing that moves those expenses, they carry a newer
client `updatedAt` than the stored rows, and they come back `applied`. `SYNC-23` now asserts all
eight statuses.

This is the better of the two branches, and worth saying why: it is the one that **preserves a
concurrent offline edit**. Had the server reassigned with its own `now`, every client expense item
would have lost the comparison and an amount the user also corrected offline would have been
dropped silently — the second bullet above.

**Still open, and the reason this entry is not simply deleted:** the contract's prose. The
`POST /v1/sync` description still says nothing about reassignment, while the contract's
introduction promises "Both paths produce identical rows" — and on this point the two paths
demonstrably do not. The behaviour is now settled and tested; the document a future client author
reads is not. Two sentences on the push description would close it: that a category tombstone
applied through the sync path reassigns nothing, and that the client owns pushing each expense's
new `categoryId`.

The cost of the chosen branch is also now a real, reachable state rather than a hypothetical: a
client that dies between the category push and the expense pushes leaves live expenses pointing at
a tombstoned category. `SYNC-23`'s second and third bullets cover both halves of it — that the
outbox survives and drains, and that a peer editing one of those expenses gets a per-record
`invalid` with `unknown_category` and recovers through `02-offline-and-sync.md` §5.1.

### GAP 3 — `clientMutationId` retention window is unspecified

`docs/PLAN.md` §Idempotency and the push description both require a replayed `clientMutationId` to
be a no-op, and the contract calls a double-apply "the most common offline-sync bug". Neither says
**how long** the server remembers a processed id.

It cannot be forever in practice — the table grows without bound — so there is a window, and its
length is the difference between "a retry after a long weekend offline is de-duplicated" and "it
is not". With a 60-day refresh token and an app designed around being offline for a week, the
window has to be stated to be relied on.

**Since filing, this has gone from unspecified to concrete: the answer today is "forever".** The
ledger landed as `sync_mutations` (one row per `clientMutationId` per user, with a `created_at`
that nothing reads), and **no code path deletes from it**. `pruneTombstones` deletes from
`expenses` and `categories` only; `pruneAllTombstones` calls it per user and touches nothing else.
Grepping the backend for a delete against `sync_mutations` returns nothing outside generated Prisma
code.

That is the correct answer for de-duplication and the wrong one for a table with no ceiling: it
grows with every mutation every user ever makes, is never read for rows older than a retry window,
and is the one table in the schema with no bound on it. `created_at` is already there, which
suggests pruning was intended and simply has not been written yet.

For most payloads an expired id degrades gracefully: re-applying the identical row with the
identical `updatedAt` comes back `conflict_server_wins` (ties go to the server), which is
harmless. It does **not** degrade gracefully for a delete-then-recreate sequence on the same id,
or for an `invalid` result the client is replaying to re-read.

**What QA needs:** the retention period written down, and a pruner that enforces it, so `SYNC-13`
can assert a boundary from both sides. "The same 90 days as the tombstone horizon, pruned by the
same job" is a fine answer and the cheapest one — `pruneTombstones` already runs per user in a
transaction and already has `now` injected, so the ledger sweep is a third statement in a function
that exists. It would also keep the two horizons from drifting apart, which matters because a
client resyncing at the tombstone horizon is exactly the client most likely to be replaying old
mutation ids.

Note this is a lower-urgency gap than its High severity suggests on first read: the **correctness**
property is currently safe, because remembering forever de-duplicates everything. The risk is
operational (unbounded growth) plus the untested boundary. It is filed High because the fix changes
behaviour `SYNC-09`–`SYNC-13` assert, so it is much cheaper before those cases are executed than
after.

### GAP 4 — Does a forced session clear wipe undrained local writes?

Two paths end a session, and only one is specified:

- **Explicit logout** (`04-expense-list.md` §Behaviour rule 14) revokes the token, clears secure
  store, **wipes the local database**, and is gated by a dialog whose body reads
  `Changes that have not synced yet will be lost.` when the outbox is non-empty. Fully specified,
  and it warns.
- **A forced clear** on `401 token_invalid` (`01-flows.md` §3, `09-copy-deck.md` §127) clears the
  session and shows `Your session expired. Please log in again.` **Whether it wipes the local
  database is stated nowhere.**

The second path is the one a user reaches by being offline past the 60-day refresh window — which
is exactly the user most likely to be holding unsynced writes. If it wipes, their work is
destroyed with no dialog and no warning, and the copy they get instead talks about logging in. If
it does not wipe, the client needs a defined rule for what happens to that outbox after
re-login — including re-login as a **different** user, where replaying the previous user's outbox
would be a cross-account data leak.

This is the highest-consequence gap of the four, because the failure is silent and the data is
unrecoverable. Note that §5.3 of `02-offline-and-sync.md` already establishes the right principle
for the analogous resync case ("push first, then wipe; if the push cannot complete, do not wipe"),
so there is a precedent to follow here.

**What QA needs:** the rule for the forced path, including the different-user re-login case.
`AUTH-12` and `EDGE-08` are written and waiting on it.

### GAP 5 — A future-dated row arriving by sync is unreachable in every view

The client cannot create a future-dated expense (`06-expense-form.md` §9: `maximumDate` is today)
and the server accepts one (`CalendarDate` has no upper bound). That asymmetry matches `EDGE-01`'s
and is fine on its own.

What is not covered is what the app does when a future-dated row **arrives by sync** — from the
REST path, a buggy peer, or a device whose clock was days ahead when the row was written. The
month switcher's Next arrow is disabled at the current month (`05-month-switcher.md` §2) precisely
because "every future month is guaranteed empty". Once such a row exists that premise is false,
and the row is then:

- invisible on Home (no reachable month contains it),
- absent from every month total and from Summary,
- not editable, because the only route to Edit is tapping its row.

So it is real data the user has paid for and cannot see, with nothing anywhere indicating it
exists.

`06-expense-form.md` §8's last table row handles the exactly-parallel case for an out-of-range
**amount** arriving by sync — "render the value as-is, do not crash, do not auto-correct", with a
`danger.default` message and Save disabled. There is no equivalent row for an out-of-range
**date**, and the same treatment would close this.

**What QA needs:** either a stated behaviour (clamp the switcher's upper bound to
`max(current month, latest expense month)` is the smallest change, and keeps the "no empty months"
rationale intact), or a server-side upper bound on `date`. `EDGE-04` is written both ways and
waiting.

### GAP 6 — The clock clamp is one-sided — **CLOSED**

The server clamps a client `updatedAt` to `now + 5 minutes`, which correctly stops a
fast-clock device winning every future conflict. There is **no lower clamp**.

A device whose clock is hours or days **behind** therefore writes a past `updatedAt`, loses every
conflict against any server row written since, and has its local copy overwritten from the
response — silently, because `02-offline-and-sync.md` §5.2 deliberately does not notify on
`conflict_server_wins`. The user's genuinely-newest edit disappears and they are told nothing.

This may well be the right trade: a lower clamp would break legitimate offline editing, where an
`updatedAt` from last Tuesday is exactly correct and must be honoured. The gap is that the
asymmetry is not recorded as a decision anywhere, while the upper clamp has three paragraphs of
rationale across `docs/PLAN.md`, `shared/src/primitives.ts` and the contract.

**Resolved, as QA guessed: intended, and now written down.** The doc comment on
`clampClientUpdatedAt` (`backend/src/sync/resolver.ts`) records both the decision and the
reasoning: "Only the future is clamped. A clock that is _behind_ loses conflicts it should have
won, which costs the user an edit — annoying, recoverable, and not something the server can
distinguish from a genuinely older edit anyway." That last clause is the part that makes it
unarguable — the server has no way to tell a slow clock from an honest edit made last Tuesday, so
a lower clamp would have to break the second to fix the first.

`SYNC-20` is now a test with a stated expectation rather than a `[CONFIRM]`.

### GAP 7 — `immutable_field` is unreachable — **sync half CLOSED, REST half open**

`immutable_field` is in `ERROR_CODES`, mapped to `422` in `ERROR_CODE_STATUS`, listed in
`x-errorCodes` on five operations, listed in `x-recordErrorCodes` for the push, and described in
the `UnprocessableEntity` component as covering "`id` on a PATCH, `userId`, `createdAt` or
`revision`".

But every request body is a `strictObject` / `additionalProperties: false`, and none of
`CategoryUpdateRequest`, `ExpenseUpdateRequest`, `CategorySyncFields` or `ExpenseSyncFields`
declares an `id`, `userId`, `createdAt` or `revision` property. So the stated rule
"an unexpected key is `400 validation_error`" fires first, every time. There is no input QA can
construct that yields `422 immutable_field`.

Same shape, smaller: `mutation_id_reused` is mapped to `409` in `ERROR_CODE_STATUS`, but no REST
request body accepts a `clientMutationId`, so the `409` is unreachable too — the code only ever
appears inside a per-record `invalid` result, where it does work correctly and `SYNC-11` covers
it.

Neither is a bug a user would hit. Both matter because an untestable error code is one a server
can claim to implement without anyone being able to check, and `API-05` asserts that every code's
status matches `ERROR_CODE_STATUS`.

**The sync half is closed, by the second of those two options — sort of.** `sync/batch.ts` keeps
`fields` a `strictObject` but inspects the resulting zod error: when the unrecognised key is one of
`SERVER_OWNED_FIELDS` (`id`, `userId`, `createdAt`, `revision`), the per-record error becomes
`immutable_field` instead of `validation_error`. The doc comment gives exactly the reason QA
wanted the distinction for: the two are "different client bugs: one is 'you tried to set something
you don't own', which the client must stop doing, and the other is a misspelling." So on the push
path the code is now reachable and `API-04` asserts it. Note it arrives as a per-record
`error.code` inside a `200` — not as a `422`, because a per-record result carries no HTTP status.

**The REST half is still open, and is now a documentation inconsistency rather than a design
question.** `ExpenseUpdateRequest` and `CategoryUpdateRequest` are untouched, so the unknown-key
rule still fires first and `422 immutable_field` is still unreachable through any REST shape —
while `openapi.yaml` still advertises `immutable_field` under `x-errorCodes` on four REST
operations (`POST /v1/categories`, `PATCH /v1/categories/{id}`, `POST /v1/expenses`,
`PATCH /v1/expenses/{id}`; lines 493, 574, 825, 884).

**What QA needs:** pick one. Drop the code from those four operations, or give the REST validator
the same mapping `batch.ts` already has — the second is a few lines and makes the two paths agree,
which is the contract's own stated goal. Either way, also note in `ERROR_CODES` that
`mutation_id_reused` is record-level only, so its `409` mapping is not a reachable HTTP status.
Severity dropped from Medium to Low: the half that could have hidden a real server bug is the sync
half, and that one now works.

### GAP 8 — The server clock must be injectable — **CLOSED**

Four cases (`SYNC-16`, `SYNC-17`, `SYNC-18`, `SYNC-19`) and the `F-STALE` fixture need the server
to believe it is a different time: a 90-day-old tombstone horizon, and a 5-minute clamp boundary
reached from both sides. If the server reads `Date.now()` directly in the resolver and the pruner,
none of this can be automated, and the protocol's two most subtle rules ship untested —
`docs/PLAN.md` §7 specifically requires the resolver to have a unit test per branch, including
"clamped clock" and "tombstone horizon".

**Resolved, and done the better way.** Rather than an injected clock object, the resolver is a
file of pure functions that each take `now` as an argument — `clampClientUpdatedAt(incoming, now)`,
`wasClamped(incoming, now)`, `tombstoneHorizon(now)`, and `needsResync({ since, serverRevision,
prunedThroughRevision })` with no clock at all. `pruneTombstones(db, userId, now = new Date())`
takes it too, defaulted so production callers do not have to care. The file's own comment states
the intent: a rule expressed as a pure function "can be tested exhaustively at the boundary —
equal timestamps, a clock five minutes and one millisecond fast, a cursor exactly on the horizon —
without a fixture per case."

That is strictly better than what QA asked for: the clamp boundary and the 90-day horizon are
reachable in unit tests with no fixture, no database and no clock mocking. Backend Dev has already
used it — `backend/tests/sync.resolver.test.ts` covers the branches `docs/PLAN.md` §7 requires. The
`F-STALE` fixture still needs a backdated tombstone at the API layer, which `pruneTombstones`'
`now` argument provides.

### GAP 9 — No E2E driver is named

`docs/PLAN.md` §7 names vitest/supertest and jest/RNTL. Seven cases here need a driven app with
connectivity control. QA proposes **Maestro** (YAML flows, Expo support, `setAirplaneMode`).
Needs Chief's and Mobile Dev's agreement; until then those cases run manual, which is slower and
less repeatable but not blocking.

### GAP 10 — Rate limits are not quantified

`429 rate_limited` is documented on every operation, `Retry-After` is specified, and login is said
to be limited "per email and per source address" — but no threshold or window appears anywhere.
`API-09` can assert the response **shape** but not that any limit is actually enforced, so a
server with no rate limiting at all would pass. Numbers would also let the app's own retry
back-off be tuned against something real rather than guessed.

---

## 12. Device and OS matrix

Two iOS, two Android, chosen so each row buys something the others do not. The floors are the
pinned Expo SDK's minimum supported versions — confirm them against the SDK actually pinned in
`mobile/package.json` before the Wave 3 run, since a floor that is below what the SDK supports is
not a real test target.

| #   | Device                   | OS                 | Form factor         | Why this row                                                                                                        |
| --- | ------------------------ | ------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | iPhone 16 (or simulator) | iOS, current       | 6.1", notch         | The primary iOS target                                                                                              |
| 2   | iPhone SE (3rd gen)      | iOS, SDK floor     | 4.7", no safe inset | The **smallest** screen, and the oldest OS. The keypad + amount + Save layout is tightest here; `EXP-12` lives here |
| 3   | Pixel 8 (or emulator)    | Android, current   | 6.2"                | The primary Android target; the back-gesture and predictive-back cases                                              |
| 4   | A low-end Android phone  | Android, SDK floor | 6.5", 4GB RAM       | Slow SQLite and slow cold start. Where the <2s cold-start target and `loading:first-paint` are actually tested      |
| 5   | iPad (any current)       | iOS, current       | Tablet              | `SYNC-06` and every `F-TWO-DEV` case need a genuine second device, and a tablet also catches hardcoded widths       |

Rules for the matrix:

1. **Rows 1 and 3 run the whole plan.** They are the primary targets.
2. **Rows 2 and 4 run the regression checklist in §13 plus every layout-sensitive case**:
   `EXP-12`, `EDGE-02` (amount truncation), `SUM-13` (bar growth), and the dynamic-type checks.
3. **Row 5 runs §8 only**, as the second device.
4. **At least one row must be a physical device, not a simulator.** A simulator does not have a
   real radio, and aeroplane-mode behaviour, background-task throttling and genuine connectivity
   flap are the subject of this plan. Rows 3 and 4 are the intended physical devices.
5. **Every row runs under both the UTC+14 and UTC−11 timezones** for the §9 date cases.
6. **Background execution is tested with OS throttling at its most aggressive** (row 4: battery
   optimisation Restricted; row 2: Background App Refresh off), because `SYNC-37` asserts
   correctness when background sync never fires.
7. Accessibility passes run on row 1 with VoiceOver and row 3 with TalkBack. Dynamic type is
   checked at the default scale, at `fontScale 1.3` and at `fontScale 1.5`, which are the three
   breakpoints the specs name.

---

## 13. Regression checklist for the final pass

The short list, run on rows 1–4 of the matrix before hand-off. Every item is a one-line smoke
check of something whose breakage would be severe or silent; the full plan above is what finds
bugs, and this is what proves none of them came back. Target: under 30 minutes per device.

**Account and session**

- [ ] Sign up → land on Home with exactly six categories, one of them the undeletable default
- [ ] Force-stop and relaunch → Home renders on the first frame, no spinner, still logged in
- [ ] Aeroplane mode + relaunch → still logged in, pill grey and reading `Offline`
- [ ] Log out → Welcome; back gesture exits the app rather than returning to a dead Home

**Expenses**

- [ ] Add `$12.50` → row appears at the top of today, total increases by exactly `$12.50`
- [ ] Edit the amount → `Changes saved.`, total adjusts in the same render pass
- [ ] Swipe-delete → row leaves, total drops, `Undo` restores both
- [ ] Amount `0` → Save disabled with `Enter an amount above zero.`
- [ ] A date in the future cannot be selected in the picker

**Categories**

- [ ] Create, rename and recolour a category offline → all succeed, all show the clock glyph
- [ ] Delete a category with expenses → dialog states the exact all-time count; expenses **move**
      and the month total is unchanged
- [ ] The default category offers no delete affordance anywhere
- [ ] A duplicate name is blocked case-insensitively, offline

**Totals and chart**

- [ ] Month total equals the SQL sum over the month, with more than one page of expenses
- [ ] Legend amounts sum to the displayed total; the count matches the live expense count
- [ ] An empty month shows `$0.00` and no donut, with the right copy on both tabs
- [ ] Switching month on one tab carries to the other; Next is disabled at the current month

**Offline and sync — the part that must never regress**

- [ ] Create, edit and delete offline → reconnect → all three states are correct on the server
- [ ] A day's mixed changes drain in **one** `POST /v1/sync`, categories before expenses
- [ ] A category plus an expense assigned to it, both created offline, sync in one round trip
- [ ] A retried push after a dropped response leaves **exactly one** row at the same `revision`
- [ ] An offline delete is still deleted after a subsequent pull
- [ ] The same row edited on two devices converges on the newer `updatedAt`, loser overwritten,
      user not notified
- [ ] A `+6h` device clock does not win the next conflict
- [ ] Force-stop mid-push → no expense lost and none duplicated
- [ ] Pill state 1 renders **nothing**; `Try again` exists only in the error state
- [ ] A row rejected as `invalid` is flagged on the row, still counts toward the total, and the
      pill stays out of its error state

**Contract**

- [ ] Another user's id is `404`, never `403`, on every `/{id}` route
- [ ] Every non-2xx body is the `ApiError` envelope with a code from `ERROR_CODES`
- [ ] `GET /v1/health` returns `503` when Postgres is down
- [ ] `pnpm lint && pnpm typecheck && pnpm test` is green

**Accessibility**

- [ ] An expense row is one element with the composed label, including `, not synced yet`
- [ ] The amount keypad announces the running formatted total, not the digit pressed
- [ ] The sync pill reads as a full sentence, not as its terse label
- [ ] At `fontScale 1.5` no amount truncates and the keypad stays on screen

---

## 14. Exit criteria

The MVP is ready to hand back when:

1. **Every case in §4–§10 has run on matrix rows 1 and 3**, and the §13 checklist has run on
   rows 1–4, with a recorded pass or a filed bug. A case that was not run is not a pass.
2. **No open P1.** A P1 is: lost or duplicated user data, a cross-tenant read or write, a
   resurrected delete, a double-applied push, a crash on a documented path, or a session cleared
   without an explicit `401 token_invalid` from a server actually reached.
3. **No open P2 in §8.** The sync section is where field bugs are unbearable to debug, so its bar
   is higher than the rest of the plan's.
4. **Every gap in §11 is either resolved or accepted in writing by Chief**, and every
   `[BLOCKED-BY-GAP n]` case has been unblocked and run, or explicitly deferred with the deferral
   recorded on TVO-5.
5. **The sync resolver has a unit test per branch** — applied, conflict, invalid, idempotent
   replay, clamped clock, tombstone horizon — as `docs/PLAN.md` §7 requires.
6. **`pnpm lint && pnpm typecheck && pnpm test` is green on `main`.**
7. **Every bug filed under this plan has been re-tested against the fix before it was closed**,
   by the case ID that found it, on the device row that found it.
