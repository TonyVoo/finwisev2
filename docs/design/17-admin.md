# 17 - An admin page

A page for the person who runs the server: how the service is doing, and who has an account. Decided with the
product owner:

- **It lives inside the backend, at `/admin`.** A React page served by the same process; no extra hosting.
- **Only listed accounts may open it.** The `ADMIN_EMAILS` setting (comma-separated) names them. They sign in with
  their ordinary account; anyone else gets a plain `404`, as if the page did not exist.
- **Overview and user management.** Counts and health, and a list of accounts with disable, enable and delete.

## What it never shows

Nobody's spending. The server holds every user's expenses, notes and receipts, and an operator page is exactly where
that would leak. So the overview is **counts only**, and the account list shows **who** (email, name, currency, when
they joined, when they were last active, how many expenses they have) and never **what**: no amount, note,
category name, merchant or receipt. There is no screen that opens an account's data, and no "sign in as".

## The API

Under `/admin/api`, outside `/v1`: it is an operator console, not part of the contract the mobile app is built
against, so it is not in `docs/api/openapi.yaml` and the app never calls it. It uses the same access token as the
app (`Authorization: Bearer`), and every route first checks the allow-list.

| Route                                | What it does                                                           |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `GET /admin/api/me`                  | `{ email }`: lets the page tell "signed in" from "allowed in"          |
| `GET /admin/api/overview`            | The counts below                                                       |
| `GET /admin/api/users`               | Accounts, newest first. `search` (part of an email), `limit`, `cursor` |
| `POST /admin/api/users/{id}/disable` | Sign the account out everywhere and refuse its sign-in                 |
| `POST /admin/api/users/{id}/enable`  | Allow it again                                                         |
| `DELETE /admin/api/users/{id}`       | Delete the account and its data. Body `{ "email": "<theirs>" }`        |

- **Not an admin, or not signed in as one: `404 not_found`** for every route, the same answer as an unknown path.
  (No token at all is the usual `401`, from the same middleware as the rest of the API.)
- **An admin cannot disable or delete themselves or another admin** (`403 forbidden`), so a slip cannot lock the
  operator out. Remove an email from `ADMIN_EMAILS` first.
- **Delete asks for the account's email in the body**, so a mistaken id is not enough. It is the same removal as
  an account deleting itself, minus the password: an owner of a household that still has other members is
  `409 household_has_members`, and nothing is deleted.
- **Disabling** sets `users.disabled_at` and revokes the account's refresh tokens. It is enforced everywhere a
  session is used: sign-in is `invalid_credentials`, a refresh is `token_invalid`, and an access token already
  issued stops working at once (the auth middleware reads the account on every request). The account's data is
  untouched, and enabling it brings everything back.

### The overview

```
server     version, uptime, time
database   size in bytes
users      total, verified, disabled, new in the last 7 / 30 days, active in the last 7 / 30 days
households total, memberships
data       live expenses, categories, goals, recurring rules, receipt photos (counts across all accounts)
gemini     whether a key is set, the model, and today's use against each daily budget
```

"Active" means the account refreshed its session in that window; the app does so about hourly while open, and no
other usage is recorded, so it is a floor. Households' hidden books are not accounts and are never counted as
users.

## The page

A small **React** app (`admin/`: Vite, React 19 and TypeScript, with its own tests), built into
`backend/admin-dist` and served by the backend at `/admin`. The Dockerfile builds it in a first stage, so the
deployed image carries only the built files. It signs in with email and password, then shows the overview and the
account list; deleting asks you to type the account's email in a dialog.

It has no data in it, so serving it needs no sign-in; every figure comes from the API after sign-in. The token
lives in the page's memory only, so closing the tab signs out. React escapes everything it renders and the page
never sets HTML from server text, and it is served with a content-security policy that allows no inline script, no
framing and no outside requests. Only the index and the built files under `/admin/assets` are served; a
file name with anything but letters, digits, dot, dash and underscore is a `404`.

Build it with `pnpm --filter @expense-tracker/admin build`; develop it with `pnpm --filter @expense-tracker/admin dev`
(proxying to a backend on port 3000). Until it is built, `/admin` answers `503` with that command.

## Consequences, stated plainly

- **One more way in.** An admin account is a normal account with a weak spot: its password protects every user's
  account list. Use a strong password, and keep `ADMIN_EMAILS` to yourself.
- **Free-tier sleep.** The overview works only while the server is awake, like the rest of the app.
- **Counts are live queries.** Fine at this size; an index or a cache comes only if a table grows large.

## Not in this version

Seeing or editing anyone's data, signing in as someone, bulk actions, an audit log beyond the server log (each
admin action is logged with the admin's and the target's ids), roles other than "admin", and email to users.
