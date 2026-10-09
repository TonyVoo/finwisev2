# Expense Tracker — backend

REST API for the Expense Tracker MVP. Node 22, Express 5, TypeScript (strict), Postgres 16+
via Prisma.

The HTTP surface is defined by [`docs/api/openapi.yaml`](../docs/api/openapi.yaml), and the
request/response bodies by the zod schemas in [`shared/`](../shared). Those two are the
contract the mobile app builds against; the architectural decisions behind them live in
[`docs/PLAN.md`](../docs/PLAN.md).

---

## Running it locally

### 1. Postgres

You need a Postgres 16+ server. Any instance will do; the quickest is Docker:

```bash
docker run -d --name expense-pg \
  -e POSTGRES_USER=expense \
  -e POSTGRES_PASSWORD=expense \
  -e POSTGRES_DB=expense \
  -p 5432:5432 \
  postgres:17
```

You do **not** need to create the `expense_tracker` database by hand — `pnpm migrate:dev`
creates it if it is missing, and the test suite creates its own database too (see below).

### 2. Environment

```bash
cp backend/.env.example backend/.env
```

Then edit `backend/.env` so `DATABASE_URL` matches your server's credentials, and set
`JWT_SECRET` to something at least 32 characters long:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`.env.example` documents every variable and its default. Two notes on how it is loaded:

- `backend/.env` is loaded with `override: true`, so it beats anything already exported in
  your shell. In a workspace it should never be ambiguous which database you just migrated.
- `NODE_ENV` is the exception and is **not** taken from the file. It says what the process
  _is_, which is decided by how it was started. See `src/loadEnv.ts` for why that matters.

### 3. Migrate

Migrations are checked in under `src/db/migrations/` and are always _applied_, never
`db push`ed — the migration contains CHECK constraints, partial indexes and the
`next_revision()` function, none of which Prisma's schema language can express.

```bash
pnpm --filter @expense-tracker/backend migrate:dev      # local: create/apply + regenerate client
pnpm --filter @expense-tracker/backend migrate:deploy    # CI/production: apply only
pnpm --filter @expense-tracker/backend migrate:status    # what is pending
```

`migrate:dev` needs a throwaway shadow database to diff against. It will create one
automatically; if your Postgres user lacks `CREATEDB`, point `SHADOW_DATABASE_URL` at a
database you have made for the purpose.

### 4. Run

```bash
pnpm --filter @expense-tracker/backend dev    # tsx watch, reloads on change
pnpm --filter @expense-tracker/backend start  # no watcher
```

Then check it is up:

```bash
curl -s localhost:3000/v1/health
# {"status":"ok","version":"0.1.0","time":"2026-10-08T12:00:00.000Z","db":"up"}
```

Or run the scripts from inside `backend/` as plain `pnpm dev`, `pnpm migrate:dev`, etc.

### 5. Scheduled maintenance: pruning tombstones

```bash
pnpm --filter @expense-tracker/backend prune:tombstones
```

Deletes are soft, so tombstones accumulate; they are pruned after 90 days
(`LIMITS.TOMBSTONE_HORIZON_DAYS`). This is a cron job, not a request path — `GET /v1/sync`
is a read, and making it write would put a counter update on every poll from every device.
Run it daily; it is safe to run more often and safe to miss, since nothing but disk use
depends on its timeliness.

The same job sweeps the sync idempotency ledger (`sync_mutations`) on the same 90-day
window, which is the only thing bounding that table. Unlike the tombstone sweep, that part
*is* a behaviour change at the boundary — past 90 days a `clientMutationId` is forgotten
and a replay of it is applied afresh rather than de-duplicated — so if you ever shorten the
horizon, read `docs/PLAN.md` §4 first. The number belongs to both windows deliberately.

It is not merely cleanup. Each run records how far it got in
`revision_counters.pruned_through_revision`, and `GET /v1/sync` answers
`resyncRequired: true` to any `since` below that watermark. Without the watermark, a client
that had been offline longer than the horizon would ask for changes since a cursor whose
tombstones no longer exist, never be told about those deletes, and keep the deleted rows
forever. **If you run the prune without the watermark write (or reset the column), dormant
clients silently resurrect deleted rows.**

---

## Tests

```bash
pnpm --filter @expense-tracker/backend test        # vitest + supertest, once
pnpm --filter @expense-tracker/backend test:watch
```

The suite talks to a real Postgres — the schema is most of the behaviour worth testing, so
there are no database mocks. It bootstraps itself: `tests/globalSetup.ts` creates the test
database if it is missing and runs `prisma migrate deploy` against it before any test file.

It runs against `TEST_DATABASE_URL`, defaulting to `DATABASE_URL` with `_test` appended to
the database name. **The database name must end in `_test`** or the suite refuses to start:
it truncates every table between tests, and that guard is what keeps it off your
development data.

From the repo root, `pnpm lint && pnpm typecheck && pnpm test` runs the whole workspace.
That has to pass before any backend task is handed back.

---

## Layout

