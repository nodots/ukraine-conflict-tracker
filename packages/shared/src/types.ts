// Domain types shared across api, worker, and web.

// Point events — strikes and related kinetic activity.
export type EventType =
  | "drone_strike"
  | "missile_strike"
  | "shelling"
  | "airstrike"
  | "other";

export const EVENT_TYPES: EventType[] = [
  "drone_strike",
  "missile_strike",
  "shelling",
  "airstrike",
  "other",
];

// Controlling faction for area-of-control polygons.
export type Faction = "RU" | "UA" | "contested";

export const FACTIONS: Faction[] = ["RU", "UA", "contested"];

export type EventSourceType = "acled" | "manual" | "mock";
export type ControlSourceType = "isw" | "deepstate" | "mock";

// A single point event (strike), as served to the frontend.
export interface ConflictEvent {
  id: number;
  eventType: EventType;
  eventTime: string; // ISO timestamp
  lat: number;
  lon: number;
  adminArea: string | null;
  actor: string | null;
  target: string | null;
  fatalities: number | null;
  severity: number; // 0..1, drives marker size / heat weight
  sourceType: EventSourceType;
  sourceName: string | null;
  sourceUrl: string | null;
  confidence: number;
  description: string | null;
}

// GeoJSON FeatureCollection of point events (what /api/events returns).
export interface EventFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: Omit<ConflictEvent, "lat" | "lon">;
  }>;
}

// Area-of-control polygon for a faction on a given day.
export interface ControlArea {
  asOfDate: string; // YYYY-MM-DD
  faction: Faction;
  areaSqKm: number | null;
  sourceType: ControlSourceType;
  geometry: unknown; // GeoJSON MultiPolygon/Polygon
}

export interface ControlFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: unknown;
    properties: {
      faction: Faction;
      asOfDate: string;
      areaSqKm: number | null;
      sourceType: ControlSourceType;
    };
  }>;
}

// Derived contact line for a given day (GeoJSON LineString/MultiLineString).
export interface FrontlineFeature {
  asOfDate: string;
  sourceType: ControlSourceType;
  geometry: unknown;
}

// One row of the timeline: per-day event count and per-faction controlled area.
export interface TimelineDay {
  date: string; // YYYY-MM-DD
  eventCount: number;
  areaRuSqKm: number | null;
  areaUaSqKm: number | null;
}

export interface TimelineResponse {
  minDate: string;
  maxDate: string;
  days: TimelineDay[];
}

// Satellite thermal anomaly (active fire detection) from NASA FIRMS — a
// corroborating physical-signal layer, distinct from strike events.
export interface ThermalAnomaly {
  id: number;
  detectedAt: string; // ISO timestamp (UTC)
  lat: number;
  lon: number;
  frp: number | null; // fire radiative power, MW
  confidence: string | null; // VIIRS: l/n/h; MODIS: 0-100
  brightness: number | null; // brightness temperature, K
  satellite: string | null;
  sourceType: string;
}

export interface ThermalFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: Omit<ThermalAnomaly, "lat" | "lon">;
  }>;
}

export interface StatsResponse {
  from: string;
  to: string;
  totalEvents: number;
  byType: Record<EventType, number>;
  totalFatalities: number;
  netTerritoryChangeUaSqKm: number | null; // UA area at `to` minus UA area at `from` (positive = Ukraine regained territory)
}
