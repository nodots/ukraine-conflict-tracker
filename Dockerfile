# App image for the API and worker. Both run via tsx (no per-app build): this
# keeps the worker's runtime data asset (ukraine-boundary.geojson) resolvable and
# avoids a separate compiled-migrate step. Only @ukraine-tracker/shared is built,
# since api/worker import it through its package exports (dist).
FROM node:22-slim

RUN corepack enable
WORKDIR /app

# Install deps against the lockfile first for layer caching.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

# Source + build the shared package.
COPY . .
RUN pnpm --filter @ukraine-tracker/shared build

# Command is supplied by docker-compose (api: migrate+serve, worker: ingest loop).
