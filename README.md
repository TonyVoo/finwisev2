# Expense Tracker

React Native (Expo) mobile app with an offline-first sync backend.

## Layout

| Path                                             | What it is                                                             |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| [`docs/PLAN.md`](docs/PLAN.md)                   | Plan of record: scope, architecture, data model, sync protocol         |
| [`docs/api/openapi.yaml`](docs/api/openapi.yaml) | API contract — the source of truth for the HTTP surface                |
| [`docs/design/`](docs/design/)                   | Flows and screen specs                                                 |
| [`docs/qa/TEST_PLAN.md`](docs/qa/TEST_PLAN.md)   | Test plan                                                              |
| [`backend/`](backend/README.md)                  | REST API: Node 22 + Express 5 + Postgres. **Setup instructions here.** |
| [`mobile/`](mobile/)                             | Expo app                                                               |
| [`shared/`](shared/)                             | zod schemas + types shared by both sides                               |

`shared/` is the anti-drift mechanism: wire shapes are declared once as zod schemas, the
backend validates with them, and the mobile client infers its types from them. Changing a
wire shape without changing `shared/` breaks the build.

## Getting started

Requires Node 22+ and pnpm 9.

```bash
pnpm install
```

Then follow [`backend/README.md`](backend/README.md) for Postgres, migrations and running
the API.

## Checks

```bash
pnpm lint       # eslint + redocly (the OpenAPI spec is linted too)
pnpm typecheck
pnpm test
```

All three pass before any task is handed back. The backend suite needs a running Postgres;
see [`backend/README.md`](backend/README.md#tests).
