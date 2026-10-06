# API contract

Two files, one contract:

| File | Is the source of truth for |
| --- | --- |
| [`openapi.yaml`](./openapi.yaml) | The **HTTP surface** — paths, methods, status codes, headers, and the error `code` each operation can return. |
| [`../../shared/src/`](../../shared/src) | The **bodies** — one zod schema per request/response body, with the TypeScript types inferred from them. |

They are checked against each other by `shared/tests/contract.test.ts`, which fails the
build if they disagree. Neither one is "the docs for" the other.

## Why it is split this way

`shared/` is the anti-drift mechanism. A wire shape is declared exactly once, as a zod
schema; the backend validates incoming requests with it and the mobile client infers its
types from it. There are no hand-written interfaces sitting alongside, so changing a shape
without changing `shared/` breaks the build rather than breaking a device in the field.

`openapi.yaml` carries what a zod schema cannot: which status a given failure comes back
as, which headers are set, and the prose explaining *why* the protocol is shaped this way.
Each operation also lists its possible error codes under `x-errorCodes`.

## Using it

```ts
import { ExpenseCreateRequest, type Expense } from '@expense-tracker/shared';

// Backend: validate at the edge. Unknown fields are rejected, not ignored.
const body = ExpenseCreateRequest.parse(req.body);

// Mobile: the type is inferred from the same declaration.
const expense: Expense = await post('/v1/expenses', body);
```

Useful exports beyond the schemas:

- `LIMITS` — page sizes, the sync batch cap, field lengths, the clock-skew clamp, the
  tombstone horizon. Import these rather than hard-coding the numbers on either side.
- `ERROR_CODES` / `ERROR_CODE_STATUS` — the stable code list and the status each maps to.
- `API_ROUTES` — the machine-readable route table, mirrored from `openapi.yaml`.
- `DEFAULT_CATEGORIES`, `UNCATEGORIZED_NAME` — what signup seeds.

Render the spec while you work with `pnpm redocly preview-docs docs/api/openapi.yaml`, and
validate a change with `pnpm lint:api`.

## Start here

Read the `POST /v1/sync` and `GET /v1/sync` operation descriptions in full before
implementing either side. They are long on purpose: both sides implement the protocol
independently, and the rules that make last-write-wins actually converge (the revision
watermark, the `now + 5min` clamp, `clientMutationId` idempotency, categories-before-
expenses ordering, the tombstone horizon) are each there because omitting it produces a
bug that only shows up on a real device with a real network.

## Changing the contract

Additive changes within `/v1` are fine — a new optional field, a new endpoint. Anything
that could break a shipped client is a `/v2` concern.

Either way, edit `openapi.yaml` and `shared/src/` in the same commit, run
`pnpm lint && pnpm typecheck && pnpm test`, and raise the change with Chief so the other
side hears about it before it breaks.
