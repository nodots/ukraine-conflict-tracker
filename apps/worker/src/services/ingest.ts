import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveSeverity } from "@ukraine-tracker/shared";
import { pool } from "../db.js";
import type { RawControlArea, RawEvent } from "../sources/types.js";

// Internationally-recognized Ukraine boundary (incl. Crimea), loaded once. Used
// to derive UA control as Ukraine − RU when a source supplies only the occupied
// (RU) polygon (e.g. the DeepState mirror). Stored as a GeoJSON geometry string
// ready to hand to ST_GeomFromGeoJSON.
const ukraineBoundaryGeoJSON: string = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, "../data/ukraine-boundary.geojson"), "utf8");
  const fc = JSON.parse(raw) as { features: Array<{ geometry: unknown }> };
  return JSON.stringify(fc.features[0]!.geometry);
})();

// Theater-of-operations bounding box. Spans the bordering EU/NATO states in the
// west (Poland, Slovakia, Hungary, Romania, the Baltics) through Ukraine,
// Belarus and Moldova, east across western Russia to Moscow and the Volga
// refinery belt, and south to the Black Sea / southern Russia. Events that
// geocode outside this box are rejected.
const BBOX = { minLon: 14, maxLon: 50, minLat: 43, maxLat: 60 };

function validEvent(e: RawEvent): boolean {
  if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon)) return false;
  if (e.lat < BBOX.minLat || e.lat > BBOX.maxLat) return false;
  if (e.lon < BBOX.minLon || e.lon > BBOX.maxLon) return false;
  // Reject timestamps more than a day in the future (clock skew tolerance).
  if (e.eventTime.getTime() - Date.now() > 86400000) return false;
  return true;
}

export interface IngestCounts {
  seen: number;
  inserted: number;
  skipped: number;
}

// Upsert point events. Idempotent on external_id so re-running a backfill does
// not duplicate rows. Severity is derived here so all sources stay consistent.
export async function ingestEvents(events: RawEvent[]): Promise<IngestCounts> {
  let inserted = 0;
  let skipped = 0;
  for (const e of events) {
    if (!validEvent(e)) {
      skipped++;
      continue;
    }
    const severity = deriveSeverity(e.eventType, e.fatalities);
    const { rowCount } = await pool.query(
      `INSERT INTO events
         (event_type, event_time, location, lat, lon, admin_area, actor, target,
          fatalities, severity, source_type, source_name, source_url, confidence,
          description, raw_payload, external_id)
       VALUES
         ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326), $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (external_id) DO UPDATE SET
         event_type = EXCLUDED.event_type,
         event_time = EXCLUDED.event_time,
         location = EXCLUDED.location,
         lat = EXCLUDED.lat,
         lon = EXCLUDED.lon,
         fatalities = EXCLUDED.fatalities,
         severity = EXCLUDED.severity`,
      [
        e.eventType,
        e.eventTime.toISOString(),
        e.lat,
        e.lon,
        e.adminArea,
        e.actor,
        e.target,
        e.fatalities,
        severity,
        sourceTypeFor(e),
        e.sourceName,
        e.sourceUrl,
        e.confidence,
        e.description,
        e.rawPayload === undefined ? null : JSON.stringify(e.rawPayload),
        e.externalId,
      ],
    );
    if (rowCount && rowCount > 0) inserted++;
  }
  return { seen: events.length, inserted, skipped };
}

function sourceTypeFor(e: RawEvent): string {
  // External ids are prefixed by source ("mock-", "ucdp-", "acled-"); derive the
  // source_type from that prefix.
  const dash = e.externalId.indexOf("-");
  return dash > 0 ? e.externalId.slice(0, dash) : "unknown";
}

