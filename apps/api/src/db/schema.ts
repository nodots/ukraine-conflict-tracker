import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import {
  geographyMultiLineString,
  geographyMultiPolygon,
  geographyPoint,
} from "./types.js";

// Point events (strikes) — immutable time-series, one row per observed event.
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    eventType: text("event_type").notNull(),
    eventTime: timestamp("event_time", { withTimezone: true }).notNull(),
    location: geographyPoint("location"),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    adminArea: text("admin_area"),
    actor: text("actor"),
    target: text("target"),
    fatalities: integer("fatalities"),
    severity: numeric("severity").notNull().default("0.3"),
    sourceType: text("source_type").notNull(),
    sourceName: text("source_name"),
    sourceUrl: text("source_url"),
    confidence: numeric("confidence").notNull().default("0.5"),
    description: text("description"),
    rawPayload: jsonb("raw_payload"),
    externalId: text("external_id").unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_events_location").using("gist", table.location),
    index("idx_events_type_time").on(table.eventType, table.eventTime),
    index("idx_events_time").on(table.eventTime),
    check(
      "events_confidence_range",
      sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`,
    ),
    check(
      "events_severity_range",
      sql`${table.severity} >= 0 AND ${table.severity} <= 1`,
    ),
  ],
);

// Daily area-of-control polygons — the frontline expressed as territory.
export const controlAreas = pgTable(
  "control_areas",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    asOfDate: date("as_of_date").notNull(),
    faction: text("faction").notNull(),
    geom: geographyMultiPolygon("geom"),
    areaSqKm: doublePrecision("area_sq_km"),
    sourceType: text("source_type").notNull(),
    sourceUrl: text("source_url"),
    rawPayload: jsonb("raw_payload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_control_areas_geom").using("gist", table.geom),
    index("idx_control_areas_date").on(table.asOfDate),
    unique("uq_control_area").on(
      table.asOfDate,
      table.faction,
      table.sourceType,
    ),
  ],
);

// Derived contact line (LineString) per date.
export const frontlines = pgTable(
  "frontlines",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    asOfDate: date("as_of_date").notNull(),
    geom: geographyMultiLineString("geom"),
    sourceType: text("source_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_frontlines_geom").using("gist", table.geom),
    index("idx_frontlines_date").on(table.asOfDate),
    unique("uq_frontline").on(table.asOfDate, table.sourceType),
  ],
);

// Satellite thermal anomalies (active fire detections) from NASA FIRMS. A
// corroborating physical-signal layer (fires/explosions, incl. refinery fires
// deep in Russia), separate from curated strike events.
export const thermalAnomalies = pgTable(
  "thermal_anomalies",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
    location: geographyPoint("location"),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    frp: doublePrecision("frp"),
    confidence: text("confidence"),
    brightness: doublePrecision("brightness"),
    satellite: text("satellite"),
    instrument: text("instrument"),
    daynight: text("daynight"),
    sourceType: text("source_type").notNull(),
    externalId: text("external_id").unique(),
    rawPayload: jsonb("raw_payload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_thermal_location").using("gist", table.location),
    index("idx_thermal_time").on(table.detectedAt),
  ],
);

// Ingestion audit log — one row per source run.
export const ingestionRuns = pgTable("ingestion_runs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  source: text("source").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull(),
  message: text("message"),
  recordsSeen: integer("records_seen").default(0),
  recordsInserted: integer("records_inserted").default(0),
  recordsSkipped: integer("records_skipped").default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
export type ControlAreaRow = typeof controlAreas.$inferSelect;
export type FrontlineRow = typeof frontlines.$inferSelect;
