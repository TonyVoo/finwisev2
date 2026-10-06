# Expense Tracker — MVP Scope & Architecture

Owner: Chief (Project Lead) · Status: active · Last updated: 2026-10-06

This is the agreed plan of record for the MVP. Task-level detail lives on the
Paperclip tasks; this doc holds the decisions everyone builds against.

---

## 1. Scope

### In scope (MVP)

| # | Feature | Notes |
|---|---------|-------|
| 1 | Sign up / log in | Email + password. Session survives app restarts. |
| 2 | Add / edit / delete expense | Amount, category, date, note. |
| 3 | Category management | Create, rename, delete. Defaults seeded on signup. |
| 4 | Monthly totals + simple chart | Total for a month, broken down by category. |
| 5 | Offline use + background sync | Full read/write offline; syncs when connectivity returns. |

### Out of scope (explicitly not MVP)

Receipt photos/attachments, budgets and limits, recurring expenses, multi-currency
conversion, shared/household accounts, social or SSO login, a web client, push
notifications, CSV export, and server-side reporting endpoints. Do not build these;
raise a follow-up task if one turns out to be load-bearing.

### Non-functional targets

- Cold start to usable expense list: under 2s on a mid-range device.
- Every screen in scope works with the network off, including writes.
- Sync of a day's worth of changes completes in a single round trip.

---

## 2. Repo layout

Single repo, pnpm workspaces. Node 22 LTS, TypeScript everywhere, strict mode on.

```
expense-tracker/
├── docs/
│   ├── PLAN.md              # this file
│   ├── api/openapi.yaml     # API contract (source of truth, owned by Backend Dev)
│   ├── design/              # flows + screen specs (owned by Designer)
│   └── qa/TEST_PLAN.md      # test plan (owned by QA Tester)
├── backend/
│   ├── src/
│   │   ├── routes/          # one module per resource
│   │   ├── services/        # business logic, incl. sync resolver
│   │   ├── db/              # Prisma schema + migrations
│   │   └── middleware/      # auth, error envelope, request validation
│   └── tests/               # vitest + supertest
├── mobile/
│   ├── src/
│   │   ├── screens/
│   │   ├── components/
│   │   ├── db/              # expo-sqlite schema, queries, outbox
│   │   ├── sync/            # sync engine
│   │   └── api/             # generated client
│   └── tests/               # jest + @testing-library/react-native
├── shared/
│   └── src/                 # zod schemas + TS types shared by both sides
├── pnpm-workspace.yaml
└── package.json             # root scripts: lint, typecheck, test
```

`shared/` is the anti-drift mechanism: request/response shapes are declared once as
zod schemas, the backend validates with them, and the mobile client infers its types
from them. Changing a wire shape without changing `shared/` should break the build.

---

## 3. Architecture

### Backend

- **Runtime**: Node 22, Express 5, TypeScript.
- **DB**: Postgres 16 via Prisma (migrations are checked in; no `db push` against shared envs).
- **Validation**: zod at the edge, from `shared/`. Reject unknown fields.
- **Auth**: email + password, hashed with argon2id. Access JWT (1h) + rotating refresh
  token (60d, stored server-side as a hash so it can be revoked). Mobile keeps both in
  `expo-secure-store`. A long-lived refresh token is what makes offline-first usable —
  the app must not log the user out because they were offline for a week.
- **Error envelope**: every non-2xx is `{ "error": { "code", "message", "details"? } }`
  with a stable machine-readable `code`.
- **Tenancy**: every query is scoped by `userId` from the token. No endpoint accepts a
  `userId` from the client.

### Mobile

- **Expo (managed), TypeScript**, expo-router for navigation.
- **Local store**: `expo-sqlite` is the single source of truth the UI reads from. The UI
  never awaits the network to render. This is the core offline decision — online is just
  "sync is running", not a different code path.
- **Writes**: go to SQLite immediately, and append to an `outbox` table in the same
  transaction. The screen updates from SQLite; the outbox drains later.
- **State**: TanStack Query over SQLite reads (cache + invalidation), no Redux.
- **Chart**: `victory-native`. One chart, kept simple.
- **Monthly totals** are computed from local SQLite with a SQL `GROUP BY`, so they are
  correct and instant offline. There is no server reporting endpoint in the MVP.

### Data model

Shared fields on every syncable row: `id`, `userId`, `updatedAt`, `deletedAt`, `revision`.

- **users** — `id`, `email` (unique, lowercased), `passwordHash`, `createdAt`.
- **categories** — `id`, `userId`, `name`, `color`, `isDefault`, + shared fields.
- **expenses** — `id`, `userId`, `categoryId`, `amountMinor`, `currency`, `date`,
  `note`, + shared fields.
- **refresh_tokens** — `id`, `userId`, `tokenHash`, `expiresAt`, `revokedAt`.

Two decisions worth calling out:

- **Money is `amountMinor` (integer, e.g. cents) plus a 3-letter `currency`.** Never a
  float, never a string at rest. Single currency per user for the MVP, captured at
  signup, no conversion.
- **`date` is a calendar DATE, not a timestamp.** It is the day the user assigns to the
  expense and must not shift across timezones. `createdAt`/`updatedAt` are `timestamptz`.
  Monthly totals bucket on `date`.

### Deletes

Soft deletes everywhere (`deletedAt`). A sync protocol cannot propagate a hard delete —
the record is simply absent, which is indistinguishable from "never seen it". Tombstones
are the mechanism; see the horizon rule below.

Deleting a category **reassigns** its expenses to the user's `Uncategorized` default
category. It does not cascade-delete expenses — losing spend history to a category
cleanup would be a data-loss bug.

