# Ukraine Conflict Tracker

OSINT web app for visualizing **change over time** in the Ukraine/Russia war:
drone strikes, missile strikes, and frontline / area-of-control movement.

Architecture mirrors `naval-vessel-tracker`: a pnpm monorepo with a React +
MapLibre frontend, an Express + Drizzle + PostGIS API, and a Node ingestion
worker. The headline feature is a **time slider + playback** that animates the
front moving and strikes flashing across the loaded window.

## Stack
- **web** — React 19 + Vite 6 + MUI 6 + MapLibre GL 4 (port 6731)
- **api** — Express 4 + Drizzle ORM + PostgreSQL 16 / PostGIS 3.4 (port 6732)
- **worker** — Node ingestion (ACLED events + ISW/DeepState control geometry)
- **shared** — TypeScript domain types + severity helper

## Ports

This project reserves the contiguous block **6730–6739** to avoid collisions
with other local projects. App services only — the database uses the shared
local `postgresql@17` instance (project-scoped by DB name `ukraine_tracker`).

| Port        | Service                              | Status   |
| ----------- | ------------------------------------ | -------- |
| `6731`      | web client (Vite dev + preview)      | in use   |
| `6732`      | api (Express)                        | in use   |
| `6733`      | worker health/metrics endpoint       | reserved |
| `6735`      | api `--inspect` debugger             | reserved |
| `6736–6739` | growth (Storybook, ws feed, etc.)    | reserved |

## Data model
- `events` — point strikes (immutable time-series)
- `control_areas` — daily area-of-control polygons per faction
- `frontlines` — derived contact line (LineString) per date
- `ingestion_runs` — ingestion audit log

## Run it (mock data)
```bash
pnpm install
DB_NAME=ukraine_tracker DB_USER=ukraine DB_PASSWORD=ukraine ./scripts/init-db.sh
pnpm db:migrate
pnpm seed:mock          # ~6 months of synthetic strikes + weekly control snapshots
pnpm dev                # web :6731, api :6732
```
Open http://localhost:6731 — drag the time slider or press play.

## Real data
Set `apps/worker/.env` (`ACLED_API_KEY`, `ACLED_EMAIL`, `CONTROL_SOURCE`) and run
`pnpm --filter @ukraine-tracker/worker ingest` with `INGEST_MODE=backfill`.

> **Data licensing:** ACLED requires attribution and forbids redistribution of
> raw data — keep API keys private and keep the in-app attribution footer.

## Non-goals
Real-time tracking, predictive/targeting analysis, classified data, unit-level
order of battle.
