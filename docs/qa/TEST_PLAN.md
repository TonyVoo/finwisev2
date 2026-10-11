# MVP Test Plan

Owner: QA Tester · Status: ready to execute · Last updated: 2026-10-11

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

Since then, two gaps that were filed as questions for Chief have been closed by reading the landed
code instead of waiting for an answer, and both turned out to be defects rather than decisions:
**GAP 4** (two defects in `mobile/`, carried by `AUTH-18` / `AUTH-19`) and **GAP 3** (the
idempotency ledger is never pruned, carried by `SYNC-39` / `SYNC-40`). No open gap is now a
blocking decision for Chief; see the register at the top of §11.

**Both of those fixes have since landed and been re-tested** — `1d68717` / `b1f7d7f` for the
account-switch leak and `9f2edc8` / `ccde610` for the ledger — so `AUTH-12`, `AUTH-18`, `AUTH-19`,
`SYNC-13`, `SYNC-39` and `SYNC-40` now assert the fixed behaviour rather than the defect, and the
four expected-fail cases among them are ordinary cases. Re-testing the first one turned up **GAP
11**, two narrower defects in the same area that the fix did not cover: the account-switch wipe
runs *before* the write that can fail, and the owner is stored as a separate value from the tokens
it describes. `AUTH-20` and `AUTH-21` carry those; with `CAT-15`, `CAT-16`, `AUTH-23`, `AUTH-24`,
`SYNC-44` and `SYNC-45` below they are the eight expected-fail cases left.

**The API-layer steps of `EDGE-01`, `EDGE-02` and `EDGE-04` are now executed** rather than merely
written (`backend/tests/expenses.edgecases.test.ts`), and all three pass. They were picked because
the suite already covered the *reject* side of the money and date boundaries and nothing covered
the *accept* side — the side where an off-by-one in a limit, or an `int4` column under a
twelve-digit contract, would have left every existing test green. `EDGE-04`'s result also narrows
GAP 5: the future-dated row is on the wire, in the list response and ordered first, so nothing
server-side filters it and the fix has to be a client decision.

**`src/db/queries.ts` — the reads the UI renders from — is now covered too, and it opened GAP 12.**
`listLiveCategories` gets the category list's order wrong twice: `ORDER BY c.name` is
case-sensitive under SQLite's default collation, and nothing pins the `isDefault` row last. What
makes this worth reading is that `CAT-01` already asserted the right order and **could not have
caught either defect**: its precondition is `F-FRESH`, whose six seeded names sort identically
under the right ordering and the wrong one. The plan's own fixture was the blind spot. `CAT-15`
and `CAT-16` seed names chosen to separate them and are expected-fail until the fix lands.

**`TVO-6`'s own acceptance criteria are now verified, and the one hole in them is GAP 13.** The AC
singles out two guarantees as must-test, and both hold up: the transactional write helper genuinely
cannot leave a row without its outbox entry (its cases inject a real `UNIQUE` violation that fires
*after* the row insert, so they can fail), and the single-flight refresh is correct under every
interleaving `authorize.test.ts` scripts. Those all cover the token changing **within one session**.
None covered the other reason the stored token can differ when a request comes back — that it now
belongs to a different user — and on that path an in-flight request is retried under the next user's
token with its body replayed verbatim. `AUTH-22`–`AUTH-25` carry it.

**The composition root and the client's route table are now covered, and no defect was found in
either — which is a result, not a non-event.** A coverage run over `mobile/src` picked the targets
rather than intuition: `bootstrap/container.ts` was at 0%, and half of `api/client.ts`'s sixteen
methods had never been called by a test. Both matter to this plan specifically. The container is
the one place TVO-16's account-switch fix can be undone with every other mobile case still green
(`AUTH-26`, `AUTH-28`), and the client's method-to-route wiring is invisible to TypeScript wherever
two operations share a response schema — swapping `updateExpense` and `deleteExpense` typechecks
cleanly and sends `DELETE` when the user edits an amount (`API-12`). Testing the container also
produced **GAP 14**: the hazard its doc comment says the module exists to prevent is no longer
reachable, because `authorize.ts` closed it one layer down.

**`GAP 2`'s known consequence turned out to reach two layers further than `GAP 2` recorded, and
that is GAP 15.** GAP 2 settled that a sync-path category delete reassigns nothing server-side,
chose that branch for good reasons, and named the state a client leaves behind when it dies between
the category push and the expense pushes. What nothing measured until now is what that state costs.
The server then serves an `Expense.categoryId` the client provably cannot resolve — the category is
absent from `GET /v1/categories` for being a tombstone — against an `openapi.yaml` description that
calls the field "always a live category". And the tombstone itself becomes **un-prunable for the
life of the account**: `pruneTombstones` leaves a category whose expenses still exist "for the next
run", which converges for a *tombstoned* expense and never for a **live** one, so the 90-day
horizon does not apply to it. `SYNC-41`–`SYNC-46` carry it, with `SYNC-44` and `SYNC-45` expected-fail.
The two cases that pass are there to constrain the fix: both obvious repairs are ruled out by
measurement, and §11's GAP 15 entry says which case each one breaks.

**The two implementations had never met in one process, and now they do — `API-13`–`API-18`.**
Every suite in this repo tests one side of the client/server seam with the other side faked: the
backend files answer hand-written request bodies through supertest, and the mobile files answer
hand-written response bodies through an injected `fetchImpl`. Both can be green while disagreeing
with each other, because nothing built a request with one and parsed it with the other. Six new
cases boot the real app on an ephemeral port and drive the real transport and client against it
through the global `fetch`. **No defect at the seam** — which is the result, and it is now a tested
result rather than a lucky one. Two things came out of it anyway: the access token is not unique per
session (`API-15`), and the seam cannot reach `api/authorize.ts` at all, which is **GAP 16**.

**The pruner's own entry point is now executed** rather than only unit-tested around. `pnpm prune:tombstones` is
the sole caller of `pruneAllTombstones` and therefore the only thing that bounds the largest table in
the schema, and no backend case loaded it. It is sound in both directions — see the
commands and results recorded in §2.

**The shape the mobile client actually pushes had never been pushed, and that is GAP 17.** Every
case in §8 and every case in `backend/tests/sync.convergence.test.ts` sends **one item per row per
device** — the coalescing client `02-offline-and-sync.md` §2 rule 2 describes. The landed client
appends an outbox entry per edit instead, deliberately and with a test of its own, so a user who
edits one expense twice offline pushes two items for one row. §8.10 pushes that shape against the
real server: a conflict then resolves **per field**, and `SYNC-48` ends with the server holding one
device's amount beside the other device's note — a row that existed on neither device. Convergence
survives (`SYNC-50`); what differs is which of the user's edits do. The finding came from re-reading
a Result this plan had already recorded: `SYNC-04` says three edits leave three outbox entries,
under a case titled "coalesces instead of queueing twice", and nobody had noticed the contradiction
— including whoever wrote it down.

**The contract's conventions list had never been read adversarially, and it is self-contradictory —
GAP 19.** Every gap before this one came out of a schema, a design rule, the landed code, or a
result this plan had already recorded. GAP 19 came out of four sentences of prose about how the API
is permitted to change. `openapi.yaml` says responses are *not* closed and that clients should
"ignore fields you do not know"; `docs/api/README.md` says a new optional field is a fine additive
change inside `/v1`; every response schema in that same document sets `additionalProperties: false`;
and the client parses every success body with a `z.strictObject`. `API-20`–`API-24` add one key to
an otherwise-documented body and drive the real client: the expense list, the sync pull on the
envelope *and* nested in a row, and a push result all reject it. So the one change the contract
calls safe would stop **every installed app** from working. `API-24` bounds that — the refresh
failure is not an `ApiRequestError`, so the session survives and the local database is untouched, and
no user's unsynced work is lost. Patching the client to ignore unknown keys leaves all 208
pre-existing mobile cases green, which is how unpinned this was: the two existing shape-error cases
send a *missing* field and a *malformed* one, and neither is the additive case.

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
| Integration | `vitest` in `backend/`, driving the **mobile** client over real HTTP against the real app on an ephemeral port | The join: URL and query construction, the `Bearer` header, the correlation id, a real keyset cursor, a 204 with no body. `API-13`–`API-18` |
| E2E    | The app driven on a simulator/emulator, plus at least one physical device     | The flows a user performs, and every case whose precondition is "aeroplane mode"                                              |
| Manual | Scripted, against the §12 matrix                                              | Accessibility, dynamic type, Reduce Motion, and anything needing a real radio                                                 |

### The API layer shares one database, and it truncates between tests

`backend/vitest.config.ts` runs test files one at a time, because every file shares the single
Postgres test database and truncates it between tests. The consequence for a tester is that two
**concurrent** `vitest` invocations are not safe either — one wipes the other's rows mid-assertion
— and that cannot be worked around from the shell: `loadBackendEnv()` loads `backend/.env` with
`override: true`, so an exported `TEST_DATABASE_URL` is ignored. That override is deliberate and
argued in `src/loadEnv.ts`; the point here is only that the lever is the `.env` file, not the
environment. Verified 2026-10-09: an exported `TEST_DATABASE_URL` naming a different `_test`
database was discarded and the run still went to `expense_tracker_test`.

So: one API-layer pass per machine at a time. If two people — or two agents in one workspace —
need to run the suite simultaneously, one of them edits `backend/.env` first.

### Concurrency is a dimension, not a layer — executed 2026-10-11

Two requests in flight at once is the only way to reach several deliberately-written code paths,
and it needs no new tooling: `Promise.all` over `supertest`, plus `getPrisma().$transaction` to hold
a write uncommitted on one connection while a request runs on another. `fileParallelism: false`
and the truncate-between-tests rule are unaffected — the concurrency is *within* one test.

What this buys, and what it does not:

- **Reaches** the push's `LostCreateRace` retry (`sync.idempotency.test.ts`, both documented
  outcomes) and the revision counter's row lock (§8.11). Neither is reachable sequentially.
- **Does not reach** `readPage`'s `RepeatableRead` snapshot, measured — see **GAP 18**. The window
  is the gap between two queries on one connection.
- **Holding a transaction open across an HTTP request** needs Prisma's `timeout` and `maxWait`
  raised from their 5-second defaults, or the held transaction expires mid-case and the failure
  looks like a product defect rather than a harness limit.
- **A walk against a moving database must sample "is the writer done?" before each request, not
  after.** Sampling after lets the writer finish during the round trip, so an empty page read
  before its last commit reads as "caught up for good". That cost me a false failure in `SYNC-55`;
  it is written into the case.

### The integration layer, and the two things it cannot see — executed 2026-10-10

`backend/tests/integration.mobileClient.test.ts` boots `createApp()` on an ephemeral port with
`node:http` and drives `mobile/src/api/{transport,client,errors}.ts` against it through the global
`fetch`. It runs inside the backend's own vitest project, so it inherits the one-file-at-a-time rule
and the truncating database above: no extra setup, and `pnpm test` already runs it.

Two limits are worth writing down, because both look like coverage a reader would otherwise assume.

**It cannot exercise the client's strict response parsing.** The client parses every body against
the `shared/` schema, so an undocumented server field is a `ResponseShapeError` on a device — but
`src/http/respond.ts` parses the same body against the same schema *before sending* and throws,
which arrives as a `500`. Probed by making `toWireCategory` emit a non-ISO `createdAt`: 182 backend
cases failed, every one of them on a 500, and none of them on a response-shape failure in the
integration file. That guard is `validateResponses: !isProduction`, so in production it is **off**
and the client's parse is the only check left — which is why that path belongs in the mobile suite's
scripted-transport cases, where the server can be made to answer anything. **That is now done**:
`API-20`–`API-24` in `mobile/tests/api/responseForwardCompat.test.ts`, and they produced GAP 19.
Note what the two layers divide between them — the integration layer proves the server does not
*accidentally* emit an undocumented field, and the scripted layer proves what happens when it does
so *deliberately*, which is the version-skew case no amount of monorepo discipline prevents.

**It cannot reach `api/authorize.ts`**, the 401 interceptor — and the reason is a typecheck one, not
a runtime one. A *type-only* import of `SessionController` puts `auth/session.ts` into the backend's
TypeScript program, which pulls `auth/tokenStore.ts` → `expo-secure-store` → `expo-modules-core` →
`react-native` → `@types/jsdom`, which references `lib.dom`; with the DOM globals loaded,
`setTimeout` in `backend/src/server.ts` returns a `number` with no `unref` and the backend fails its
own typecheck in two files nobody touched. Traced with `tsc --explainFiles`. Filed as **GAP 16**;
`API-19` is the case that lands when it is fixed. Until then the token is attached by a four-line
`withToken` wrapper in the test file, and the interceptor's own choreography stays covered where it
already is — `mobile/tests/api/authorize*.test.ts`.

### The pruner is a script, not a route — executed 2026-10-10

`pnpm prune:tombstones` is the only caller of `pruneAllTombstones`, which makes it the only thing
that bounds `sync_mutations`, the one table in the schema with no other ceiling (GAP 3). No backend
case loads it: the suite exercises the function and nothing had ever started the process. It is
sound in both directions, and these are the commands, because a tester should not have to rediscover
how to redirect it:

```sh
# Success. Runs against expense_tracker_test; the logger is 'silent' under NODE_ENV=test,
# so LOG_FORMAT is what makes the result visible at all.
cd backend && NODE_ENV=test LOG_FORMAT=json npx tsx src/scripts/pruneTombstones.ts
# -> two info lines ({users,expenses,categories,ledgerEntries} and the same plus ms), exit 0

# Failure. dotenv resolves '.env' from the CWD, so running from a directory with its own
# .env is how the target is redirected without touching the repo's file -- the exported
# variable is ignored, per the note above.
mkdir /tmp/prune-fail && cd /tmp/prune-fail
# Keep the real credentials and change only the database name, so the failure under test is
# "the target is gone" (3D000) and not "the password is wrong" (28P01) -- both exit 1, but
# only the first is the one a scheduled job actually meets.
printf 'DATABASE_URL="<backend/.env DATABASE_URL, database renamed>"\nJWT_SECRET=<32 chars>\n' > .env
NODE_ENV=test LOG_FORMAT=json npx tsx <abs path>/backend/src/scripts/pruneTombstones.ts
# -> one error line carrying Postgres 3D000, exit 1
```

The exit code is the part worth having checked. A scheduled job's only alarm is its status, and a
pruner that logged its failure and still exited 0 would leave the ledger growing with a green
cron history. It exits 1.

The success run also shows GAP 15's reporting half without any fixture at all: the two lines carry
`{users, expenses, categories, ledgerEntries}` and **no `categoriesRetained`**. That is the only
output an operator ever sees from this job, and it is the field that would tell them an account is
stuck. `SYNC-45` asserts it at the function level; this is the same thing at the process level.

One thing a reader should not conclude from the success run: it proves the entry point starts,
connects and disconnects, not that pruning works — that is `SYNC-13`, `SYNC-39`, `SYNC-40` and
`SYNC-44`. And note the deployment caveat carried from GAP 3: nothing schedules this yet
(`b4f49b91`), so in a deployed environment the ceiling is not in place until that lands.

### The mobile suite prints a worker-teardown warning. It is not a failure — diagnosed 2026-10-10

Every `pnpm test` of `mobile/` ends with `A worker process has failed to exit gracefully … Try
running with --detectOpenHandles`. All cases pass. A tester seeing it for the first time should not
chase it, and should not take it as a leak in whatever file they just added, so the evidence is
written down here once:

