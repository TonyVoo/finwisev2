# Deploying the backend

The API is one stateless Node process plus Postgres. This guide takes it from the image to a running, safe
production service. Nothing here has been run against a hosting provider; the image itself was built and run
locally (see _Try it locally_).

## What you need

- **Postgres 16+**, with automated backups (a managed database is the easy way).
- **One container** from `backend/Dockerfile`, behind **HTTPS** (a platform's load balancer, or a proxy you run).
- A way to run **one command on a schedule** (the tombstone prune, below).

Run **one** API instance. The login, password-reset, join-code and receipt-scan rate limiters, and the Gemini
daily budget, count in memory. With several instances each counts separately, so every limit multiplies by the
instance count. That is fine to accept deliberately; it is not fine to find out later.

## The image

Build from the repository root:

```bash
docker build -f backend/Dockerfile -t expense-tracker-api .
```

It installs from the lockfile, generates the Prisma client, runs as the non-root `node` user in
`NODE_ENV=production`, and checks `GET /v1/health` (which also checks the database). Secrets are never in the
image; everything comes from the environment at run time.

## Configuration

Set these on the service (not in a file in the image). `backend/.env.example` documents each.

| Variable                                                                                                              | Required    | Notes                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                                        | yes         | Postgres connection string. Use the provider's TLS option if it offers one.                                                                                                   |
| `JWT_SECRET`                                                                                                          | yes         | 32+ random characters: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Production refuses an obvious placeholder (see below).               |
| `TRUST_PROXY`                                                                                                         | yes, decide | Number of proxies in front of the process. **Read the next section.**                                                                                                         |
| `PORT`                                                                                                                | no          | Default 3000. Most platforms set it for you.                                                                                                                                  |
| `RESEND_API_KEY`, `MAIL_FROM`                                                                                         | yes in prod | Without both, password-reset and verification emails are not sent in production. `MAIL_FROM` must be on a domain verified with Resend.                                        |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_DAILY_BUDGET`, `GEMINI_QUICK_ADD_DAILY_BUDGET`, `GEMINI_RECAP_DAILY_BUDGET` | optional    | Receipt reading with a vision model (`docs/design/14-ai-receipt-reading.md`). Free-tier requests may be used by Google to improve its products; say so in the privacy policy. |
| `OCR_SPACE_API_KEY` / `GOOGLE_VISION_API_KEY`                                                                         | optional    | Receipt reading by OCR; also the fallback when Gemini fails or its budget is spent.                                                                                           |
| `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS`                                                                  | no          | Defaults match the API contract.                                                                                                                                              |

`NODE_ENV=production` is set by the image. In production the server rejects a `JWT_SECRET` that looks like a
placeholder (`change-me`, `dev-only`, too few distinct characters), because copying `.env.example` is the easiest
way to deploy a key everyone who has seen the repository can sign tokens with. Rotating the key signs everyone's
access token out; refresh tokens survive.

## Migrations

Apply them **before** the new version takes traffic, as a one-off command with the production `DATABASE_URL`:

```bash
docker run --rm -e DATABASE_URL=... expense-tracker-api pnpm migrate:deploy
```

On a platform, this is its release or pre-deploy command. It is safe to run repeatedly (applied migrations are
skipped), and Prisma takes a lock so two runs cannot interleave. Migrations here are additive, so the previous
version keeps working while the new one starts. Never run `migrate:dev` or `migrate:reset` against production.

## The scheduled job

`pnpm prune:tombstones` deletes sync tombstones and idempotency-ledger rows older than 90 days. **Run it at least
daily.** Missing a run defers the tombstone cleanup harmlessly, but this job is also the only thing bounding the
`sync_mutations` table, so a lapsed schedule is a table growing without limit.

It is the same image and the same environment as the API, with a different command:

```bash
docker run --rm -e DATABASE_URL=... expense-tracker-api pnpm prune:tombstones
```

Use whatever your platform offers: a scheduled job or cron service running that command, or a host `cron` entry
calling the line above. A good run logs `prune:tombstones finished` with counts; a failure logs
`prune:tombstones failed` and exits non-zero, which is what your scheduler should alert on. It is idempotent, so
running it twice, or catching up after an outage, is fine.

## TRUST_PROXY

This one setting decides whether the login rate limiter works. The server must know how many proxies sit in front
of it to find the real client address in `X-Forwarded-For`.

- **Too low** (`false` behind a proxy): every request appears to come from the proxy's address, so all users
  share one budget of failed logins. A few bad passwords from anyone locks everyone out.
- **Too high** (more than you really have): a client can send its own `X-Forwarded-For` and get a fresh budget
  per guess, so the limiter does nothing against password guessing.

Set it to the **exact number** of proxies you run:

| Setup                                                                 | `TRUST_PROXY`                       |
| --------------------------------------------------------------------- | ----------------------------------- |
| The container is exposed directly, no proxy                           | `false`                             |
| A platform's load balancer (Render, Railway, Fly, Heroku and similar) | `1` (confirm with the checks below) |
| Cloudflare (or another CDN) in front of a platform load balancer      | `2`                                 |
| Your own nginx or Caddy behind a platform load balancer               | `2`                                 |

Providers change how many hops they add, so verify rather than trust the table. With the service live (use a
made-up email each time, so the per-email limit is not the one you hit):

1. **Forgeable?** Send 60 failed logins, each with a different forged header. If you never see a `429`, the
   number is too high:

   ```bash
   for i in $(seq 1 60); do
     curl -s -o /dev/null -w "%{http_code} " -X POST https://YOUR-API/v1/auth/login \
       -H 'Content-Type: application/json' -H "X-Forwarded-For: 10.9.$i.1" \
       -d "{\"email\":\"nobody$i@example.com\",\"password\":\"wrong-password-$i\"}"
   done; echo
   ```

   Correct: `401` for the first 50, then `429`.

2. **Shared?** Run the same loop (without the forged header) from your laptop until you see `429`, then from your
   phone on mobile data. If the phone is also refused straight away, the number is too low.

The limits are 50 failed logins per address and 10 per email, per 15 minutes.

## Before real users

- **HTTPS only**, and `EXPO_PUBLIC_API_BASE_URL` for the preview and production builds set to that `https://`
  address (in `mobile/eas.json` under `env`, or as an EAS environment variable). The app's config tests refuse a
  non-HTTPS URL there.
- **Backups on, and one restore tried.** The server holds the only copy of everything a user synced.
- **Alerts** on: `GET /v1/health` returning `503`, `prune:tombstones failed`, and a run of
  `receipt reading failed` warnings (a model or OCR provider is down; users fall back automatically).
- **Logs** are JSON, one object per line. They carry ids and error classes, never passwords, tokens, photos or
  receipt text.
- `docs/RELEASE.md` lists the store-side items; `docs/qa/DEVICE_CHECKLIST.md` is the pre-release test pass.

## Try it locally

`docker-compose.yml` runs the real image with a throwaway Postgres, the migrations, and the API, on port 3100 so
it does not clash with a dev server on 3000:

```bash
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))") \
  docker compose -p expense-trial up --build
curl http://localhost:3100/v1/health
docker compose -p expense-trial down -v
```

It is a trial of the container, not a way to host: the database password is a throwaway and there is no HTTPS.