```
backend/src/
├── routes/       # one module per resource; thin — parse, call a service, respond
├── services/     # business logic: auth, CRUD, the sync pull/push, tombstone pruning
├── sync/         # the sync resolver's pure decisions + push-batch parsing
├── middleware/   # auth gate, error envelope, zod request validation
├── db/           # Prisma schema, checked-in migrations, client, row mappers
├── auth/         # argon2id hashing, access-token minting, refresh-token hashing
├── http/         # response helpers and request typing
├── scripts/      # scheduled jobs (tombstone pruning)
├── config.ts     # the environment, parsed and validated once at startup
└── server.ts     # listener; `app.ts` builds the Express app the tests mount
```

A few decisions that are easy to undo by accident:

- **Tenancy comes from the access token, only.** `requireAuth` is the one place that sets
  `req.userId`, and no request body, query parameter or path segment in this API carries a
  `userId`. Every query is scoped by it. `tests/tenancy.test.ts` enforces both halves.
- **`revision` is a per-user, gap-free, monotonic counter assigned by the server on write**
  (`src/db/revision.ts` + `next_revision()` in the first migration). It is the watermark
  `GET /v1/sync?since=` walks. It is not a timestamp and not a global sequence; both of
  those silently fail to deliver rows. Allocate it inside the transaction that does the
  write, or a rollback leaves a hole in the sequence.
- **Deletes are soft** (`deletedAt`). A sync protocol cannot propagate a hard delete: an
  absent row is indistinguishable from one the client never saw.
- **Money is `amountMinor` (integer) + a 3-letter `currency`.** Never a float, ever.
- **`expenses.date` is a calendar DATE**, not a timestamp — it must not shift by timezone.
  `db/mappers.ts` reads and writes it through UTC, because anything that touches the local
  zone turns `2026-10-06` into `2026-10-05` on every server west of Greenwich.
- **Deleting a category reassigns its expenses to the `isDefault` one**, in the same
  transaction, and never cascade-deletes them. The fallback is resolved by the flag, never
  by matching the name `Uncategorized`, which a rename would break. The delete locks the
  category `FOR UPDATE` and an expense write locks its category `FOR KEY SHARE`, which is
  what stops a create racing the delete and landing on a dead category.
- **`GET /v1/expenses` is keyset-paginated** on `(date DESC, id DESC)`, not offset. Offset
  pages skip or repeat rows whenever a write lands between two requests, and with a client
  syncing in the background that is the normal case. An undecodable cursor is a loud
  `400 invalid_cursor`, never a silently empty page — an empty page reads as "no more
  data" and the client stops paginating with rows still unread.
- **`POST` is idempotent on a re-posted id, but is not an upsert.** The stored row comes
  back unchanged with no new `revision`; `PATCH` is how a field changes.
- **Every non-2xx is the contract's error envelope**, `{ error: { code, message, details? } }`,
  produced centrally by `middleware/errorHandler.ts`.

### The sync endpoints

`/v1/sync` carries more load-bearing detail than the rest of the API put together, and
every item below is a bug that would be invisible until it bit a user on a device.

- **The pull reads its page and the user's watermarks in one `RepeatableRead` snapshot.**
  Categories and expenses are two tables, so a page is two queries; under the default
  `READ COMMITTED` each gets its own snapshot, which is enough to return revision 42 while
  missing the revision 41 that committed between them. `nextCursor` then advances past 41
  and that row is never delivered to that device again. One snapshot makes the two queries
  agree about what has committed.
- **The push is one transaction with a savepoint per item.** "One transaction" and "one bad
  row must not fail the batch" are otherwise contradictory: once a statement raises,
  Postgres marks the transaction aborted and every later statement fails. A plain
  `try`/`catch` would leave the batch unable to do anything else, so
  `ROLLBACK TO SAVEPOINT` is what returns it to a usable state — and it also returns the
  revision the failed item allocated, keeping the sequence gap-free.
- **The idempotency ledger insert is the last statement of an item's savepoint.** The key
  is `(user_id, client_mutation_id)`, so two retries racing on two connections both try to
  insert it; the loser rolls back its own write entirely and replays the winner's recorded
  outcome. Inserting _first_ would be the obvious ordering and the wrong one — the loser
  would have to undo a write it had already made.
- **A replay reports the recorded status with a freshly-read row.** The status has to be the
  original one, or it is not idempotent; the row must be current, because the client
  overwrites its local copy with it and a stale snapshot would roll the row back.
- **Items are validated individually, not as one body.** A `400` for one malformed row
  would stop an offline client's outbox draining forever, taking every good row behind it
  with it. The only exception is an item missing `entity`/`id`/`clientMutationId`: there is
  nothing to address a per-record result at.
- **`updatedAt` is clamped to `now + 5 minutes` before comparing and storing**, and LWW ties
  go to the server. Without the clamp, one device with a badly-set clock makes a row
  unfixable from every other device, permanently.
- **Every result carries the authoritative row, conflicts included.** That is what makes
  clients converge rather than drift; `tests/sync.convergence.test.ts` drives two simulated
  devices through a divergence and asserts both land on the server's state.
