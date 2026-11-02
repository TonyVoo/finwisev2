#!/bin/sh
# Start the API after applying any pending migrations (docs/DEPLOY.md, "Free hosting for one person").
#
# For hosts with no pre-deploy command. Safe with a single instance: applied migrations are skipped and
# Prisma takes a lock. `exec` makes node the process the host signals, so a stop reaches its graceful shutdown.
set -e
pnpm migrate:deploy
exec node --import tsx src/server.ts
