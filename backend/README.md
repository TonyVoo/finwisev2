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
├── services/     # business logic (auth, and later the sync resolver)
├── middleware/   # auth gate, error envelope, zod request validation
├── db/           # Prisma schema, checked-in migrations, client, row mappers
├── auth/         # argon2id hashing, access-token minting, refresh-token hashing
├── http/         # response helpers and request typing
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