- It appears **only when jest uses a worker pool**. `--maxWorkers=2` and the default both show it;
  `--runInBand` never does. So the handle is in a worker, not in the main process.
- The warning's own advice is a dead end: `--detectOpenHandles` implies `--runInBand`, which is the
  one mode that does not reproduce it.
- It is **not** an unclosed `node:sqlite` handle. Every `createTestDatabase()` in the suite is
  matched by a `close()`, and the six pure-SQLite files pair together cleanly.
- Bisected to `tests/db/hooks.test.tsx`, then to a **16-line reproducer with no app code in it**:
  mounting a `useQuery` observer inside a `QueryClientProvider` via `renderHook` is enough. Neither
  half alone does it — `renderHook` with a plain `useState` hook is clean, and a `QueryClient`
  driven with no React at all is clean.
- No test-side teardown closes it: `queryClient.clear()`, `queryClient.unmount()` and an explicit
  `unmount()` of the tree were each tried, together and separately, and the warning survives all of
  them.

So it is an environment/library interaction (TanStack Query + RNTL under `jest-expo`), not a defect
in this suite or in the app, and not something a test author can fix. It still matters once CI
exists, because a force-exited worker is the shape a flaky run takes: the lever is
`--runInBand` for the mobile project, which costs wall-clock and should be a deliberate choice.
Filed at low severity for that decision rather than for a fix.

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
- **Expect** The three expenses **survive**. The forced clear calls `discard()`
  (`mobile/src/auth/session.ts`), which clears `expo-secure-store` and publishes `anonymous`;
  it never touches SQLite. So Welcome shows the expired banner, the `categories` / `expenses` /
  `outbox` tables are identical before and after, and the three rows still report `pending: true`
  via `countPendingRecords`. After re-login **as the same user** the outbox drains and all three
  reach the server with their original `clientMutationId`s.
- **Why this is the right outcome** It is the branch `02-offline-and-sync.md` §5.3 argues for on
  the analogous resync path: "a stale-but-intact local database is strictly better than a clean
  one missing the user's work." The forced path is reached by a user who has been offline past the
  60-day window — the one most likely to be holding unsynced writes — so a wipe here would
  destroy data with no dialog. It does not wipe. **This case was previously parked on GAP 4;**
  the landed client settles the data-loss half of that gap in the safe direction. What is *not*
  settled is re-login as a **different** user — see `AUTH-19`, which is where the real defect is.

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

### AUTH-18 — Logout wipes the local database, as the design says it does

- **Layer** Unit + E2E
- **Pre** `F-MONTH`, logged in. **Two local expenses are in the outbox and have never reached the
  server**, so the confirm dialog's lossy-path copy is the one that applies
- **Steps**
  1. Settings → Log out, and read the dialog body before confirming
  2. Confirm
  3. After landing on Welcome, inspect the SQLite file directly (`expense-tracker.db`)
- **Steps (unit)** Call `signOut()` on a controller built over a seeded database, then assert on
  the table contents
- **Expect** The dialog body reads `Changes that have not synced yet will be lost.`, and after
  confirming, `categories`, `expenses` and `outbox` are all empty and the `meta` row recording the
  store's owner is gone — unowned, not reassigned, because nobody is signed in. That is
  `04-expense-list.md` §Behaviour rule 14 (line 150): logout "revokes the token, clears secure
  store, **wipes the local database**".
- **History, because the expectation here inverted** Until `b1f7d7f` this case was expected to
  FAIL: `signOut()` routed through the same `discard()` as the forced clear and cleared only the
  token store, so step 1 warned the user their unsynced changes would be lost and step 3 proved
  nothing was. Harmless in isolation and in the user's favour — but the rows it failed to clear
  were what `AUTH-19` then handed to the next account, so the two were one fix. Closed by making
  logout match the design rather than by softening the dialog copy. **Re-tested and verified**
  against `mobile/tests/auth/sessionTeardown.test.ts`.
- **The ordering it must keep** Tokens are cleared first, rows second. The user's contract with
  Log out is "I am out", so a failed `DELETE` must not be what keeps them signed in; and leftover
  rows from a failed wipe are then unowned, which `AUTH-19`'s adopt step deletes before anything
  can read them.

### AUTH-19 — A second user on the same device inherits the first user's data

- **Layer** E2E
- **Pre** Two accounts: `a@x.com` with at least three expenses and a renamed category, and
  `b@x.com` **freshly signed up, holding only its six seeded categories**. One device
- **Steps**
  1. Log in as `a@x.com`, let the outbox drain fully, and note the month total
  2. Log out
  3. Log in as `b@x.com` on the same device, without reinstalling
  4. Read Home and Settings → Categories
- **Expect** `b@x.com` sees an empty month and exactly six seeded categories. Nothing of
  `a@x.com`'s is reachable from any screen.
- **History, because this is the defect `TVO-16` was filed for** Until `b1f7d7f`, `b@x.com` saw
  **`a@x.com`'s expenses, `a@x.com`'s month total and `a@x.com`'s renamed category**: the local
  schema had no `userId` column on any table (`migrations.ts` v1), `openLocalDatabase()` opened one
  fixed file regardless of who was signed in, and nothing cleared it on a session change. The root
  cause was one level up — the client never persisted *whose* data it held, so a user change was
  not detectable even if something had wanted to react to it.
- **How it was fixed, which decides what to re-test** Not by partitioning the store per user but by
  stamping it with an owner (`meta.ownerUserId`, schema v2) and wiping it when a session starts
  under a different one. So the thing to re-test is not a `WHERE userId = ?` on each query — there
  deliberately isn't one — but that the wipe runs, and runs *before* the authenticated session is
  published. A store adopted any later has already let the tab bar read another account's rows on
  its first frame. **Re-tested and verified**; `sessionAtomicity.test.ts` asserts the read path the
  screens actually use, so a later change back to partitioning cannot pass silently.
- **The worse half, once the drain lands** Repeat with step 1 ending **offline**, so `a@x.com`
  leaves undrained outbox entries. Before the fix those entries carried no user id either, so the
  first sync pass after `b@x.com` logged in would have pushed `a@x.com`'s expenses **under
  `b@x.com`'s bearer token** — the server is not at fault, it scopes every row to the authenticated
  user and would have faithfully filed one account's spending into another's. There is still no
  mobile sync engine (no `mobile/src/sync/`), so this half was **latent, not live**, and the fix
  landed before the drain did. Re-run it as written the day the drain ships.
- **Why it is here and not only in a bug report** It was the case that had to stay red until the
  fix landed and go green after, and it is the regression the fix is most likely to reintroduce —
  by any later change that reaches the database before the session is settled. `AUTH-20` and
  `AUTH-21` cover the two ways the landed fix can still be defeated.

### AUTH-20 — A sign-in that cannot store its tokens has already wiped the previous user's work

- **Layer** Unit (`mobile/tests/auth/sessionAtomicity.test.ts`)
- **Pre** A seeded store owned by `USER_A` holding one category and one expense, both still in the
  outbox and never seen by the server. A session controller whose token store **fails to write**
  — the device's keystore is unavailable
- **Steps**
  1. `signIn()` as `USER_B`
  2. Assert the call rejects, and that the snapshot is `anonymous`
  3. Read the category list, the pending count and the store's owner
- **Expect** `USER_A`'s category and both outbox entries are **still on disk**, and the store is
  still owned by `USER_A`. `USER_B` never got a session, so nothing should have been destroyed on
  their behalf.
- **Actual — expected to FAIL** `signIn()` calls `localStore.adopt()` before it writes the tokens,
  so by the time the write fails `USER_A`'s rows are already deleted and the store is already
  stamped `USER_B`. A login that *failed* silently destroyed a different user's only copy of their
  unsynced work, and left the store claiming an owner who has no session.
- **Why this is worth a case and not a shrug** `session.ts` claims the opposite in a comment on
  this exact ordering — "a failure here leaves the user anonymous with their predecessor's data
  untouched". A stated safety property the code does not have is worse than an unstated one,
  because the next reader stops checking. And the outcome is the one `AUTH-12` and
  `02-offline-and-sync.md` §5.3 rank above every other failure in this area: silent, unrecoverable
  loss of the user's own writes. `expo-secure-store` writes do fail in the field — a locked
  keystore, a full disk, Android keystore corruption after an OS upgrade — so this needs no process
  kill to reach.
- **Candidate fix, verified** Write the tokens, then adopt, then publish `authenticated`, clearing
  the tokens again if the adopt fails. The property `AUTH-19` depends on is preserved — nothing is
  published before the store is safe to read — and the destructive step leaves the failure path.
  Applied locally: this case and `AUTH-21` turned red, the other 39 auth cases stayed green, then
  reverted.

### AUTH-21 — A half-written session reads back as one user holding another user's tokens

- **Layer** Unit (`mobile/tests/auth/sessionAtomicity.test.ts`)
- **Pre** Secure store holding a complete session for `USER_A`
- **Steps**
  1. Write a session for `USER_B` with the **refresh-token write failing** (which of the three
     values fails is incidental; that they are three separate writes is the point)
  2. Read the session back
- **Expect** One of three states, none of which can mislead anyone: the write landed whole, it did
  not land at all, or the half-written session is rejected on read as no session.
- **Actual — expected to FAIL** It reads back as `userId: USER_B` holding **`USER_A`'s refresh
  token** — a session that is `USER_B` on the device and `USER_A` at the server. `write()` fires
  three independent `setItemAsync` calls in parallel and `read()` reassembles whatever survived.
- **Why it re-opens `TVO-16` from the other side** On the next launch `initialize()` adopts
  `USER_B`, finds the store already theirs, keeps it, and publishes an authenticated session. The
  first refresh rotates `USER_A`'s refresh token into a valid `USER_A` pair, and the pull writes
  `USER_A`'s expenses into a store stamped `USER_B`. The wipe cannot help: it already ran, for the
  right user, against the wrong tokens.
- **Candidate fix, verified — and the first one I tried was wrong** Keeping the owner *inside* the
  refresh-token value makes the two unable to disagree, and it works, but it also reddens three of
  the token store's own cases because it abandons the deliberate one-key-per-value layout. The
  cheaper fix holds that layout: **delete the owner key first and write it last**, so any half-done
  write reads as no owner, hence no session — fail-closed, one extra login, nothing lost, and the
  rows left behind are unowned so the next adopt clears them. Verified: the tripwire turns red and
  all 39 other auth cases stay green.
- **A note on how this case is asserted** It checks the outcome against a set of acceptable states
  rather than asserting the specific fix. My first version asserted the session was non-null, which
  **rejected the fail-closed fix** — the better of the two — and would have sent Mobile Dev to
  re-do correct work. A tripwire that only accepts its author's preferred fix cries wolf.

### AUTH-22 — A request in flight when the user logs out surfaces its own 401

- **Layer** Unit (`mobile/tests/api/authorizeSessionChange.test.ts`)
- **Pre** A session for `USER_A`. One authorized request (`POST /v1/sync`) sent and still away
- **Steps**
  1. While the request is in flight, call `signOut()`
  2. Let the request's `401` arrive
- **Expect** The original `401` is returned to the caller, the request is **not** retried, and no
  refresh is attempted — there is no refresh token left to rotate, so trying would be a wasted
  round trip against a session that is deliberately gone.
- **Result — PASSES** One attempt, status `401`, zero refresh calls.
- **Why it is here when it already passes** It is the branch a fix for `AUTH-23` is most likely to
  break. A guard that refuses to retry after *any* session change must still surface the real
  failure here rather than inventing an empty success — interceptor rule 4, "never swallow the
  401".

### AUTH-23 — A request in flight when a second user logs in is retried under their token

- **Layer** Unit (`mobile/tests/api/authorizeSessionChange.test.ts`)
- **Pre** A session for `USER_A` holding access token `access-a`. One authorized request sent and
  still away
- **Steps**
  1. While the request is in flight: `signOut()`, then `signIn()` as `USER_B` (token `access-b`)
  2. Let the first request's `401` arrive
- **Expect** No request carrying this body is sent under `access-b`. Either outcome is acceptable:
  the original `401` is surfaced, or the retry fails closed without a usable token.
- **Actual — expected to FAIL** Two attempts, tokens `["access-a", "access-b"]`, **zero** refresh
  calls, final status `200`. The retry goes out under `USER_B`'s token.
- **Root cause** `ensureFreshAccessToken` decides a refresh is unnecessary by comparing the stale
  token against the stored one. The comment above that check names one reason they can differ — a
  concurrent rotation — and for that reason the behaviour is right. A different user signing in
  makes them differ too, and takes the same branch. The comparison is on the token *string*; the
  session's *identity* is not part of it. See GAP 13 / `TVO-20`.

### AUTH-24 — The same defect, from the payload side

- **Layer** Unit (`mobile/tests/api/authorizeSessionChange.test.ts`)
- **Pre** As `AUTH-23`, with the in-flight request a push whose body was built from `USER_A`'s
  outbox
- **Steps** As `AUTH-23`, then inspect the body of the retried request
- **Expect** `USER_A`'s batch is never sent under `USER_B`'s token.
- **Actual — expected to FAIL** The retry replays the body **verbatim** —
  `{"items":["USER_A_DATA"]}` under `access-b`.
- **Why this half is stated separately** It is what makes GAP 13 a leak rather than a nuisance. A
  wrong `GET` hands the caller the wrong data; a wrong write files one account's spending into
  another's, and the server is not at fault — it scopes the write to the authenticated user, as it
  should. The local wipe `signOut` performs **cannot defend this**: the batch was serialised into
  the request before the wipe ran and is held in memory, not in SQLite. That is the same leak as
  `TVO-16` arriving through a door the wipe does not cover.
- **Reachability** Latent until a screen or the sync engine issues an authorized write (`TVO-11`,
  `TVO-13`). `authorize.ts` is the single interceptor all of them pass through, which is why it is
  cheaper to fix before they depend on it. One fix closes this and `AUTH-23` together.

### AUTH-25 — Re-login as the same user never borrows a foreign token

- **Layer** Unit (`mobile/tests/api/authorizeSessionChange.test.ts`)
- **Pre** A session for `USER_A`. One authorized request sent and still away
- **Steps**
  1. While the request is in flight, `signIn()` as `USER_A` again with a new pair
  2. Let the `401` arrive
- **Expect** No request ever carries a token belonging to another account. Nothing more.
- **Result — PASSES** Two attempts, tokens `["access-a", "access-a-relogin"]`.
- **Why it asserts so little, deliberately** The account has not changed, so retrying under the new
  token is defensible and so is failing closed. An epoch-counter fix for GAP 13 refuses every
  post-change retry and would fail a case that insisted on the retry. This is the `AUTH-21` lesson
  applied up front: assert the unsafe outcome, not a preferred fix.

### AUTH-26 — A session is never published over a database that has not been adopted

- **Layer** Unit (`mobile/tests/bootstrap/container.test.ts`)
- **Pre** A local database holding one category and **no** `meta.ownerUserId` row — a store
  restored from a backup, or written before the owner was recorded. A token store holding a
  session for `USER_A`
- **Steps**
  1. `createAppContainer({ database, tokenStore, transport })`
- **Expect** On resolve, `meta.ownerUserId` is `USER_A` and `categories` is empty: an unowned store
  with rows in it is treated as somebody else's. `session.getSnapshot()` is
  `{ status: 'authenticated', expired: false }`, and `container.database` is the handle passed in.
- **Result — PASSES**
- **Why this is not a duplicate of `AUTH-19`** `AUTH-19` proves the *store* decides correctly;
  this proves the *wiring* reaches that decision. The composition root is the one place TVO-16's
  fix can be undone without a single other test going red — swapping
  `createSqliteLocalStore(database)` for `createMemoryLocalStore()` leaves 205 of the 207 mobile
  cases green. Verified by applying exactly that and watching this case and `AUTH-28` turn red.

