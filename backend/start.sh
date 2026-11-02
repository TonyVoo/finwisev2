#!/bin/sh
# Start the API after applying any pending migrations (docs/DEPLOY.md, "Free hosting for one person").
#
# For hosts with no pre-deploy command. Safe with a single instance: applied migrations are skipped and
# Prisma takes a lock. `exec` makes node the process the host signals, so a stop reaches its graceful shutdown.
set -e
# The prisma binary directly, not through pnpm: pnpm is not prepared for the non-root user the image runs as,
# and corepack would download it on every start. The workspace hoists it to the root `node_modules`.
../node_modules/.bin/prisma migrate deploy
exec node --import tsx src/server.ts
