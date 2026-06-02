import type { EventType, Faction } from "@ukraine-tracker/shared";

// A normalized point event produced by an event source, ready for ingest.
export interface RawEvent {
  externalId: string; // stable id for idempotent upsert
  eventType: EventType;
  eventTime: Date;
  lat: number;
  lon: number;
  adminArea: string | null;
  actor: string | null;
  target: string | null;
  fatalities: number | null;
  sourceName: string | null;
  sourceUrl: string | null;
  confidence: number;
  description: string | null;
  rawPayload: unknown;
}

// A normalized control snapshot for one faction on one day.
export interface RawControlArea {
  asOfDate: string; // YYYY-MM-DD
  faction: Faction;
  geometry: unknown; // GeoJSON Polygon/MultiPolygon
  sourceUrl: string | null;
  rawPayload: unknown;
}

// Event sources yield strikes; the worker decides the date range to request.
export interface EventSource {
  readonly name: string;
  fetchEvents(from: Date, to: Date): Promise<RawEvent[]>;
}

// Control sources yield area-of-control polygons for a set of dates.
export interface ControlSource {
  readonly name: string;
  // Return the dates this source can provide within [from, to].
  availableDates(from: Date, to: Date): Promise<string[]>;
  fetchControl(asOfDate: string): Promise<RawControlArea[]>;
}