### AUTH-27 — The 401 round trip, through the real wiring rather than the parts

- **Layer** Unit (`mobile/tests/bootstrap/container.test.ts`)
- **Pre** A session for `USER_A` with `accessToken: access-a`. A transport that `401`s `access-a`,
  rotates on `POST /v1/auth/refresh`, and answers anything else
- **Steps**
  1. `container.api.getMe()`
  2. Separately, two `getMe()` calls started together
- **Expect** Step 1 makes exactly three requests, in order: `get /v1/me`, `post /v1/auth/refresh`,
  `get /v1/me`. The refresh carries `requiresAuth: false`, no `accessToken`, and the body
  `{ refreshToken: 'refresh-a' }` — the one from the store. The retry carries the rotated
  `access-a2` and resolves. Step 2 produces exactly **one** refresh.
- **Result — PASSES**
- **What it does not prove — [GAP 14]** Not that `publicApi` must be built on the raw transport.
  Wiring `refreshTokens` to the *authorized* client instead — the exact hazard
  `bootstrap/container.ts` says the module exists to prevent — was applied here and changed nothing
  observable: all 105 cases in `tests/api`, `tests/auth` and `tests/bootstrap` stayed green,
  because `authorize.ts` returns early for a route with `auth: false` and the refresh route is one.

### AUTH-28 — A second account signing in wipes the first out of the open database

- **Layer** Unit (`mobile/tests/bootstrap/container.test.ts`)
- **Pre** A container built on a session for `USER_A`, then one category written locally
- **Steps**
  1. `container.session.signIn(authResponseFor(USER_B))`
- **Expect** `meta.ownerUserId` is `USER_B` and `categories` is empty.
- **Result — PASSES**
- **Note** The live half of TVO-16 at the wiring layer. With no stored session at all, the
  container starts `anonymous`, leaves `meta` unclaimed, and sends **nothing** — a cold start of an
  offline-first app talks to nobody, which is also what makes `AUTH-26`'s adoption observable.

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
- **This case cannot fail on `F-FRESH` alone** — `Bills` … `Uncategorized` sort the same way under
  a case-sensitive order, a case-insensitive one, and with or without the default pinned, so the
  fixture agrees with every candidate implementation. `CAT-15` and `CAT-16` carry the seeds that
  tell them apart; run them before trusting a green `CAT-01`. [GAP 12]

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

### CAT-15 — The order is case-insensitive, so a lowercase name is not exiled to the end

- **Layer** Unit (`mobile/tests/db/queries.test.ts`)
- **Pre** A local store holding three live categories named `Bills`, `rent` and `Transport`, all
  pulled rather than locally created
- **Steps** Call `listLiveCategories` and read the names in order
- **Expect** `Bills`, `rent`, `Transport`. The design specifies case-insensitive alphabetical
  order (`07-categories.md` §1 state `default`), which is also what the backend already does for
  `GET /v1/categories` and documents the reason for.
- **Result — fails.** The query returns `Bills`, `Transport`, `rent`: `ORDER BY c.name` uses
  SQLite's default BINARY collation, so every capital letter sorts before every lowercase one.
  Expected-fail until GAP 12 is fixed. [GAP 12]

### CAT-16 — The default category is pinned last whatever it is called

- **Layer** Unit (`mobile/tests/db/queries.test.ts`)
- **Pre** A local store holding `Bills`, `Uncategorized` (`isDefault`) and `Vacation`
- **Steps** Call `listLiveCategories` and read the names in order
- **Expect** `Bills`, `Vacation`, `Uncategorized`. The `isDefault` row is pinned last regardless
  of where its name would sort, because the list's last row is also the one with no swipe action
  (§4 rule 4) and a protected row in the middle of the list reads as an arbitrary exception.
- **Result — fails.** The query returns `Bills`, `Uncategorized`, `Vacation`: nothing pins the
  default. The defect is invisible on the seeded set, where `Uncategorized` sorts last by
  accident, and surfaces on the first category a user adds that sorts after it. Expected-fail
  until GAP 12 is fixed. [GAP 12]

### CAT-17 — `pending` is derived from the outbox, and only for the row the user edited

- **Layer** Unit (`mobile/tests/db/queries.test.ts`)
- **Pre** A local store holding a pulled `Bills`
- **Steps**
  1. Create a category locally through `applyLocalMutation`; read the list
  2. Clear the outbox; read the list again
  3. Create an **expense** against `Bills` locally; read the list again
  4. Tombstone `Bills` locally; read the list and `countPendingRecords`
- **Expect** Step 1 reports `pending: true`, step 2 `pending: false` — the outbox is the single
  source of truth for the state, derived per read rather than stored as a column that could fall
  out of step (`02-offline-and-sync.md` §2). Step 3 leaves `Bills` **not** pending: the expense's
  outbox entry names the category in its `fields`, not in `recordId`, and a clock glyph on a
  category the user never touched would be wrong. In step 4 the category disappears from the list
  while its row stays in the table, and it still counts as **1** pending record — the undelivered
  delete is exactly what is pending.
- **Result — passes**, all four steps.

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

### SYNC-04 — [SUPERSEDED TITLE] Editing a pending row queues a second entry

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
- **Result — the Unit half passes, and the case's own title was wrong.** Three local mutations of
  one row leave **three** `outbox` rows, and `countPendingRecords` returns `1`, so the pill's `{n}`
  is already distinct-records rather than entries. That result was recorded here before anybody
  noticed it contradicts the title and the design rule the title came from: three entries is not
  coalescing. `mobile/src/db/write.ts` appends by design and
  `mobile/tests/db/write.test.ts` pins the append, while `02-offline-and-sync.md` §2 rule 2 says
  the opposite. The title is left standing with this flag rather than quietly rewritten, because it
  is the design rule's wording and the decision is `TVO-24`'s. See **GAP 17** and §8.10, which
  measure what the append costs on the wire. The expectation above still holds in full — the pill
  reads `1 pending` and the server does end up with the final amount and note (`SYNC-47`). The E2E
  half still needs a driven app (GAP 9).

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
- **Expect** **Unparked — the window is 90 days**, the same horizon as tombstones, swept by the
  same job (`9f2edc8`, written down in `docs/PLAN.md` §4). Assert the boundary in both directions:
  a replay of `M` whose ledger row is 89 days old returns the **recorded** outcome and applies
  nothing a second time; a replay whose row is 91 days old is processed as a **new** mutation,
  because the id has been forgotten. The second half is a behaviour change rather than a cleanup
  and is the reason the number is in the contract: past the window a delete-then-recreate under the
  same id applies twice, and an `invalid` result a client was replaying in order to re-read stops
  being replayable. Both are acceptable at 90 days and neither would be at 90 minutes.
- **Why one number and not two** A client resyncing at the tombstone horizon is exactly the client
  most likely to be replaying mutation ids from before it. If the ledger expired first, that client
  could replay an id the server has forgotten while the deletes it raced against are still on file.
- **Was** `[BLOCKED-BY-GAP 3]`, because a boundary cannot be asserted before a window exists. See
  `SYNC-39` / `SYNC-40` for the defect that made it unassertable and the fix that closed it.

### SYNC-39 — A ledger entry past the horizon is pruned, so `sync_mutations` has a ceiling

- **Layer** API (automated: `backend/tests/sync.idempotency.test.ts`)
- **Pre** `F-FRESH`
- **Steps**
  1. Push one category with `clientMutationId: M`
  2. Backdate that ledger row's `created_at` to 91 days ago — one day past the tombstone horizon
  3. Run `pruneTombstones(db, userId)`
- **Expect** The ledger row is deleted, and the returned `ledgerEntries` count reports it. The
  sweep ages on `created_at` — the ledger has no `deleted_at` to age on — and is ordered last
  inside the per-user transaction, since no foreign key, revision or pull depends on it.
- **Was, until `9f2edc8`** Expected to FAIL: the row survived. The pruner issued two `DELETE`s,
  against `expenses` and `categories`, and none against `sync_mutations`; `created_at` was written
  by the schema default and read by nothing, so the table took one row per mutation per user and
  never gave one back. Filed for operations rather than correctness — remembering every id forever
  de-duplicates everything, so no retry was ever double-applied and `SYNC-09`–`SYNC-12` held
  throughout. **Re-tested and verified** after the fix landed, together with `SYNC-40`.
- **Guard, and now the load-bearing half** A sibling case pushes a row aged 89 days and asserts it
  *survives* the prune. It was vacuous while nothing pruned the ledger and was kept on purpose:
  now that something does, it is the only thing standing between the sweep and over-pruning, which
  would break de-duplication inside the retry window. Leaking rows costs disk; pruning too early
  costs the user their data. It stayed green across the fix.
- **One thing not covered here** The sweep's cost. `9f2edc8` adds `sync_mutations_created_at_idx`
  on `created_at` alone — not user-first, because discovery scans the column across every account
  while the primary key already serves the user-first lookups every push uses. Worth a line in the
  load pass rather than a case: this is the largest table in the schema.

### SYNC-40 — The pruner job finds a user whose only stale rows are in the ledger

- **Layer** API (automated: `backend/tests/sync.idempotency.test.ts`)
- **Pre** `F-FRESH`, with **no tombstone anywhere on the account** — one pushed mutation and
  nothing deleted
- **Steps**
  1. Backdate the ledger row's `created_at` to 91 days ago
  2. Run `pruneAllTombstones()`
  3. Read the returned `users` count
- **Expect** `users` is `1`, and the stale ledger row is gone. `pruneAllTombstones` discovers
  accounts with a `UNION ALL` over all **three** swept tables, and the `sync_mutations` branch is
  load-bearing rather than belt-and-braces.
- **Was, until `9f2edc8`** Expected to FAIL with `users: 0`: discovery covered tombstoned
  `categories` and `expenses` only, so an account that had made mutations but deleted nothing was
  never passed to `pruneTombstones` at all.
- **Why it is separate from `SYNC-39`, which is the whole value of this case** The obvious fix — a
  third `DELETE` inside `pruneTombstones`, *which I recommended myself in two comments before
  writing the test* — closes `SYNC-39` and leaves this one open, and the user it leaves behind is
  the ordinary one: somebody who adds expenses and never deletes a category. Kept as its own case
  asserting only the discovery count, so the two halves go green independently and neither can mask
  the other. The landed fix covers both. **Re-tested and verified.**

### SYNC-41 — A category delete and its reassignments in one batch converge in one round trip

- **Layer** API (automated: `backend/tests/sync.categoryOrphan.test.ts`)
- **Pre** `F-FRESH`, plus a category `C` the user created with two live expenses on it
- **Steps**
  1. Push one batch containing, **listed expenses-first**, both expense reassignments to the
     `isDefault` category and the `deletedAt` tombstone for `C`
  2. Count live expenses still referencing `C`
  3. Run `pruneTombstones` with `now` 91 days on
- **Expect** all three items are `applied`, no live expense still references `C`, and the prune
  collects it (`categories: 1`, `categoriesRetained: 0`). This is the flow `07-categories.md` §4
  rules 6–7 specifies and it is correct today.
- **Why a passing case is worth writing down** It is the case that rules out the first obvious fix
  for GAP 15. "Refuse a category delete while live expenses reference it" would reject **this**
  batch, because `SYNC-42` shows the server applies every category before any expense — so in the
  flow that is working correctly, the delete always runs while those expenses still point at it.
  Listed expenses-first on purpose: a client is not required to order a batch, the server is.

### SYNC-42 — Every category in a batch is applied before any expense

- **Layer** API (automated: `backend/tests/sync.categoryOrphan.test.ts`)
- **Pre** `F-FRESH`, plus a category `C` with one live expense `E`
- **Steps**
  1. Push one batch of two items: the `deletedAt` tombstone for `C`, then an update to `E` that
     repoints it **at `C`** and changes its amount
- **Expect** `C` is `applied`; `E` is a per-record `invalid` with `unknown_category` inside the
  `200`. The ordering is `orderBatch`'s, and it is the same property that lets an expense created
  offline against a category created offline sync in one round trip (`SYNC-21`).
- **Note** This is the constraint, not a defect. It is recorded as its own case because GAP 15's
  severity and its available fixes both turn on it.

### SYNC-43 — The server serves an expense whose `categoryId` the client cannot resolve

- **Layer** API (automated: `backend/tests/sync.categoryOrphan.test.ts`)
- **Pre** `F-FRESH`, plus a category `C` with one live expense `E`
- **Steps**
  1. Push **only** the `deletedAt` tombstone for `C` — the client that dies, or is wiped, between
     the category push and the expense pushes
  2. `GET /v1/categories` and `GET /v1/expenses`
  3. `GET /v1/sync?since=0` as a device syncing from scratch
- **Expect** `C` is absent from the category list (it is a tombstone), and `E` is still served with
  `categoryId = C` by both the REST list and the pull. The reference is unresolvable by any client.
- **Observed 2026-10-10, and it contradicts the contract** `openapi.yaml`'s `Expense.categoryId`
  reads "Always a live category of the same user; reassigned to the `Uncategorized` default if its
  category is deleted". Both halves are false on this path. See GAP 15.
- **Why this case asserts the behaviour and not the guarantee** The resolution here is expected to
  be the contract's wording, because the two code-level repairs are ruled out by `SYNC-41` and
  `SYNC-46`. An expected-fail asserting "always live" would encode a fix nobody should make and
  would stay red for good — the `AUTH-21` mistake. It still earns its place: if someone does make
  the server reassign, this case reddens and forces the conversation rather than silently trading
  one defect for a worse one. **Re-point it when GAP 15's prose is settled.**

### SYNC-44 — [EXPECTED FAIL] The orphaned category tombstone is never collected

- **Layer** API (automated: `backend/tests/sync.categoryOrphan.test.ts`)
- **Pre** As `SYNC-43` — a category tombstoned through the sync path with a live expense on it
- **Steps**
  1. Run `pruneTombstones` with `now` 91 days on
  2. Run it again with `now` **4000 days** on
  3. Read the `categories` row directly, and `GET /v1/sync?since=0`
- **Expect** the row is gone and no full pull carries it.
- **Expected to FAIL today** The row survives both runs and is delivered in every full pull for the
  life of the account. `pruneTombstones` leaves a category whose expenses still exist "for the next
  run rather than cascading" — correct for a **tombstoned** expense, which is collected at its own
  horizon so the next run converges, and never true for a **live** one, which does not age out.
  The 90-day horizon does not bound this row at all.
- **Why two runs, the second eleven years out** One prune cannot distinguish the deferral the
  design intends from never converging, and that distinction is the entire finding.
- **Why it asserts only the end state** An earlier draft asserted `categoriesRetained === 1` at the
  horizon as a precondition — which a working repair makes false, so the case could not have gone
  green against the fix it is asking for. Caught by applying the candidate fix rather than
  reasoning about it.

### SYNC-45 — [EXPECTED FAIL] The scheduled prune cannot report a retained category

- **Layer** API (automated: `backend/tests/sync.categoryOrphan.test.ts`)
- **Pre** As `SYNC-43`
- **Steps**
  1. Run `pruneTombstones` for the user and read `categoriesRetained`
  2. Run `pruneAllTombstones()` — the aggregate `src/scripts/pruneTombstones.ts` actually calls —
     and look for the same field
- **Expect** both report it.
- **Expected to FAIL today** `PruneResult.categoriesRetained` exists on the per-user result and its
  only caller in the codebase drops it. The scheduled job's one log line is
  `{users, expenses, categories, ledgerEntries}`, so a stuck account is indistinguishable from a
  quiet one.
