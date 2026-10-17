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

## Running the app

Verified end to end on 2026-10-17 against an Android emulator (Pixel 9, API 36) and Expo
Go: sign-in, the expense list, the Summary donut, add, swipe-to-delete, and an offline
write that reached Postgres after reconnecting.

**1. Start the API.** `pnpm start` in `backend/` runs the compiled server but does *not*
generate the Prisma client first — only `test` and `typecheck` do. On a fresh checkout:

```bash
pnpm --filter @expense-tracker/backend run generate
pnpm --filter @expense-tracker/backend run migrate:deploy
pnpm --filter @expense-tracker/backend run start
```

`curl http://localhost:3000/v1/health` should answer `{"status":"ok", ... "db":"up"}`.

**2. Start a device.** Any booted Android emulator or a physical phone with Expo Go.

```bash
emulator -avd <your-avd> &
adb wait-for-device
```

**3. Point the app at the API.** The app refuses to start without
`EXPO_PUBLIC_API_BASE_URL` (see `mobile/.env.example`) — it fails loudly rather than
defaulting to `localhost`, because a build silently pointing at a developer's machine
looks exactly like "the app is permanently offline".

The value depends on how the device reaches your host:

| Device                | Value                      |
| --------------------- | -------------------------- |
| Android emulator      | `http://10.0.2.2:3000`     |
| Physical phone on LAN | `http://<your-lan-ip>:3000` |
| Via an adb tunnel     | `http://localhost:3000`    |

The tunnel is the most reliable on an emulator, because it survives the host changing
LAN address:

```bash
adb reverse tcp:3000 tcp:3000
```

**4. Start Metro and open the app.**

```bash
cd mobile
EXPO_PUBLIC_API_BASE_URL=http://localhost:3000 npx expo start --android
```

### Notes

- **Web is not a target.** `expo export --platform web` fails in `expo-sqlite`'s web
  backend (a missing `wa-sqlite.wasm` asset). The MVP targets iOS and Android; both
  bundle clean via `pnpm --filter @expense-tracker/mobile run bundle:check`.
- **Airplane mode breaks the Expo Go dev channel**, not the app. If you toggle it to
  test offline behaviour while Metro is served over the LAN, Expo Go shows "Cannot
  connect to Expo CLI" — the already-loaded app keeps working. Serving Metro over
  `adb reverse tcp:8081 tcp:8081` avoids it.

## Checks

```bash
pnpm lint       # eslint + redocly (the OpenAPI spec is linted too)
pnpm typecheck
pnpm test
```

All three pass before any task is handed back. The backend suite needs a running Postgres;
see [`backend/README.md`](backend/README.md#tests).
