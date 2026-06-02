# Ukraine Conflict Tracker — MVP Spec

## Purpose
Visualize how the Ukraine/Russia military situation changes over time: drone and
missile strikes (point events) and frontline / area-of-control movement (areal
features), with a time slider + playback as the primary interaction.

## Data sources
- **Events:** ACLED (Armed Conflict Location & Event Data), `country=Ukraine`,
  event type "Explosions/Remote violence". Requires registered API key + email.
  License requires attribution; raw data must not be redistributed.
- **Control geometry:** ISW / DeepState daily areas of control (GeoJSON). The
  derived contact line is computed in PostGIS from the RU/UA polygon boundaries.
- **Mock:** deterministic synthetic generator (`apps/worker/src/sources/mock.ts`)
  for end-to-end development before keys are wired.

## Data model
See `apps/api/src/db/schema.ts`:
- `events` — immutable point events; severity derived from type + fatalities.
- `control_areas` — `(as_of_date, faction, source_type)` unique; `area_sq_km`
  computed via `ST_Area(...::geography)`.
- `frontlines` — derived LineString via
  `ST_Intersection(ST_Boundary(ru), ST_Boundary(ua))`.
- `ingestion_runs` — audit log.

## API
- `GET /api/events?from&to&type&actor&bbox&limit` → GeoJSON points
- `GET /api/control?date` → GeoJSON polygons (latest snapshot ≤ date)
- `GET /api/frontline?date` → GeoJSON line (latest ≤ date)
- `GET /api/timeline` → date range + per-day event counts + per-faction area
- `GET /api/stats?from&to` → window summary (by type, fatalities, net RU area)
- `POST /api/admin/events` → manual event entry (curation fallback)

## Frontend
- MapLibre native sources/layers (control fill, frontline line, strikes circle +
  heatmap) — `setData` per selected date for performance.
- `TimeControl` — slider + play/pause + speed; trailing `WINDOW_DAYS` strike
  window per date.
- `StatsPanel`, `Legend` with layer toggles, attribution footer.

## Milestones
1. Scaffold monorepo + empty map.
2. Schema + mock data.
3. API + static map render.
4. Time slider + playback. ← core deliverable
5. Real ingestion (ACLED + ISW/DeepState), 6-month backfill.
6. Stats + polish (heatmap, compare mode, filters).

## Non-goals
Real-time tracking, predictive/targeting analysis, classified data, unit-level
order of battle.