- **Why it is separate from `SYNC-44`** Plumbing the field through and making the prune converge
  are different changes; a combined case would go green on the first and hide the second — the
  `SYNC-39`/`SYNC-40` lesson. It asserts the field is *reported*, not that anything is retained: a
  repair that converges leaves nothing to retain, and an operator still needs the number to read
  zero rather than be absent.

### SYNC-46 — The reassignment pushed late is still accepted, and the prune then converges

- **Layer** API (automated: `backend/tests/sync.categoryOrphan.test.ts`)
- **Pre** As `SYNC-43`
- **Steps**
  1. Push the expense reassignment to the `isDefault` category, carrying a **newer** client
     `updatedAt` and also a corrected `amountMinor`
  2. Run `pruneTombstones` with `now` 91 days on
- **Expect** `applied`, the corrected amount survives on the returned record, and the prune then
  collects `C` (`categories: 1`, `categoriesRetained: 0`).
- **Why this is the case that keeps GAP 15 short of data loss** The orphan is recoverable by any
  client that comes back and follows through; it is permanent only if none ever does. This is also
  the case that rules out the second obvious fix: had the server reassigned at delete time with its
  own `now`, this push would come back `conflict_server_wins` and the amount the user corrected in
  the same offline session would be dropped silently — GAP 2's second bullet, which is the reason
  the current behaviour was called the better branch in the first place.

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

### 8.10 One row, several outbox entries in one batch

Defends: nothing in `docs/PLAN.md` — and that is why this subsection exists. Every other case in
§8, and every case in `backend/tests/sync.convergence.test.ts`, pushes **one item per row per
device**. That is the client `02-offline-and-sync.md` §2 rule 2 describes, and it is not the client
that landed: `mobile/src/db/write.ts` appends a fresh `outbox` entry per edit, so a user who edits
one expense twice offline pushes two items for one row, each carrying only the fields that changed
at that moment.

Both shapes were green and nothing had ever pushed the second one. These four cases do. See
**GAP 17**, and `TVO-24` for the decision it needs.

One practical note for whoever writes the next case here: `backend/tests/support/sync.ts`'s
`resultFor` helper throws unless a batch holds exactly **one** result per id, so it cannot read
these batches. That assumption is the coalescing model again, in the test helpers this time — which
is a fair measure of how settled the wrong shape had become.

### SYNC-47 — Two entries for one row both apply, and the row ends at the later one

- **Layer** API (automated: `backend/tests/sync.uncoalescedOutbox.test.ts`)
- **Pre** `F-FRESH`. An expense `E` on the server at `amountMinor: 1000`, `updatedAt = T`
- **Steps**
  1. Push one batch of two `expense` items for `E`: `{amountMinor: 1100}` at `T+10m`, then
     `{note: "lunch with Sam"}` at `T+20m`
  2. Read the row back through `GET /v1/sync?since=0`
  3. Read the user's revision counter before and after
- **Expect** `["applied", "applied"]`. The stored row carries **both** edits — `1100` and the note
  — because the merge is per field, so the second entry does not erase what the first set. Its
  `updatedAt` is the later entry's. The counter advances by **2**: one row's worth of user intent
  costs two revisions and two ledger rows, which is the price of not coalescing and is the half of
  `SYNC-04` that was previously only claimed.
- **Result — passes.** Also the case that pins the within-entity sort end to end: reversing the
  `index` tiebreak in `inApplyOrder` reddens it.

### SYNC-48 — A conflict resolves per field, leaving a row neither device ever had

- **Layer** API (automated, same file)
- **Pre** `F-TWO-DEV` state on the server: expense `E` at `amountMinor: 1000`, `updatedAt = T`.
  Both clocks correct
- **Steps**
  1. The phone, offline, edits the amount at `T+10m` → entry 1, `{amountMinor: 1100}`
  2. The phone, still offline, edits the note at `T+20m` → entry 2, `{note: "from the phone"}`
  3. The tablet edits the amount at `T+15m` and syncs first; the server holds `2200`
  4. The phone reconnects and pushes both entries in one batch
  5. Repeat steps 1–4 on a second row with a single coalesced entry at `T+20m` carrying both fields
- **Expect** Step 4 returns `["conflict_server_wins", "applied"]` — entry 1 is older than the
  tablet's write, entry 2 is newer. The server then holds **`amountMinor: 2200` with note
  `"from the phone"`**: the tablet's amount and the phone's note, a state that existed on neither
  device. Step 5, the coalescing client, returns `["applied"]` and the server holds `1100` with the
  note — row-level last-write-wins, which is what §5.2 describes.
- **Result — passes, and this is GAP 17's finding.** For an expense the hybrid is worse than either
  device winning outright: the note now describes an amount it was never written about. The outcome
  is **not** an ordering artifact — reversing the within-entity sort produces the same row, because
  per-field merge is the cause.

### SYNC-49 — Two entries sharing one millisecond lose the second one's fields

- **Layer** API (automated, same file)
- **Pre** `F-FRESH`
- **Steps** Push one batch of two `expense` items for the same new id with the **same**
  `updatedAt`: a create, then `{note: "the second save"}`
- **Expect** `["applied", "conflict_server_wins"]` and the stored row's `note` is `null`. Ties go
  to the server, and by the time the second entry is judged the server holds what the *first entry
  of the same batch* wrote — so the row's own earlier entry is what beats it. Both results carry
  the authoritative record, so a client following §5.2 ends up correct locally and the note the
  user typed is simply gone: no `invalid`, no retry, nothing to show them.
- **Result — passes.** Reachability is the honest caveat: `applyLocalMutation` reads
  `systemClock()` per mutation, so this needs two saves inside one millisecond — a double-tap on
  Save, or a code path that writes twice without awaiting a tick. Worth pinning because the outcome
  is silent and because a coalescing client cannot reach it at all: one entry cannot tie with
  itself. Note that `mobile/tests/db/write.test.ts` pins **one** instant for the whole file, so
  this is the shape its fixtures produce by default.

### SYNC-50 — Convergence survives the split, but only if every result is written back

- **Layer** API (automated, same file)
- **Pre** As `SYNC-48` through step 4
- **Steps**
  1. Compare the **last** result for the row against the server's row
  2. Compare the `conflict_server_wins` result's record against the server's row
  3. Pull from `since=0`
- **Expect** Step 1: equal — a client that writes back every result in request order converges
  inside the push, which is what makes a conflict cost one round trip instead of two. Step 2:
  **not** equal. That record is the row as it stood when entry 1 lost, and entry 2 of the same
  batch then changed it, so a client that writes back only the conflicted record — the obvious
  reading of "on `conflict_server_wins`, overwrite the local row with the server row" — stores a
  stale row with nothing pending to correct it. Step 3 repairs it.
- **Result — passes.** The finding is a stale window, not permanent drift: convergence itself
  holds. Worth knowing in both directions before `TVO-13` writes the write-back.

---

### 8.11 The pull side, against a database that is still moving

Defends: `syncPullService.ts`'s own ranking — *"Never skip a row. A skipped row is permanent,
silent data loss on the device: the cursor has moved past it and nothing will ever send it
again."* — and `revision.ts`'s two stated consequences.

Every concurrency case already in this suite is **push against push**: `sync.idempotency.test.ts`
races two requests to write the same row, and both halves of the create race are covered there. The
**pull** had never been run against a database that was changing underneath it. That is the
asymmetry this subsection closes, and it matters because the two mechanisms protecting the pull are
both unreachable from a sequential test:

1. `revision_counters` is incremented by `UPDATE ... RETURNING` **inside** the writing transaction,
   so concurrent writers serialise on its row lock and no two rows can share a revision.
2. `readPage` reads both tables from one `RepeatableRead` snapshot, so a write committing between
   the two queries cannot leave a hole in the merged page.

The strong property is asserted across a whole cursor walk rather than on one page (`SYNC-55`):
*every row arrives exactly once, and a revision already delivered is never followed by a lower
one.* A page-at-a-time assertion cannot tell that apart from a cursor that stepped over a row.

Two things this subsection established about the cases themselves, both worth more than the
verdicts:

- **`revision.test.ts`'s non-repetition case cannot fail.** It asserts "hands out strictly
  increasing, never-repeated revisions" from a `for` loop with an `await` in it, and its comment
  says "two rows sharing a revision means one of them can be stepped over". One writer at a time
  can never produce that. Measured: with the counter's `UPDATE ... RETURNING` replaced by a plain
  `SELECT` (no row lock, so two transactions read the same value and both compute the same block),
  **all 6 cases in `revision.test.ts` stayed green** while `SYNC-53` and `SYNC-54` went red. Same
  pattern as `CAT-01`, in the foundation of the sync protocol rather than in a list order.
- **`SYNC-51` cannot fail either, and is recorded as such.** No regression tried against it changes
  its verdict, because MVCC hides an uncommitted counter increment from every reader whatever this
  code does. It characterises Postgres, not the pull. `SYNC-52` is the version that *can* fail, and
  the pair is the point: the cursor rule and the in-transaction rule are independent defences.

See **GAP 18** for the one mechanism here that no black-box case can guard.

### SYNC-51 — A pull overlapping an uncommitted write sees neither the row nor its revision

- **Layer** API (automated: `backend/tests/sync.pullConcurrency.test.ts`)
- **Pre** `F-FRESH`, watermark at 6
- **Steps**
  1. Open a transaction, draw a revision with `nextRevision`, insert an expense stamped with it,
     and **do not commit**
  2. While it is open, `GET /v1/sync?since=6` on another connection
  3. Commit, then pull again from the cursor step 2 returned
- **Expect** Step 2 returns no changes and `nextCursor: 6` — the echoed `since`, strictly below the
  allocated revision, never the counter's value (which the uncommitted increment has already
  moved). Step 3 delivers the row, so the device that polled at the wrong moment is not the device
  that loses it.
- **Result — passes, and cannot do otherwise.** See the note above: this is Postgres' guarantee
  rather than this code's. Kept because it is the hazard `revision.ts` names as the reason a
  timestamp cursor is unusable, and because a reader of `SYNC-52` needs it to see what the
  difference is.

### SYNC-52 — A revision committed ahead of its row does not strand the row

