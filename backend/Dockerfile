# Expense Tracker API image. Build from the repository root (the shared contract lives beside the backend):
#
#   docker build -f backend/Dockerfile -t expense-tracker-api .
#
# Configuration comes from the environment at run time (docs/DEPLOY.md); nothing secret is in the image.
FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Dependencies first, from the manifests alone, so a source change does not reinstall them.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY mobile/package.json mobile/
RUN pnpm install --frozen-lockfile --filter @expense-tracker/backend...

COPY tsconfig.base.json ./
COPY shared/ shared/
COPY backend/ backend/

# `prisma generate` loads prisma.config.ts, which wants a DATABASE_URL to exist; the value is never used
# to connect and does not survive into the final environment.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    pnpm --filter @expense-tracker/backend exec prisma generate

ENV NODE_ENV=production
WORKDIR /app/backend
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# node itself is PID 1 (not pnpm), so SIGTERM reaches the server's graceful shutdown.
CMD ["node", "--import", "tsx", "src/server.ts"]