// Insert control polygons for a day, then derive + store the contact line.
// areaSqKm is computed in PostGIS so the timeline territory chart is accurate.
export async function ingestControl(
  asOfDate: string,
  areas: RawControlArea[],
  sourceType: string,
): Promise<IngestCounts> {
  let inserted = 0;
  for (const a of areas) {
    const { rowCount } = await pool.query(
      `INSERT INTO control_areas (as_of_date, faction, geom, area_sq_km, source_type, source_url, raw_payload)
       VALUES (
         $1, $2,
         ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))::geography,
         ST_Area(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)::geography) / 1000000.0,
         $4, $5, $6
       )
       ON CONFLICT (as_of_date, faction, source_type) DO UPDATE SET
         geom = EXCLUDED.geom,
         area_sq_km = EXCLUDED.area_sq_km,
         raw_payload = EXCLUDED.raw_payload`,
      [
        a.asOfDate,
        a.faction,
        JSON.stringify(a.geometry),
        sourceType,
        a.sourceUrl,
        a.rawPayload === undefined ? null : JSON.stringify(a.rawPayload),
      ],
    );
    if (rowCount && rowCount > 0) inserted++;
  }

  // Sources like the DeepState mirror only provide the occupied (RU) polygon.
  // Derive UA = Ukraine boundary − RU so the data model keeps both factions and
  // the frontline derivation has two boundaries to intersect.
  const hasRu = areas.some((a) => a.faction === "RU");
  const hasUa = areas.some((a) => a.faction === "UA");
  if (hasRu && !hasUa) {
    await deriveUaFromBoundary(asOfDate, sourceType);
  }

  await deriveFrontline(asOfDate, sourceType);
  return { seen: areas.length, inserted, skipped: areas.length - inserted };
}

// Compute UA control as the Ukraine boundary minus the RU occupied polygon for a
// date, and upsert it as a control_areas row. ST_MakeValid guards against
// self-intersections in the source geometry; ST_CollectionExtract(...,3) keeps
// only polygonal output from the difference.
async function deriveUaFromBoundary(
  asOfDate: string,
  sourceType: string,
): Promise<void> {
  await pool.query(
    `WITH ru AS (
        SELECT geom::geometry AS g FROM control_areas
         WHERE as_of_date = $1 AND faction = 'RU' AND source_type = $2
     ),
     diff AS (
        SELECT ST_Multi(
                 ST_CollectionExtract(
                   ST_Difference(
                     ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)),
                     ST_MakeValid(ru.g)
                   ), 3
                 )
               ) AS g
          FROM ru
     )
     INSERT INTO control_areas (as_of_date, faction, geom, area_sq_km, source_type)
     SELECT $1, 'UA', diff.g::geography, ST_Area(diff.g::geography) / 1000000.0, $2
       FROM diff
      WHERE diff.g IS NOT NULL AND NOT ST_IsEmpty(diff.g)
     ON CONFLICT (as_of_date, faction, source_type) DO UPDATE SET
       geom = EXCLUDED.geom,
       area_sq_km = EXCLUDED.area_sq_km`,
    [asOfDate, sourceType, ukraineBoundaryGeoJSON],
  );
}

// The contact line is the shared boundary between RU and UA control: intersect
// the two polygon boundaries. Stored as a LineString/MultiLineString.
async function deriveFrontline(
  asOfDate: string,
  sourceType: string,
): Promise<void> {
  await pool.query(
    `WITH ru AS (
        SELECT geom FROM control_areas
         WHERE as_of_date = $1 AND faction = 'RU' AND source_type = $2
     ),
     ua AS (
        SELECT geom FROM control_areas
         WHERE as_of_date = $1 AND faction = 'UA' AND source_type = $2
     ),
     line AS (
        SELECT ST_Multi(
                 ST_CollectionExtract(
                   ST_Intersection(
                     ST_Boundary(ru.geom::geometry),
                     ST_Boundary(ua.geom::geometry)
                   ), 2
                 )
               )::geography AS geom
          FROM ru, ua
     )
     INSERT INTO frontlines (as_of_date, geom, source_type)
     SELECT $1, line.geom, $2 FROM line
      WHERE line.geom IS NOT NULL AND NOT ST_IsEmpty(line.geom::geometry)
     ON CONFLICT (as_of_date, source_type) DO UPDATE SET geom = EXCLUDED.geom`,
    [asOfDate, sourceType],
  );
}