- **Layer** API (automated, same file)
- **Pre** `F-FRESH`, watermark at 6
- **Steps**
  1. Draw a revision with `nextRevision` **in its own transaction**, so it commits alone — the
     violation `revision.ts` requirement 1 forbids ("call this inside the transaction that performs
     the write"). The counter is now at 7 with no row at 7
  2. In a second, still-open transaction, insert the expense stamped 7
  3. While it is open, `GET /v1/sync?since=6`
  4. Commit, then pull from the cursor step 3 returned
- **Expect** Step 3: an empty page with `nextCursor: 6`, **not** 7. Step 4 delivers the row. A
  client that had stored 7 would ask for `> 7` for ever and nothing would send it this row again.
- **Result — passes.** This is the case that shows the two rules are independent: the row survives
  a violation of requirement 1 only because `nextCursor` comes from the page. Reddens when
  `nextCursor` is sourced from `snapshot.lastRevision`.

### SYNC-53 — Concurrent writers for one account each get a distinct revision

- **Layer** API (automated, same file)
- **Pre** `F-FRESH`, watermark at 6
- **Steps**
  1. Issue 10 `POST /v1/expenses` for the same user **in flight at the same time**
  2. Read each response's `revision`, and the counter afterwards
- **Expect** All 10 are `201`. The revisions are 10 distinct values, exactly `7..16` with no repeat
  and no gap, and the counter ends at 16. A repeated revision means a cursor can step over one of
  the two rows permanently — and the `@@unique([userId, revision])` backstop would surface it as a
  `500` on a request that is entirely within spec.
- **Result — passes.** Reddens when the counter's row lock is removed; see the note above for what
  stays green when it is.

### SYNC-54 — One account is not serialised behind another

- **Layer** API (automated, same file)
- **Pre** Two fresh accounts
- **Steps**
  1. Issue 4 concurrent `POST /v1/expenses` for each account, all 8 in flight together
  2. Pull each account from `since=6`
- **Expect** Each account's own four rows are `7, 8, 9, 10` — contiguous from its own watermark,
  with no numbers consumed by the other. A global lock or a shared sequence would still hand out
  distinct revisions, so independence has to be checked separately.
- **Result — passes.**

### SYNC-55 — A client walking the cursor while writes commit receives every row exactly once

- **Layer** API (automated, same file)
- **Pre** `F-FRESH`
- **Steps**
  1. Start a writer committing 18 rows, alternating `POST /v1/categories` and `POST /v1/expenses`
     so both tables advance
  2. Concurrently, walk the documented loop — `GET /v1/sync?since=<nextCursor>&limit=3`, following
     `hasMore` — until the writer has finished *and* the walk is caught up
  3. Drain once more from the final cursor
- **Expect** 24 changes delivered (6 seeded categories + 18), **no id twice**, every written id
  present, revisions ascending across the *whole* walk rather than within each page, more than one
  page involved, and the drain empty.
- **Result — passes.** Reddens when `nextCursor` is sourced from the watermark.
- **Note on stopping.** The walk must sample "has the writer finished?" **before** issuing each
  pull, not after. Sampling it afterwards lets the writer finish during the round trip, so an empty
  page read before its last commit looks like "caught up, and nothing more is coming" and the walk
  stops one row short. My first version did exactly that and the drain assertion caught it — the
  same mistake in the test as the one the protocol has to avoid in the client, and the reason step
  3 is in the case rather than being redundant.

### SYNC-56 — A walk never hands over an expense before the category it references

- **Layer** API (automated, same file)
- **Pre** `F-FRESH`
- **Steps**
  1. Start a `POST /v1/sync` batch creating a category and an expense that references it
  2. Concurrently walk with `limit=1`, and at the moment **each** expense arrives, assert its
     `categoryId` is one already delivered
- **Expect** The assertion holds on arrival, not merely at the end of the walk. The push is one
  transaction and revisions are allocated in dependency order, so the walk sees both rows or
  neither.
- **Result — passes.** This is the ordering half of `openapi.yaml`'s promise that
  `Expense.categoryId` is "always a live category of the same user"; `SYNC-43` and **GAP 15** are
  the half where that promise is false. Reddens when `nextCursor` is sourced from the watermark.

### SYNC-57 — [BLOCKED-BY-GAP 18] The pull reads both tables at the isolation level it claims

- **Layer** API
- **Pre** None — this is a guard on a setting, not on a behaviour
- **Steps**
  1. Read the isolation level `syncPullService.ts` passes to `$transaction`
- **Expect** `RepeatableRead`. Written as a structural assertion on purpose: the behaviour it
  protects — a write committing between the page's two queries — needs a window of roughly a tenth
  of a millisecond to be hit, so any behavioural case for it would be probabilistic, and a case
  that fails a few percent of the time costs more than it buys
- **Why it is parked, and what unblocks it** The level is inline in the call, so there is nothing to
  assert against. Lifting it into an exported `PULL_TRANSACTION_OPTIONS`, mirroring the push side's
  existing `PUSH_TRANSACTION_OPTIONS`, lands this case unchanged — measured in GAP 18: the case
  passes with the constant in place and reddens alone when the level is flipped. Until then the
  line is defended by its comment only, and **342 backend cases pass without it**

---

## 9. The named edge cases

These are the cases the task singles out. Each one is here because it has a plausible wrong
answer, and for several the client and the server deliberately disagree — that asymmetry is the
thing being tested.

### EDGE-01 — An amount of 0

- **Layer** E2E + API (steps 2 and 3 automated: `backend/tests/expenses.edgecases.test.ts`)
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
- **Result (API steps, 2026-10-09)** Pass. The server accepts `0` on every write path — REST
  create, REST `PATCH` down to `0` from a non-zero amount, sync create, and a sync **merge** whose
  only field is `amountMinor: 0` — and reports it as the number `0` on the create response and in
  the list page. The automated case asserts `toBe(0)` rather than a falsy check, because `0` is
  falsy and `null`/`undefined` would both satisfy the looser one: a write path spelled
  `if (patch.amountMinor)` would drop the correction and leave the old amount standing. Confirmed
  the case can fail by making exactly that change locally — it was the only one of the ten to go
  red. Step 1 (the disabled Save) still needs the app.

### EDGE-02 — Very large amounts

- **Layer** E2E + API (steps 2–5 automated: `backend/tests/expenses.edgecases.test.ts` and
  `backend/tests/expenses.test.ts`)
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
- **Result (API steps, 2026-10-09)** Pass. `999999999999` round-trips exactly through the REST
  create, the list page, a `PATCH` up to the maximum, the sync push result and a sync pull — five
  separately-built response bodies — as a JSON **number**, never a string. That matters because
  `amount_minor` is `bigint` in Postgres and the narrowing to a JS number lives in one mapper; with
  it removed, all ten cases in the file go red, so the narrowing is load-bearing rather than
  incidental. Steps 3–5 (the reject side) were already covered in `expenses.test.ts`; what had no
  coverage anywhere was the **accept** side of the boundary, which is where an
  `AMOUNT_MINOR_MAX - 1` or an `int4` column would have hidden.
- **Also now covered** An oversized amount arriving by **sync** is a per-record `invalid` inside an
  HTTP `200`, not a batch-level `400`, and the valid row behind it is still `applied`. That
  distinction was only unit-tested on `parsePushBatch` before; it is the same one three cases in
  this plan originally got backwards, so it is worth an assertion at the HTTP layer.

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

- **Layer** E2E + API (step 2 and the server half of step 3 automated:
  `backend/tests/expenses.edgecases.test.ts`)
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
- **Result (API steps, 2026-10-09)** Pass, and it sharpens GAP 5 rather than closing it. The
  server accepts `2027-01-01` on the REST path and keeps the exact day; a peer's future-dated push
  is `applied` and comes back on a pull unchanged; and `GET /v1/expenses` with no date bounds
  returns the future row **first**, ordered ahead of today's. So the row is on the wire, in the
  list response and reachable by the client — nothing server-side filters it. Whatever GAP 5 is
  fixed with has to be a client decision; there is no accidental server-side filter standing in
  for one today, and a test now says so.
- **Also covered** `9999-12-31`, the last date `YYYY-MM-DD` can express, round-trips exactly. The
  mapper formats a Postgres `DATE` by slicing `toISOString()`, which a five-digit year would
  silently break, so the edge of the range is pinned rather than a date merely "far away".

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

Covered by `AUTH-11` (empty outbox — the specified path), `AUTH-12` (undrained outbox) and
`AUTH-06` (single-use rotation). All three are executable: the case that matters — a user offline
past the 60-day refresh window who has unsynced work — is answered by the landed client, which
clears the token store and leaves SQLite intact, so that work survives and pushes after re-login.
`AUTH-12` carries the assertion. What the forced clear *does* leave behind is the subject of
`AUTH-18` and `AUTH-19`, both of which are expected to fail.

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

### API-12 — Every client method reaches for the route named after it

- **Layer** Unit (`mobile/tests/api/client.test.ts`)
- **Pre** None. A transport that records its request and answers `400`
- **Steps**
  1. Call each of the sixteen `ApiClient` methods once, with the minimum valid arguments
  2. For each, compare the recorded request against `API_ROUTES.find(r => r.operationId === name)`
- **Expect** Sixteen requests, each carrying the `method`, the `path` (with `{id}` substituted) and
  the `requiresAuth` flag the contract declares for the operation of the same name. A seventeenth
  case asserts the call table itself covers `API_ROUTES` exactly, so a route added to the contract
  cannot be left untested here.
- **Result — PASSES** (all sixteen)
- **Why this is worth sixteen cases** The existing endpoint-table cases check
  `ENDPOINTS.deleteExpense.route.operationId === 'deleteExpense'`. Nothing checked that
  `client.deleteExpense` reaches for that entry rather than a neighbour, and **TypeScript cannot**:
  `send` is typed by the endpoint's response schema, and the three expense writes all answer
  `ExpenseResponse`, as do the three category writes, as do `signup` and `login` with
  `AuthResponse`. Verified by swapping `updateExpense` and `deleteExpense` in
  `src/api/client.ts`: `pnpm typecheck` stayed clean, exactly these two cases turned red, and the
  app would have sent `DELETE` when the user edited an amount. Eight of the sixteen methods had no
  test of any kind before this table.

### API-13 — `X-Request-Id` is on an error response too, and the client reads it

- **Layer** Integration (`backend/tests/integration.mobileClient.test.ts`)
- **Pre** The real app on an ephemeral port. No session
- **Steps**
  1. `GET /v1/health` through the real transport
  2. `GET /v1/me` through the real transport with `accessToken: null`
- **Expect** Step 1 is `200` and step 2 is `401`, and **both** `TransportResponse.requestId` values
  are non-null and differ from each other. The id on step 2 is the point: `app.ts` mounts the
  middleware first so that "even a 415 or a 500 carries the id", and `health.test.ts` only ever
  asserted it on a `200` from one route
- **Result — PASSES.** Verified by deleting `res.setHeader(HEADER, id)`: this case and `API-18`'s
  envelope case turn red, along with three in `health.test.ts`, and nothing else in 335 backend
  cases

### API-14 — The client and the server agree across the whole REST surface

- **Layer** Integration
- **Pre** The real app on an ephemeral port. A user signed up **through the client**
- **Steps**
  1. `getMe`, `listCategories`, `updateCategory`, `createExpense`, `updateExpense`,
     `deleteExpense`, `deleteCategory`, in that order, all through the real client
- **Expect** Eleven real round trips, every one under `400`, with `POST /v1/expenses` answering
  `201`; the rename reads back as `Commuting`, the patched amount as `999`, and both deletes return
  a row with a non-null `deletedAt`. No `ResponseShapeError` from any of them
- **Result — PASSES.** What it proves that the per-package suites cannot: the
  `Authorization: Bearer` string the transport builds is the one the server's parser accepts — an
  unauthorized transport answered `Authorization header must be "Bearer <accessToken>"` while this
  file was being written. Verified by sending `Token` instead of `Bearer`: **7 of the 9** cases in
  the file turn red, the two exceptions being the ones that take no token

### API-15 — A refresh through the client rotates the pair and spends the old one

- **Layer** Integration
- **Pre** A user signed up through the client. An access token the **server** signed with a
  negative TTL, so it is well-formed, correctly signed and already expired
- **Steps**
  1. `getMe` carrying the expired token
  2. `refresh` with the signup refresh token
  3. `getMe` carrying the rotated access token
  4. `refresh` again with the **same** refresh token as step 2
- **Expect** Step 1 is `401 token_expired` — not `token_invalid`, because the client's reaction to
  the two differs. Step 2 returns a refresh token different from the one sent. Step 3 is `200` for
  the same user. Step 4 is `401 token_invalid`: single-use rotation
- **Result — PASSES, and it corrected the case.** The first version also asserted
  `rotated.accessToken !== auth.accessToken` and **failed**: the access token is an HS256 JWT over
  an empty payload with no `jti`, so for one user it is a pure function of `iat`/`exp`, and two
  minted in the same second are byte-identical. Not a defect by itself — an *expired* token was
  minted an hour ago, so its `exp` differs — but `authorize.ts` rule 3 and `session.ts`'s
  `ensureFreshAccessToken` both treat the token string as the session's identity, and this is a
  measured case where that string is not unique. A second, independent reason for the epoch counter
  `AUTH-23`/`AUTH-24` already recommend

### API-16 — Query parameters and a real keyset cursor survive the URL

- **Layer** Integration
- **Pre** A signed-up user with three expenses, dated `2026-10-01`, `-02` and `-03`
- **Steps**
  1. `listExpenses()` with no argument
  2. `listExpenses({ limit: 2, cursor: undefined, categoryId: undefined })`
  3. `listExpenses({ limit: 2, from: '2026-10-01', to: '2026-10-03' })`
  4. `listExpenses({ limit: 2, cursor: <step 3's nextCursor> })`
  5. `listExpenses({ from: '2026-10-03', to: '2026-10-01' })`
- **Expect** Step 1 sends the bare path `/v1/expenses` and returns all three with `hasMore: false`
  and `nextCursor: null`. Step 2 puts **only** `limit=2` on the wire: the explicitly `undefined`
  keys are dropped rather than serialised as `cursor=undefined`, which the strict query schema
  would answer `400`. Step 3 sends exactly `from`, `to` and `limit` and returns 2 with
  `hasMore: true`. Step 4 returns the remaining 1 with `hasMore: false` and `nextCursor: null`, and
  the two pages together are the three dates with no overlap and no gap. Step 5 is
  `400 validation_error`, the contract's `to >= from` refinement
- **Result — PASSES.** Verified in two directions: removing `buildQueryString`'s
  `undefined`/`null` skip reddens step 2 alone, and truncating the cursor value in transit reddens
  the paging case alone. Parameter **order** is deliberately not asserted — it follows the call
  site's object literal and no part of the contract depends on it

### API-17 — A push batch and a pull page, built and parsed by the client

- **Layer** Integration
- **Pre** A signed-up user. Two client-minted UUIDv7 ids
- **Steps**
  1. `pushSync` with one `category` item and one `expense` item that references it, in one batch
  2. `pullSync({ since: 0 })`
  3. `pullSync({ since: <step 2's nextCursor> })`
- **Expect** Step 1 returns `['applied', 'applied']`. Step 2 returns `resyncRequired: false` and
  both rows, the expense carrying the `categoryId` of the category created in the same batch.
  Step 3 — the steady state a synced client sits in — returns `changes: []`, `hasMore: false` and
  the **same** `nextCursor` it was given, rather than `0`
- **Result — PASSES.** This is `SYNC-21`'s wire half with the client as the author of the batch
  rather than a test fixture: the discriminated union, the ISO `updatedAt` and the `fields` merge
  shape all go out exactly as the app would send them

### API-18 — A 204 and a real error envelope, as the client sees them

- **Layer** Integration
- **Pre** A signed-up user
- **Steps**
  1. `logout({ refreshToken })` through the client
  2. `refresh` with the same token
  3. `createExpense` with a `categoryId` that is a well-formed UUID belonging to nothing
- **Expect** Step 1 resolves to `undefined` off a real `204` with a genuinely empty body — the
  branch in `readJsonBody` no mobile case can reach, because a scripted transport supplies the body.
  Step 2 is `401 token_invalid`. Step 3 rejects with an `ApiRequestError` whose `status` is `422`,
  whose `code` is `unknown_category`, and whose `requestId` is non-null — the id the contract tells
  a user to quote, read off a real response header rather than a fixture's
- **Result — PASSES**

### API-19 — [BLOCKED-BY-GAP 16] The 401 interceptor's own round trip against a real server

- **Layer** Integration
- **Pre** A signed-up user whose stored access token is expired and whose refresh token is valid
- **Steps**
  1. One `getMe` through a transport wrapped by `createAuthorizedTransport`
- **Expect** Exactly three round trips, in order — `GET /v1/me` `401`, `POST /v1/auth/refresh`
  `200`, `GET /v1/me` `200` — one refresh, one retry, and the call resolves for the right user.
  This was written, run and **passing** before GAP 16 forced it out of the file: removing the retry
  in `authorize.ts` reddened it and nothing else
- **Why it is parked, and what unblocks it** `authorize.ts` cannot be imported into the backend's
  TypeScript program at all — see GAP 16 and the §2 note. Either fix listed there lands this case
  unchanged. Until then the interceptor is covered against a *scripted* transport in
  `mobile/tests/api/authorize.test.ts` and `authorizeSessionChange.test.ts` — 19 cases and every
  interleaving; what is missing is only that those answers are hand-written

### API-20 — A new optional field on a response envelope

- **Layer** Unit (`mobile/tests/api/responseForwardCompat.test.ts`)
- **Pre** None. A transport answering `200` with a body this case supplies
- **Steps**
  1. `listExpenses()` against the documented `{ data, nextCursor, hasMore }`
  2. `listExpenses()` against the same body plus `totalCount: 1`
- **Expect** Step 1 resolves. Step 2 **rejects with `ResponseShapeError`**. The only difference
  between the two bodies is the one extra key, so the rejection is attributable to it and nothing
  else about the fixture
- **Result — PASSES** (the client rejects it)
- **What this is a case about** `openapi.yaml`'s conventions list says responses are *not* closed
  "for the client's purposes — ignore fields you do not know", and `docs/api/README.md` calls "a new
  optional field" an acceptable additive change inside `/v1`. This is that change, and an installed
  client does not ignore it. See GAP 19 — **these five cases assert today's behaviour, not a
  preferred fix, and they are the ones to flip when GAP 19 is decided**

### API-21 — A new field inside a row, and the path the error names

- **Layer** Unit (`mobile/tests/api/responseForwardCompat.test.ts`)
- **Pre** None
- **Steps**
  1. `listExpenses()` against `{ data: [{ ...expense, tags: ['work'] }], nextCursor: null, hasMore: false }`
- **Expect** Rejects with `ResponseShapeError` whose message contains both `tags` and `data.0` —
  `z.strictObject` is recursive, so a new column on `expenses` breaks the same way a new envelope
  key does. The path matters on its own: it is the only diagnostic a report from a real device
  would carry
- **Result — PASSES**

### API-22 — The same field on the sync pull, which is the one that matters

- **Layer** Unit (`mobile/tests/api/responseForwardCompat.test.ts`)
- **Pre** None
- **Steps**
  1. `pullSync()` against the documented page
  2. `pullSync()` against the same page plus `serverRevision`
  3. `pullSync()` against the same page with an extra key inside `changes[0].record`
- **Expect** Step 1 resolves with `nextCursor: 7`. Steps 2 and 3 both reject with
  `ResponseShapeError`. A client that cannot parse `SyncPullResponse` **cannot sync at all**: local
  writes stay in the outbox, the sync pill reads `pending` indefinitely, and nothing surfaces
  server-side, because the failure is in the client's own parse
- **Result — PASSES**

### API-23 — The same field on a push result

- **Layer** Unit (`mobile/tests/api/responseForwardCompat.test.ts`)
- **Pre** None
- **Steps**
  1. `pushSync(batch)` against a documented one-result response
  2. `pushSync(batch)` against the same response plus `appliedCount`
- **Expect** Step 1 resolves with `serverRevision: 9`. Step 2 rejects with `ResponseShapeError`.
  Worse here than on the pull, because the batch **has already been applied server-side**: the
  client cannot read the results, so it cannot clear its outbox, and the retry replays ids the
  server has recorded — idempotent by `clientMutationId`, so correct, but the row never leaves
  `pending`
- **Result — PASSES**

### API-24 — What it costs: the session survives, and the local database is untouched

- **Layer** Unit (`mobile/tests/api/responseForwardCompat.test.ts`)
- **Pre** A signed-in session whose `refreshTokens` answers a valid `TokenPair` plus one extra key
- **Steps**
  1. `ensureFreshAccessToken('access-1')`
- **Expect** Rejects with `ResponseShapeError`, which is **not** an `ApiRequestError`, so it is not
  in `UNRECOVERABLE_CODES` and `performRefresh` rethrows rather than calling `discard`. The session
  snapshot is still `authenticated` and the token store still non-null
- **Result — PASSES**
- **Why this case bounds the severity** It is the difference between "every installed app stops
  working" and "every installed app loses the user's unsynced work". The second does not happen.
  It is also the branch a careless widening of `UNRECOVERABLE_CODES` would break, which would turn
  an additive response field into exactly the data-loss path `AUTH-12` exists to rule out — so the
  case is here to defend that, not only to record it

---

---

## 11. Contract and design gaps found while writing this plan

Finding these now is the point of writing the plan in Wave 1. **Each one is raised as a comment on
TVO-5 and flagged to Chief**; contract changes go through Chief per `docs/PLAN.md` §7. None of
them is assumed resolved, and the cases that depend on one are marked `[BLOCKED-BY-GAP n]` above
rather than guessed at.

Ten gaps were filed when this plan was first written, and **seven have since closed** — five in the
contract and backend work of 8–9 Oct, and GAP 4 and GAP 3 by being read against the landed code and
then fixed. That is the plan paying for itself before a single case was executed by hand. Three new
gaps have been opened since, and none came from reading a contract: **GAP 11** was found by
re-testing one of those fixes rather than closing on a green suite, **GAP 12** by executing a case
this plan had already written — against a fixture that, it turned out, could not have failed it —
and **GAP 13** by verifying another task's acceptance criteria and finding the one interleaving its
own good tests did not reach. **GAP 14** came from a coverage report: the composition root was the
largest wholly untested module in `mobile/src`, and testing it showed that the hazard its own doc
comment says it exists to prevent has since been neutralised one layer down. **GAP 15** came from
the opposite direction — re-reading a gap this plan had already *closed*. **GAP 16** came from
building a test layer that did not exist: the two implementations had never run in one process, and
the first attempt to make them broke the backend's own typecheck from a type-only import.
**GAP 17** came from a result this plan had already recorded and read the wrong way: `SYNC-04`'s
own Result says three edits of one row leave three outbox entries, under a case titled "coalesces
instead of queueing twice". Nobody noticed the contradiction, including whoever wrote it down. GAP 2's chosen branch has
a documented cost, and measuring it showed the cost is not the transient GAP 2 recorded: it breaks
a wire-contract guarantee, and it produces a tombstone the 90-day horizon never collects.
**GAP 18** came from a dimension this suite did not have — two things happening at once — and
**GAP 19** from the only input this plan had never read adversarially: the contract's *conventions
list*, the prose above the schemas. Every earlier gap came from a schema, a design rule or the
landed code. This one is four sentences about how the API is allowed to change, and they contradict
each other, the document's own schemas, and the client.

The numbering is kept stable so the TVO-5 thread still reads correctly, and closed entries are kept
rather than deleted, so the decision stays recorded where the test that depends on it can find it.

### Closed

| #   | Gap                                                              | Closed by                                                                                                        |
| --- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | Who seeds the default categories — the duplicate-six risk        | `00-foundations.md` §7 rule 7: "The server writes these rows; the client never seeds." `AUTH-17` asserts six     |
| 2   | Does a sync-path category delete reassign expenses server-side?  | Implementation: it does **not**. `SYNC-23` now asserts the per-record statuses, and the cost of that branch      |
| 6   | The clock clamp is one-sided; a slow clock silently always loses | Recorded as intended on `clampClientUpdatedAt`. `SYNC-20` is a test rather than an open question                 |
| 8   | The server clock must be injectable                              | Resolver is pure functions over `now`; `pruneTombstones(db, userId, now)` takes it too. §2 updated               |
| 7a  | `immutable_field` unreachable on the **sync** path               | `sync/batch.ts` maps a server-owned unknown key to `immutable_field`. `API-04` asserts it; the REST half is open |
| 4   | Does a forced session clear wipe undrained local writes?         | It does not, and never did — `AUTH-12` asserts it. Reading the client turned the question into two defects, fixed in `b1f7d7f` and re-tested: `AUTH-18`, `AUTH-19` |
| 3   | How long is a `clientMutationId` remembered?                     | 90 days — the tombstone horizon, swept by the same job (`9f2edc8`). Was "forever", because nothing pruned the ledger. Re-tested by `SYNC-39` / `SYNC-40`; `SYNC-13` is unparked |

Also settled in passing, though never filed as a numbered gap: `EXP-02`'s `[CONFIRM]` on a
re-posted REST create, which `openapi.yaml` now answers — idempotent `201`, retried body ignored,
no new `revision`, and another account's id rejected as `400 validation_error`.

### Still open

| #   | Gap                                                                  | Severity | Blocks             |
| --- | -------------------------------------------------------------------- | -------- | ------------------ |
| 11  | Session writes are not atomic, and the wipe runs first (filed, mobile) | Medium   | nothing            |
| 12  | The category list's local order is wrong twice (filed, mobile)        | Low      | nothing            |
| 13  | An in-flight request is retried under the next user's token (`TVO-20`) | Medium   | nothing            |
| 14  | Two defences for the refresh-recursion hazard; only one is live        | Low      | nothing            |
| 15  | An orphaned category tombstone outlives the horizon (filed, backend)   | Medium   | nothing            |
| 16  | The client/server seam cannot reach `authorize.ts` (`TVO-23`)          | Low      | `API-19`           |
| 17  | The outbox does not coalesce, so a conflict resolves per field (`TVO-24`) | Low      | nothing            |
| 18  | The pull's `RepeatableRead` snapshot is load-bearing and unasserted (`d0c66465`) | Low      | `SYNC-57`          |
| 19  | The `/v1` additive-only policy breaks every installed client (`917f33d0`) | Medium   | nothing            |
| 5   | A future-dated row arriving by sync is unreachable in every view     | Medium   | `EDGE-04`          |
| 7b  | `immutable_field` is unreachable on the **REST** path                | Low      | `API-04` (half)    |
| 9   | No E2E driver is named in `docs/PLAN.md` §7                          | Low      | 7 cases run manual |
| 10  | Rate limits are not quantified                                       | Low      | `API-09`           |

**No open gap is a blocking decision for Chief.** Three stopped being questions in consecutive
runs, each by being read against the landed code rather than waited on — GAP 4, GAP 3 and now the
re-test of both fixes, which produced GAP 11. All three turned out to be defects rather than
decisions, which is the pattern worth noting: a gap that has sat unanswered for three runs is more
often unexamined code than an undecided policy.

GAP 11, GAP 12, GAP 13 and GAP 15 are filed defects rather than open questions, and none of them
blocks anything: `AUTH-20`, `AUTH-21`, `CAT-15`, `CAT-16`, `AUTH-23`, `AUTH-24`, `SYNC-44` and
`SYNC-45` are written, automated and expected-fail, so they report each fix the moment it lands.
GAP 15 carries one extra thing a reader should not skip: both of its obvious fixes are wrong, and
each is ruled out by a case that *passes*, so the entry is worth reading before any of it is
written. GAP 14 is a documentation accuracy
finding with no behavioural change behind it, and `AUTH-27` records the measurement. GAP 16 is a
module-layering finding with a two-line fix, and it is the only gap that currently parks a case
this plan can otherwise run (`API-19`). What is left
needs its owner's input rather than a ruling, and none of it blocks executing §8: GAP 5 is the
Designer's, GAP 9 wants Mobile Dev's agreement on a driver before 7 cases stop being manual, GAP 10
wants numbers from whoever sets the limits, and GAP 7b is a contract-hygiene choice between two
one-line fixes.

**GAP 19 is the one with a shipping deadline on it**, and it is the only open gap whose cost rises
with time rather than staying flat. It is not a defect in anything running today — no app is
deployed and inside this repo both sides always carry the same `shared/` — but the contract's own
evolution policy instructs people to make the one change that would break every installed copy, and
the fix is one line while nobody is holding one. It needs a contract ruling from Chief before it
needs any code from Mobile Dev.

### GAP 11 — A session change is not atomic, and the destructive half runs first — **OPEN**

Found by re-testing the GAP 4 fix rather than by reading the contract, which is why it is numbered
after the ten the plan opened with. The fix for `TVO-16` is sound in the path it was written for and
leaves two narrower holes, both rooted in the same thing: **the owner of the local store and the
tokens that authorise it are separate writes, and the order assumes writes do not fail.**

1. **`signIn` wipes before it writes.** `localStore.adopt()` runs first — correctly, since
   adopting after publishing `authenticated` would let the tab bar read another account's rows on
   its first frame — but the token write that follows can fail, and by then the previous user's
   undrained work is already deleted for a sign-in that never happened. `session.ts` states the
   opposite as a safety property in a comment on that exact ordering. Carried by `AUTH-20`.
2. **The owner is a fourth secure-store value written in parallel with the tokens.** A partial
   write leaves them disagreeing, and `read()` reassembles the mix into a session that is one user
   on the device and another at the server — which re-opens the leak GAP 4 closed, from a side the
   wipe cannot defend. Carried by `AUTH-21`.

Both need a secure-store write to fail, which is uncommon and not exotic: a locked keystore, a full
disk, Android keystore corruption after an OS upgrade. Severity is **Medium** on that basis — the
outcomes are the two worst in this area (silent loss of the user's own writes; cross-account data)
behind a failure that is rare rather than rank-ordered by probability alone.

Both fixes are orderings rather than new mechanisms, and both were applied locally and reverted:
write tokens → adopt → publish, rolling the tokens back if the adopt fails; and delete the owner
key first, write it last, so a half-done write reads as no owner and therefore no session. Each
turns its case red and leaves the other 39 auth cases green. Filed for Mobile Dev.

### GAP 12 — The category list's local order is wrong twice — **OPEN**

Found by executing `CAT-01` at the unit layer, and the interesting part is why executing it was
worth anything: **`CAT-01` was already written, already correct, and could not have failed.** Its
precondition is `F-FRESH`, and the six seeded names — `Bills`, `Eating out`, `Groceries`,
`Health`, `Transport`, `Uncategorized` — come out in the same order under a case-sensitive sort, a
case-insensitive one, and with or without the default pinned last. The fixture agreed with every
candidate implementation, so the case was decoration. That is a defect in this plan as much as in
the client, and it is the reason `CAT-15` and `CAT-16` state their seeds rather than reusing a
fixture.

`listLiveCategories` (`mobile/src/db/queries.ts`) sorts with `ORDER BY c.name`, against a `name`
column declared with no collation. Two deviations from `07-categories.md` §1 state `default`:

1. **Not case-insensitive.** SQLite's default BINARY collation puts every capital letter before
   every lowercase one, so a user with `Bills`, `rent`, `Transport` sees `rent` last. Carried by
   `CAT-15`.
2. **The `isDefault` row is not pinned last.** It sorts on its name like any other, and
   `Uncategorized` only looks right because it happens to sort after the other five seeds. The
   first category a user adds that sorts after it — `Vacation`, `Work`, anything lowercase —
   moves the protected row into the middle of a list where §4 rule 4 says the last row is the one
   without a swipe action. Carried by `CAT-16`.

Severity **Low**: it is wrong order, not wrong data, and nothing is lost or leaked. It is filed
rather than left as a note for two reasons. The query's own doc comment claims it returns "the
order `docs/design/07-categories.md` specifies for the category list", and a stated guarantee the
code does not have is worse than an unstated one — the next reader stops checking. And the backend
hit this exact problem first and solved it deliberately: `byName` in `categoryService.ts` sorts in
process specifically because "Postgres orders text by the database's collation, which in a
`C`-locale cluster puts every capital letter before every lowercase one". The client then
reintroduced the same bug one layer down, in the only place the pin-last rule can live, since the
REST contract promises plain name order and leaves presentation to the client.

The candidate fix is one line — `ORDER BY c.isDefault, c.name COLLATE NOCASE` — and it was applied
locally and reverted: it turns exactly `CAT-15` and `CAT-16` red and leaves all 176 other mobile
cases green. Two notes for whoever takes it: `idx_categories_live (deletedAt, name)` no longer
serves that sort, which is acceptable on an unpaginated set of a few dozen rows but is a choice
worth making knowingly rather than discovering; and a `COLLATE NOCASE` column would also change
what the `UNIQUE`-style local name check in `CAT-14` compares, so the collation belongs in the
`ORDER BY` rather than in the schema unless that is checked too. Filed for Mobile Dev.

### GAP 13 — An in-flight request is retried under the next user's token — **OPEN**

Found by verifying `TVO-6`'s acceptance criteria rather than by reading the contract. The AC names
two guarantees as must-test, and both are covered well: the transactional write helper
(`write.test.ts` injects a real `UNIQUE` violation that fires *after* the row insert, and a
mid-transaction failure, so the atomicity cases can genuinely fail) and the single-flight refresh.
`authorize.test.ts` covers every way the token can change **within one session** — a concurrent
rotation, a refresh that fails, a retry that 401s again.

Nothing covered the other reason the stored token can differ by the time a request comes back:
**it now belongs to somebody else.** `ensureFreshAccessToken` short-circuits on

```ts
if (staleAccessToken !== null && session.accessToken !== staleAccessToken) return session.accessToken;
```

and the comment above it names one reason those differ — a concurrent rotation — for which the
behaviour is exactly right. A different user signing in makes them differ too and takes the same
branch. The comparison is on the token *string*; the session's **identity** is not part of it. So
`authorize.ts` retries under whatever token is now stored, without checking it still belongs to the
account the request was built for. Measured: tokens `["access-a", "access-b"]`, zero refresh calls,
and the body replayed verbatim. Carried by `AUTH-23` (token) and `AUTH-24` (payload).

Severity **Medium**, on the same basis as GAP 11. The sequence needs a request still in flight when
the user logs out *and* a second user logs in before its `401` lands — uncommon, and not exotic on
a shared device, where the request most likely to still be in flight is precisely the slow one. It
is **latent** today: no screen issues authorized API writes yet and the push is `TVO-13`. A plain
`signOut` mid-flight is already handled correctly (`AUTH-22`), which is what keeps this narrow.

One thing the Medium label should not hide: §14's exit criterion 2 lists **a cross-tenant read or
write** as P1, and that is this gap's outcome, not a worst case. The Medium is a judgement about
reachability today, when nothing issues an authorized write; it is not a judgement that the app
could ship with this open. Once `TVO-11` or `TVO-13` lands, `AUTH-24` is a P1 and criterion 2
cannot be met with it red.

The fix is a session **epoch**, bumped on `signIn` and `signOut` and **not** on a rotation,
captured in `authorize.ts` before the send and re-checked after the `401`; if it changed, return the
original response. Applied locally and reverted: `AUTH-23` and `AUTH-24` turn red, all 15 cases in
`authorize.test.ts` stay green along with `AUTH-22` and `AUTH-25`. Bumping on rotation as well
would redden "retries with the current token when it 401s after someone else rotated", which is
correct behaviour. Filed as `TVO-20` for Mobile Dev.

### GAP 14 — Two defences for the refresh-recursion hazard, and only one of them is live — **OPEN**

Not a defect. A stale rationale, which is the same class of problem as GAP 12's doc comment and is
filed for the same reason: the next reader trusts it and stops checking.

`bootstrap/container.ts` opens by saying the module exists because "the wiring has one knot in it",
and that resolving it the obvious way "would make the refresh call go *through* the interceptor, so
a 401 on a refresh would trigger a refresh". That was true when it was written. It is no longer
reachable: `authorize.ts` returns early for any route with `auth: false`, and
`POST /v1/auth/refresh` is one — so a refresh issued through the authorized client never enters the
interceptor either.

Measured rather than reasoned about. `refreshTokens` was rewired to the authorized client via a
late-bound reference — the exact shape the comment warns against — and **every one of the 105 cases
in `tests/api`, `tests/auth` and `tests/bootstrap` stayed green**, including `AUTH-27`, which is
the case that looks like it should catch it. Reverted.

Two things follow, and the second is the reason this is written down:

1. The live defence is the `requiresAuth` short-circuit in `authorize.ts`, and it **is** pinned —
   removing it reddens `authorize.test.ts`'s "never refreshes for a route that takes no token",
   and nothing else in the suite. Verified the same way.
2. So the ordering in the composition root is a second, currently inert layer. That is fine as
   belt-and-braces, but anyone reading the two files could conclude the opposite of the truth in
   either direction: that the ordering is what protects them (it is not), or that the
   short-circuit is redundant because the container handles it (it is not). Removing the
   short-circuit on that belief would reopen the hazard with no test failing for the stated
   reason.

The fix is two sentences in `container.ts` saying which layer actually holds and that the ordering
is deliberate redundancy — not a code change. Low severity; blocks nothing. `AUTH-27` records the
measurement so this cannot be re-derived a second time.

### GAP 15 — An orphaned category tombstone outlives the horizon, and nothing reports it — **OPEN**

This is GAP 2's chosen cost, measured. GAP 2 settled that a sync-path category delete reassigns
nothing server-side, argued correctly that this is the better branch, and named the state left
behind by a client that dies between the category push and the expense pushes. It recorded that
state as a transient the client recovers from. Two of its consequences are not transient.

**Defect 1 — the server serves an `Expense.categoryId` no client can resolve.** `openapi.yaml`
describes the field as "Always a live category of the same user; reassigned to the `Uncategorized`
default if its category is deleted". After a sync-path delete whose reassignments never land, both
halves are false: `GET /v1/expenses` and `GET /v1/sync` both serve the expense pointing at a
category that is absent from `GET /v1/categories` for being a tombstone. Measured in `SYNC-43`,
including from a device syncing from scratch, so every device reaches it, not just the one that
pushed. This is the same class as GAP 12's doc comment and GAP 14's rationale — a stated guarantee
the code does not have — except that this one is on the wire contract a second client would be
written against.

**Defect 2 — the tombstone is then un-prunable for the life of the account, and the scheduled job
cannot say so.** `pruneTombstones` leaves a category whose expenses still exist "for the next run
rather than cascading". That converges for a **tombstoned** expense, which is collected at its own
horizon. It never converges for a **live** one, which does not age out — so the row survives a
prune at 91 days and at 4000, and is delivered in every full pull forever (`SYNC-44`). The 90-day
horizon, which is the number the whole tombstone design is built on, does not bound this row at
all. Compounding it, `PruneResult.categoriesRetained` exists to make exactly this visible and
`pruneAllTombstones` — the aggregate the scheduled script calls — drops it, so a stuck account
reads identically to a quiet one in the only line an operator sees (`SYNC-45`).

**Severity: medium, and the reason is `SYNC-46`.** The orphan is recoverable by any client that
comes back and pushes the reassignment: that push is still accepted, an amount corrected in the
same session survives it, and the prune converges immediately after. So this is permanent only if
no client ever follows through — a device lost, wiped, or reinstalled between the two pushes, or a
second client written from the contract, which says the delete reassigns. Not data loss, and the
correct flow is clean (`SYNC-41`). What it is: a wire-contract guarantee that does not hold, plus
one unreclaimable row per occurrence with no way to observe the accumulation.

**Both obvious fixes are wrong, and each is ruled out by a passing case.** This is the part worth
reading before writing any of it:

1. **Reassign server-side at delete time** — breaks `SYNC-46`, by reintroducing precisely the
   silent data loss GAP 2 rejected. The server would write each expense with its own `now`, so the
   client's own expense items lose last-write-wins and come back `conflict_server_wins`, and an
   amount the user also corrected offline is dropped.
2. **Refuse the delete while live expenses reference it** — breaks `SYNC-41`, the flow that is
   working correctly. `SYNC-42` shows the server applies every category in a batch before any
   expense, so when the delete runs its expenses have *always* still got the old `categoryId`,
   including in the one-round-trip flow the design specifies. This fix rejects the normal case.

**What QA would do instead**, offered as a recommendation and not a ruling, since the call is
Backend Dev's and Chief's:

- **The contract's wording**, for Defect 1. The "always a live category" sentence cannot be made
  true without fix 1, so narrow it: say the field may reference a category the client has already
  seen tombstoned when the owning client has not yet pushed its reassignments, and point at
  `02-offline-and-sync.md` §5.1 for what the client does about it — the same user-picks rule that
  already covers `unknown_category`. This also closes the prose half of GAP 2, which has been open
  since the beginning and now has a measurable consequence rather than only an inconsistency.
- **A repair at the horizon**, for Defect 2. At 90 days past the delete, a category still blocked
  by a **live** expense is unambiguously a client that never followed through — far outside any
  in-flight batch — so reassigning those expenses to the `isDefault` category inside the existing
  prune transaction both converges the prune and restores the invariant, and bumps `revision` so
  devices learn. Verified: with that plus `categoriesRetained` plumbed through the aggregate,
  `SYNC-44` and `SYNC-45` turn red (they are `it.fails`) and **all 324 other backend cases stay
  green**, including `SYNC-41` and `SYNC-46`. Reverted; the fix is Backend Dev's to make.

Filed as `TVO-22` against `backend/`, unassigned. Blocks nothing: the two tripwires report the fix
when it lands.

### GAP 16 — The two halves of the app cannot be exercised in one process — **OPEN**

Found by writing the integration layer rather than by reading anything, and it is the reason
`API-19` is parked rather than passing.

**The 401 interceptor cannot be imported outside the mobile package.** `api/authorize.ts` opens
with `import type { SessionController } from '../auth/session'`. The `import type` is erased at
runtime, so this is not a bundling problem — it is a **typecheck** one. The specifier still puts
`auth/session.ts` into the importing package's TypeScript program, and from there:

```
authorize.ts -> auth/session.ts -> auth/tokenStore.ts -> expo-secure-store
             -> expo-modules-core -> react-native -> @types/jsdom -> lib.dom
```

With the DOM globals loaded, `setTimeout` resolves to the browser overload returning `number`, so
`backend/src/server.ts:44` fails on `.unref()`, and `process.env.NODE_ENV` narrows to a union that
makes `src/loadEnv.ts:24` an impossible comparison. **Two errors in backend files nobody touched,
from one type-only import in a test.** Traced with `tsc --noEmit --explainFiles`; the DOM reference
is `@types/jsdom/base.d.ts`, reached through `expo-modules-core`'s global declarations.

`auth/session.ts` also cannot be *loaded* at all in a non-RN runner, for the same shape of reason
one layer down: it imports `sessionFromTokenPair` — a value, not a type — from `auth/tokenStore.ts`,
whose first line is `import * as SecureStore from 'expo-secure-store'`. Vite fails to parse
`react-native/index.js` (Flow syntax). So the real `SessionController` is out of reach of any runner
except mobile's jest, regardless of the typecheck issue.

**Why this is worth filing and not just noting.** `authorize.ts` needs exactly two methods —
`getAccessToken` and `ensureFreshAccessToken` — and takes a dependency on the type of the whole
session module to name them. The module is otherwise careful about this layering: its own doc
comment explains that `refreshTokens` is *injected* "rather than imported so this module does not
depend on the API client that depends on it". The same reasoning applies to the type it does import,
and the cost is that the one seam neither package's suite can cover stays uncovered.

**Two candidate fixes, both small.**

1. Have `authorize.ts` declare the narrow interface it actually uses — two methods — and let
   `SessionController` satisfy it structurally. No runtime change, no change to `session.ts`, and
   it also documents what the interceptor needs.
2. Move the native-free half of `auth/tokenStore.ts` — `StoredSession`, `TokenStore` and
   `sessionFromTokenPair` — into a module that does not import `expo-secure-store`, leaving the
   `createSecureTokenStore` factory behind. This is the better fix if the real `SessionController`
   is ever wanted in a non-RN runner, and it would unblock a `createMemoryTokenStore` import too.

Either lands `API-19` as written, and the test file in `backend/tests/` would need one import added
and the `withToken` helper deleted. **Severity: low.** It blocks one QA case and no product
behaviour; nothing a user does is affected. Filed as **`TVO-23`** against `mobile/`.

Fix 1 was applied locally before filing rather than proposed on paper: with the two-member
interface in place, `pnpm typecheck` is green repo-wide, mobile stays at **207 passed** —
`SessionController` satisfies it structurally, so `container.ts` is untouched — and `API-19`
passes, reddening alone when the retry is removed from `authorize.ts`. Then reverted.

### GAP 17 — The outbox does not coalesce, so a sync conflict resolves per field — **OPEN**

Found by re-reading a Result this plan had already recorded, and reading it the right way the
second time. `SYNC-04` is titled "Editing a pending row coalesces instead of queueing twice", its
expectation is drawn from `02-offline-and-sync.md` §2 rule 2, and the Result underneath it says
**three local mutations of one row leave three `outbox` rows.** Three entries is not coalescing.
The contradiction sat inside one case entry, written by QA, unflagged, for two runs.

**The two sides.** `02-offline-and-sync.md` §2 rule 2: "Editing a `pending` row updates the same
row and coalesces into the outbox — **it does not queue a second mutation**", cited again by
`06-expense-form.md` for the `offline-pending` form state. `mobile/src/db/write.ts` → `enqueue()`
always `INSERT`s a fresh row, and `mobile/tests/db/write.test.ts` pins that as *"appends a second
entry rather than replacing the first"*, with distinct `clientMutationId`s "so a retry of one is
not mistaken for the other". Both sides green; neither aware of the other.

**Why it is not a documentation nicety.** The two clients do not produce the same data. §8.10
measures it against the real server: with two entries, a conflict is resolved **per entry**, so one
field of the user's row can be dropped while another lands in the same batch. `SYNC-48` ends with
the server holding one device's amount and the other device's note — a row that existed on neither
device and that no user authored. For an expense that is worse than either device winning outright,
because the note now describes an amount it was never written about. The same divergence pushed by
a coalescing client applies whole, which is the row-level outcome §5.2 describes. The hybrid is not
an ordering artifact: reversing the within-entity sort produces the same row.

Convergence itself survives (`SYNC-50`), so this is about which fields survive, not drift.

**The implementation looks like the side that is right.** Three things make §2 rule 2 unsafe as
written:

1. **The outbox has no in-flight marker.** `migrations.ts` v1 gives it `attempts` and `lastError`
   and nothing that separates *queued* from *sent, awaiting a response* — while §2's own state
   table says an entry may be "queued **or in flight**". A coalescing `enqueue` cannot tell which
   one it is merging into.
2. **Merging into an in-flight entry is an already-tested error.** It changes the payload under a
   `clientMutationId` the server may have recorded, and the server answers per-record `invalid`
   with `mutation_id_reused` (`SYNC-11`, `backend/tests/sync.idempotency.test.ts:296`). So a second
   edit of a pending row would drive the row into `needs-attention` through ordinary use, against
   §2 rule 1 ("`pending` is not an error") and rule 2's own "never a blocker".
3. **The naive fix breaks seven mobile cases.** Measured rather than guessed: a coalescing
   `enqueue` that merges into the newest entry for the same record reddens 7 of 208 — four that
   assert appending, and three (`countPendingRecords`, the TanStack Query pending count, and the
   tombstone/undelete pair) whose *premise* is that one row can have several entries. Reverted.

**What QA recommends**, as a recommendation and not a ruling, since the docs are the Designer's and
the consequence is Mobile Dev's: amend §2 rule 2 to describe what the client does — one entry per
edit, carrying only that edit's fields, with the row `pending` while any of them is undrained — and
extend §5.2, which currently reads as row-level, to say that a conflict is per entry and that the
client must write back **every** result in request order. `SYNC-50` is the case for that last
clause: writing back only the `conflict_server_wins` record, which is the obvious reading of the
text as it stands, stores a row the batch's own later entry has already changed.

If row-level last-write-wins is wanted instead — a defensible product call, since it keeps a user's
edits together — it is not a one-line change. Coalescing has to happen at **drain** time over
entries provably not in flight, which needs a marker in the `outbox` schema and a rule for the
merged entry's `clientMutationId`. That is a decision to take **before** `TVO-13` writes the drain.

**Severity: low.** Nothing is broken today: the drain does not exist, so no batch has ever been
pushed from a real outbox. The cost is that two design docs describe a client the code is not, and
whoever writes `TVO-13` will build against one of them. Filed as **`TVO-24`**, unassigned, with
the Designer as the recommended owner. Blocks nothing — the four cases in §8.10 are green and
record the behaviour either decision has to account for.

### GAP 18 — The pull's snapshot isolation is load-bearing and nothing asserts it — **OPEN**

Filed as `d0c66465` (low, Backend Dev). Not a defect: the code is correct today. The finding is that
the **one mechanism standing between a two-table merge and the loss this codebase ranks first is
unguarded**, and I measured exactly how unguarded.

`readPage` reads categories and expenses from one `RepeatableRead` transaction, and its doc comment
says plainly why: *"The transaction is the load-bearing part, and `RepeatableRead` is why it exists
rather than being an optimisation"*, followed by the three-step interleaving that loses a row under
the default `READ COMMITTED` — the categories query returns up to revision 40, a write commits a
category at 41 and an expense at 42, the expenses query returns 42, and the category at 41 is never
delivered to that device again.

**Measured.** With `isolationLevel` changed to `'ReadCommitted'`, **all 342 backend cases pass** —
including the six new cases in §8.11, and including `SYNC-55`, which is the case most likely to
catch it. Three repeat runs, same result. The window to hit is the gap between two queries issued
back to back on one connection, on the order of a tenth of a millisecond, so a black-box test would
have to be probabilistic to see it, and a test that fails a few percent of the time is worse than
no test at all. **So no case in this plan can defend this line, and I am not going to pretend one
does.** That is the whole gap.

**The asymmetry that makes it worth filing.** The push side of the same pair is guarded. Its
settings are a named constant, `PUSH_TRANSACTION_OPTIONS`, whose comment says *"`isolationLevel` is
the one with teeth"* and explains that `RepeatableRead` would break the idempotency and create
races. Measured in the other direction: raising the push to `'RepeatableRead'` reddens **exactly
the 2 cases its comment names** and nothing else. So one half of the sync service has its isolation
level pinned by tests and the other half has it pinned by a comment, and it is the second half that
protects against silent data loss.

**Recommended fix, applied and measured rather than proposed on paper.** Mirror the push: lift the
inline options into an exported constant and assert it.

```ts
export const PULL_TRANSACTION_OPTIONS = { isolationLevel: 'RepeatableRead' } as const;
```

With that in place a one-line case passes, and flipping the level to `'ReadCommitted'` reddens it
alone. Verified, then reverted — the source change is Backend Dev's, not something to land under a
QA test commit. The case is **parked** until it does, because it cannot be written against the
current shape of the module.

This is a structural guard, not a behavioural one, and that is the right trade here: the behaviour
is not reachably testable, so the thing to pin is the setting. It is the same reasoning that made
`PUSH_TRANSACTION_OPTIONS` a named constant in the first place.

### GAP 19 — The contract's evolution policy and the client's response parsing are opposites — **OPEN**

Filed as `917f33d0` (medium, Chief's call on the contract; the code change is Mobile Dev's). Not a
defect in anything running today: no app is deployed, and inside this monorepo both sides always
carry the same `shared/`. It is **a trap that arms itself the day the app ships**, and the cost of
disarming it is one line while nobody is holding an installed copy.

**Four statements, and they cannot all be true.**

1. `openapi.yaml` conventions, "Unknown fields are rejected": *"Every request body is validated
   closed (`additionalProperties: false`) … **Responses are _not_ closed for the client's purposes —
   ignore fields you do not know.**"*
2. `openapi.yaml` conventions, base path: *"A breaking change ships as `/v2`; this version is
   **additive-only**."* `docs/api/README.md` spells out what that permits: *"Additive changes within
   `/v1` are fine — a new optional field, a new endpoint."*
3. Every response schema in `openapi.yaml` is `additionalProperties: false`. Measured over all 26
   object schemas in `components.schemas`: not one is open except `ErrorDetails`. So the document
   closes responses in the same breath as its prose says they are not closed.
4. `mobile/src/api/client.ts` parses every success body with the `shared/` schema, each of which is
   a `z.strictObject`, and an unrecognised key is a `ResponseShapeError`. Its doc comment gives the
   reason: *"Both sides ship from the same `shared/` version, so there is no older-client case to
   stay permissive for."*

Statement 4's premise is false for a mobile app. The backend deploys; the app is whatever version
the user last installed, or never installed. This app is designed *around* stale clients — a 60-day
refresh window, an offline store, background sync — so "both sides ship together" is the one
assumption its own architecture rules out.

**Measured, not argued.** `API-20`–`API-24` add exactly one key to an otherwise documented body and
drive the real client. Every operation that matters rejects it: the expense list, the sync pull on
the envelope *and* nested in a row, and a push result. The consequence is bounded by `API-24` and it
is worth stating precisely, because the dramatic reading is wrong: a `ResponseShapeError` out of the
refresh is not an `ApiRequestError`, so it misses `UNRECOVERABLE_CODES`, `performRefresh` rethrows
instead of calling `discard`, and the session and the local database both survive. **Every installed
app stops working; none of them loses the user's unsynced work.**

**What was unpinned, and by how much.** Patching `send` to ignore `unrecognized_keys` issues — the
shape the lenient fix would take — leaves **all 208 pre-existing mobile cases green** and reddens
only the five new ones. The two existing `ResponseShapeError` cases in `client.test.ts` do not
notice, and they could not: one sends a *missing* field and the other a *malformed* one. Both of
those are bugs on one side or the other. An **extra** field is not — it is the one change the
contract explicitly permits — and nothing in this repo had ever sent one.

**There is also no version negotiation of any kind.** No `X-Api-Version`, no minimum-client header,
no `User-Agent` convention — grepped across `openapi.yaml`, `shared/src` and `mobile/src/api`. So
the server cannot detect a stale client, and the client cannot be told to update. Whatever is
decided below, that absence is the reason the failure would arrive as an unexplained dead app rather
than an update prompt.

**The decision, and the two branches.** This plan's own authority order (§preamble, rule 2) says the
zod schema wins where a body and the YAML disagree — which settles it in favour of *closed*
responses and makes statements 1 and 2 the wrong ones. If that stands:

- Correct `openapi.yaml`'s conventions list and `docs/api/README.md`, and say plainly that **an
  additive response field is a `/v2` concern**, not a `/v1` one. "Additive-only" currently reads as
  a permission and is in fact a prohibition.
- Decide the version-negotiation question before the app ships, or accept that the first additive
  response change requires every user to update first.

The other branch — make *response* parsing lenient while requests stay strict — is defensible and
cheap today: it is what statement 1 already promises, it costs the `undefined`-spreading protection
`client.ts` argues for, and it would redden exactly the five cases above. `SYNC-50`'s lesson applies
to the client side of it: leniency must drop unknown keys, not pass the raw body through, or an
unparsed response reaches the store.

I have **not** written an expected-fail case for either branch. An `it.failing` asserting leniency
would encode a decision nobody has made and stay red indefinitely — the `AUTH-21` mistake. The five
cases assert what the client measurably does, and they are listed here so whichever branch is taken
knows which cases it is expected to flip.

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

**And that state has since been measured, which reopened this entry as GAP 15.** It is not the
transient this paragraph assumed. While it lasts the server serves an `Expense.categoryId` that
`openapi.yaml` calls "always a live category" and that no client can resolve; and the category
tombstone is blocked from pruning by a *live* expense, which never ages out, so the 90-day horizon
never collects it. `SYNC-41`-`SYNC-46` carry it. The prose fix this entry asks for is now part of
GAP 15's recommendation rather than a tidy-up on its own.

### GAP 3 — `clientMutationId` retention: the answer was "forever" — **CLOSED, FIXED AND RE-TESTED**

**Closed by `9f2edc8` and `ccde610`:** the ledger is swept on the same 90-day horizon as
tombstones, by the same job, and the number is written down in `docs/PLAN.md` §4 rather than only
in the code. The fix covers **both** halves below, including the discovery branch the cheap fix
would have missed. `SYNC-39` and `SYNC-40` are ordinary passing cases now, the 89-day
over-pruning guard stayed green across the change, and `SYNC-13` is unparked with a boundary it
can finally assert. The record of the defect is kept below because it is what those three cases
exist to prevent coming back.

`docs/PLAN.md` §Idempotency and the push description both require a replayed `clientMutationId` to
be a no-op, and the contract calls a double-apply "the most common offline-sync bug". Neither says
**how long** the server remembers a processed id. I raised that as a question for Chief across
three runs. It was never a question: the pruner answers it, so this is now a defect against
`backend/` with two failing cases behind it.

**The ledger is never pruned.** `pruneTombstones` issues two `DELETE`s, against `expenses` and
`categories`. Nothing in `backend/src` deletes a `sync_mutations` row, and `created_at` is written
by the schema default and read by nothing. The retention window is therefore unbounded, and one row
accrues per mutation per user forever. Pinned by `SYNC-39`.

**And a second finding, which the obvious fix would miss.** `pruneAllTombstones` chooses which
accounts to sweep with a `UNION ALL` over tombstoned `categories` and `expenses`. So a third
`DELETE` inside `pruneTombstones` — the cheap fix, and the one I recommended myself — would never
run for an account that has made mutations but deleted nothing, which is the ordinary user. The job
needs a third branch in its discovery query too, or the ledger sweep needs to live outside the
per-user loop. Pinned separately by `SYNC-40`, so neither half can mask the other.

**Verified rather than argued.** I applied both halves of the candidate fix to
`tombstoneService.ts` locally: `SYNC-39` and `SYNC-40` turned red, the 89-day guard stayed green
(so the candidate does not over-prune), and the other 17 cases in that file were unaffected. Then I
reverted it — the fix is Backend Dev's to make, not QA's to smuggle in under a test commit. It is
about six lines.

**Severity: correctness is safe, operations are not.** Remembering forever de-duplicates
everything, so no retry double-applies and `SYNC-09`–`SYNC-12` hold today. What is broken is the
unbounded table, plus the fact that `SYNC-13` cannot assert a boundary that does not exist. Still
worth doing before `SYNC-09`–`SYNC-13` execute rather than after, because the fix changes what they
observe.

**Recommended answer, for whoever takes it:** the same 90 days as the tombstone horizon, swept by
the same job. `pruneTombstones` already runs per user, in a transaction, with `now` injected and
`tombstoneHorizon(now)` already computed, so the horizons cannot drift — which matters, because a
client resyncing at the tombstone horizon is exactly the client most likely to be replaying old
mutation ids. Note this is a *behaviour* change and not only a cleanup: once ids expire, a
delete-then-recreate on the same id past the window stops being de-duplicated, and an `invalid`
result a client is replaying in order to re-read stops being replayable. Both are acceptable at 90
days; neither is at 90 minutes. That is the one judgement call left in it, and it is Backend Dev's
to make with the number written down.

### GAP 4 — Does a forced session clear wipe undrained local writes? — **CLOSED, FIXED AND RE-TESTED**

**Closed by `1d68717` and `b1f7d7f`.** The answer to the question was "it does not, and never
did"; the two defects reading the code turned up are both fixed. The store now carries its owner
(`meta.ownerUserId`, schema v2) and a session starting under a different one wipes it before the
first read, logout wipes as rule 14 always said it did, and the forced clear on `token_invalid`
still does not — which is the branch `AUTH-12` asserts. A wipe rather than a per-user partition,
deliberately: partitioning would leave every query in the app, including every one not yet
written, one forgotten `WHERE userId = ?` away from the same leak.

`AUTH-18` and `AUTH-19` now assert the fixed behaviour. **Re-testing them produced GAP 11**, two
narrower defects the fix did not reach. The record below is kept as history.

I filed this as a question for Chief. Reading the landed client instead of waiting answered it, so
it is no longer a decision anyone owes QA — it is two bugs against `mobile/`. `AUTH-12` is
unparked; `AUTH-18` and `AUTH-19` are the new cases, both expected to fail.

**The data-loss half resolved to the safe branch.** Both paths that end a session — explicit
`signOut()` and the forced clear on `401 token_invalid` — go through one `discard()` in
`mobile/src/auth/session.ts`, which calls `tokenStore.clear()` and publishes `anonymous`. It never
touches SQLite. So a user who falls past the 60-day refresh window keeps their undrained writes
and pushes them after re-login, which is exactly what §5.3 of `02-offline-and-sync.md` argues for
on the analogous resync path. The outcome I was most worried about — unsynced work destroyed with
no dialog — **is not what the client does.** Asserted by `AUTH-12`.

**Defect 1: logout does not do what the design says, and the dialog it shows is false.**
`04-expense-list.md` §Behaviour rule 14 specifies that logout **wipes the local database**, and
when the outbox is non-empty the confirm dialog says `Changes that have not synced yet will be
lost.` Neither is true of `signOut()`. Low severity read alone — it errs toward keeping the user's
data, and only the copy is wrong. Covered by `AUTH-18`.

**Defect 2 — the real one: the local store has no user partition, so a second account on the
device inherits the first's data.** No local table carries a `userId`
(`mobile/src/db/migrations.ts` v1 — `categories`, `expenses` and `outbox` are all unscoped),
`openLocalDatabase()` opens one fixed file `expense-tracker.db` for whoever is signed in
(`mobile/src/db/open.ts`), `createAppContainer` opens it before and independently of
`session.initialize()` (`mobile/src/bootstrap/container.ts`), and no code path clears it on a
session change. Two consequences, and they differ in urgency:

- **Live today.** Log out, log in as a different account, and Home renders the previous user's
  expenses and month total while Categories renders their renamed categories. No sync engine is
  needed for this; the read queries have no user filter to begin with. Covered by `AUTH-19`
  steps 1–4.
- **Latent until the drain ships.** Undrained outbox entries carry no user id either, so the first
  push after a different user logs in sends the previous user's expenses **under the new user's
  bearer token**, and the server correctly files them into the new user's account. There is no
  `mobile/src/sync/` yet, so this is not reachable this minute — it arrives with the drain.
  Covered by `AUTH-19`'s second half.

Defect 1 is why defect 2 is reachable, so they are one fix. **This is for Mobile Dev, not Chief**,
and it is worth fixing *before* the sync drain lands rather than after — the same reasoning as
GAP 3. The one thing still genuinely undecided is a small design question rather than a blocker:
whether the fix partitions the database per user (a separate file, or a `userId` column) or wipes
it when a session starts under a different user id than the one stored. Either closes both cases;
partitioning additionally preserves a shared-device user's data across a re-login, wiping does
not.

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
`PATCH /v1/expenses/{id}`; lines 493, 574, 825, 884). Re-verified 9 Oct: those four line numbers
are unchanged, and `immutable_field` has exactly one producer anywhere in `backend/src` —
`sync/batch.ts` — so no REST handler can emit it.

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
- [ ] Log out, then log in as a **different** account → an empty month and six seeded categories,
      **not** the previous user's expenses (`AUTH-19`). With undrained writes left behind, the
      first push after the switch must not file them into the new account
- [ ] Log out with a non-empty outbox → whatever the dialog promises is what actually happens to
      the local database (`AUTH-18`)
- [ ] A session whose refresh token has expired → Welcome with the expired banner, and the
      undrained outbox **still intact**; log back in as the same user and it drains (`AUTH-12`)
- [ ] A sign-in that fails at the last step → the previous user's local rows are still there, and
      the app does not come back authenticated on the next launch (`AUTH-20`, `AUTH-21`)
- [ ] Log out and log in as a different account **while a request is still in flight** (throttle to
      the slowest proxy profile in §2 first) → the stalled request fails rather than completing
      under the new account's token, and nothing of the previous user's appears in the new
      account's month (`AUTH-23`, `AUTH-24`)
- [ ] Let an access token expire with the app open, then act → the action completes after one
      silent refresh, with no re-login prompt and no duplicate write (`AUTH-27` is the unit half;
      this is the device half, and the refresh is invisible when it works)

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
- [ ] Delete a category with expenses **offline**, then kill the app before it can sync, then
      reconnect → the next push carries the tombstone **and** every reassigned expense, and no
      expense is left pointing at the deleted category on the server (`SYNC-41`, GAP 15). This is
      the one category step whose failure is invisible on the device that did it: the local
      reassignment always looks right, and only a second device or the server shows the orphan
- [ ] The default category offers no delete affordance anywhere
- [ ] A duplicate name is blocked case-insensitively, offline
- [ ] Add a category named `vacation` → it sorts between `Transport` and `Uncategorized`, and the
      default stays the last row (`CAT-15`, `CAT-16`) — the seeded six cannot show this

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
- [ ] Two devices on one account syncing **at the same moment** — every row the server holds
      reaches both exactly once, and neither ends on a revision the other skipped
      (`SYNC-53`, `SYNC-55`, `SYNC-56`). The failure here is permanent and silent on the device
- [ ] The same row edited on two devices converges on the newer `updatedAt`, loser overwritten,
      user not notified
- [ ] Edit **one** expense twice offline, with another device editing it in between, then
      reconnect → check the server row field by field, not just that it synced. Two outbox entries
      resolve per field, so the amount and the note can come from different devices (`SYNC-48`,
      GAP 17). Whatever `02-offline-and-sync.md` §2 rule 2 says by then is what this must match
- [ ] A `+6h` device clock does not win the next conflict
- [ ] Force-stop mid-push → no expense lost and none duplicated
- [ ] Pill state 1 renders **nothing**; `Try again` exists only in the error state
- [ ] A row rejected as `invalid` is flagged on the row, still counts toward the total, and the
      pill stays out of its error state

**Contract**

- [ ] Another user's id is `404`, never `403`, on every `/{id}` route
- [ ] Every non-2xx body is the `ApiError` envelope with a code from `ERROR_CODES`
- [ ] `GET /v1/health` returns `503` when Postgres is down
- [ ] Both ends of the money range — `0` and `999999999999` — save and read back as exactly that
      JSON **number**, on the REST and the sync paths (`EDGE-01`, `EDGE-02`)
- [ ] The mobile client, driven against a real server, completes the REST surface, a cursor-paged
      list, a push/pull round trip and a `204` with no `ResponseShapeError` (`API-13`–`API-18`) —
      this is the only check that runs one side's requests through the other's parser
- [ ] Install the **previous** release on one device, point it at the current server and use it —
      list a month, pull, push, let an access token expire. Any `ResponseShapeError` means a
      response field was added since that build, and by GAP 19 that is a `/v2` change, not the
      additive one `/v1` advertises (`API-20`–`API-24` are the unit half; this is the only check
      that sees a real version skew, and it cannot be run until there is a previous release)
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