---

## 4. Sync approach

Last-write-wins by `updatedAt`, with the details that make LWW actually work.

### Client-generated IDs

The client mints UUIDv7 primary keys offline. The server accepts them as-is. No
temp-ID-to-real-ID remapping, so a local row's identity never changes and foreign keys
written offline stay valid.

### Pull — `GET /v1/sync?since=<cursor>&limit=<n>`

Returns rows with `revision > cursor`, ordered by `revision`, plus `nextCursor` and
`hasMore`. `revision` comes from a **per-user monotonic sequence assigned by the server
on write** — the cursor is a revision watermark, not a timestamp.

This matters: a timestamp cursor loses writes. Two rows written in the same millisecond,
or a cursor advanced past a row whose transaction had not yet committed, mean a record
that is silently never delivered. A monotonic revision has neither failure mode.

### Push — `POST /v1/sync`

Body is a batch of changed rows: `{ entity, id, fields, updatedAt, clientMutationId }`.
Response is **per record**, so one bad row cannot fail the batch:

- `applied` — incoming `updatedAt` is newer than stored; the write landed.
- `conflict_server_wins` — stored `updatedAt` is newer or equal; the write was dropped.
- `invalid` — validation or referential failure (e.g. unknown `categoryId`).

Every result carries the **authoritative server row**, including on conflict. The client
overwrites its local copy with what it gets back. The server state is what reconciles,
so clients converge instead of drifting.

### Ordering within a batch

The server applies a batch in one transaction, in dependency order: categories, then
expenses. An expense created offline against a category created offline in the same
session therefore syncs in a single round trip. The client also pushes in that order.

### Idempotency

`clientMutationId` is unique per user. A push retried after a dropped response is a
no-op and returns the original result. Without this, a flaky-network retry
double-applies — the single most common offline-sync bug.

### Clock skew

LWW orders on the client's `updatedAt` (the client is the only one who knows when the
user actually made the edit), but the server **clamps it to `now + 5 minutes`**. A device
with a badly-set clock would otherwise write a far-future `updatedAt` and permanently win
every subsequent conflict on that row.

### Tombstone horizon

Tombstones are pruned after 90 days. If `since` is older than the horizon the server
returns `{ "resyncRequired": true }` and the client wipes local state and pulls from
cursor 0. Without this a long-dormant client resurrects deleted rows.

### Scheduling

- **Foreground (the reliable path)**: on app open, on regaining connectivity
  (`@react-native-community/netinfo`), and after a local write settles.
- **Background (best-effort)**: `expo-background-task`. Mobile Dev should confirm the
  current package and API against the pinned Expo SDK before building on it — this area
  has churned (it replaced the deprecated `expo-background-fetch`).

Background execution is throttled by both iOS and Android and must be treated as an
optimisation, never as a correctness guarantee. The app has to be fully correct if
background sync never fires once.

---

## 5. API surface

Contract is `docs/api/openapi.yaml` (Backend Dev owns it; it lands before implementation).

```
POST   /v1/auth/signup        { email, password } -> { user, accessToken, refreshToken }
POST   /v1/auth/login         { email, password } -> { user, accessToken, refreshToken }
POST   /v1/auth/refresh       { refreshToken }    -> rotated token pair
POST   /v1/auth/logout        { refreshToken }
GET    /v1/me

GET    /v1/categories
POST   /v1/categories
PATCH  /v1/categories/:id
DELETE /v1/categories/:id

GET    /v1/expenses           ?from&to&categoryId&limit&cursor
POST   /v1/expenses
PATCH  /v1/expenses/:id
DELETE /v1/expenses/:id

GET    /v1/sync               ?since&limit   -> changes since cursor
POST   /v1/sync                              -> per-record push results
GET    /v1/health
```

The REST CRUD endpoints exist for a thin/online client and for testability. The mobile
app writes through `/v1/sync` — it has one write path, not two.

---

## 6. Sequencing

```
Wave 0   Designer: flows + screen specs          Backend: API contract
            │                                        │
Wave 1      ├──────────────┬─────────────────────────┤
            │              │                         │
         QA: test plan   Mobile: app scaffold    Backend: auth
                             │                        │
Wave 2                       │                   Backend: CRUD -> Backend: sync
                             │                        │              │
                      Mobile: auth screens            │              │
                      Mobile: expense + category ──────┘              │
                      Mobile: totals + chart                          │
                      Mobile: sync engine ────────────────────────────┘
                             │
Wave 3                  QA: execute test plan
```

Rules: the API contract and the designs land before any implementation. QA writes the
test plan early (against contract + designs, so it is ready when features land) and
executes it after. Each task carries its own acceptance criteria.

---

## 7. Working agreements

- **Small commits**, one logical change each. Conventional-commit prefixes
  (`feat:`, `fix:`, `test:`, `docs:`, `chore:`) with a `backend:`/`mobile:`/`shared:` scope.
- **Tests ship with the code**, in the same task. A feature task is not done without them.
  Backend: vitest + supertest. Mobile: jest + @testing-library/react-native.
- **The sync resolver gets unit tests per branch**: applied, conflict, invalid, idempotent
  retry, clamped clock, tombstone horizon. This is the part most likely to be subtly wrong
  and the hardest to debug in the field.
- `pnpm lint && pnpm typecheck && pnpm test` passes before a task is handed back.
- Comment on your task with what you did and what is next. If the contract or a design
  blocks you, say so on the task rather than guessing — a wrong guess about the wire
  format costs both sides a rewrite.
- Contract changes after Wave 0 go through Chief, so the other side finds out before it
  breaks.
