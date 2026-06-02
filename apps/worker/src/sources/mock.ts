import type { EventType } from "@ukraine-tracker/shared";
import type {
  ControlSource,
  EventSource,
  RawControlArea,
  RawEvent,
} from "./types.js";

// Deterministic pseudo-random generator so seeded mock data is reproducible
// across runs (no Math.random — keeps re-seeding stable).
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Rough eastern-Ukraine theater box used only for the synthetic CONTROL front
// (mock control polygons). Mock event distribution uses ZONES below instead.
const THEATER = { minLon: 30, maxLon: 39, minLat: 46.5, maxLat: 50.5 };

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function eachDay(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  const cur = new Date(from);
  cur.setUTCHours(0, 0, 0, 0);
  while (cur <= to) {
    days.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

// Synthetic contact line that drifts eastward over the window (RU losing
// ground) with some daily wobble, expressed as a north-south LineString.
function frontLonForDay(dayIndex: number, totalDays: number, rng: () => number): number {
  const start = 37.5;
  const end = 35.8; // line shifts west-to-east reference; RU pushed back
  const t = totalDays <= 1 ? 0 : dayIndex / (totalDays - 1);
  const drift = start + (end - start) * t;
  return drift + (rng() - 0.5) * 0.15;
}

function buildControlForDay(
  asOfDate: string,
  dayIndex: number,
  totalDays: number,
): RawControlArea[] {
  const rng = mulberry32(hashDate(asOfDate));
  const splitLon = frontLonForDay(dayIndex, totalDays, rng);
  const { minLon, maxLon, minLat, maxLat } = THEATER;

  // RU controls east of the split line; UA controls west of it.
  const ru = {
    type: "Polygon",
    coordinates: [
      [
        [splitLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [splitLon, maxLat],
        [splitLon, minLat],
      ],
    ],
  };
  const ua = {
    type: "Polygon",
    coordinates: [
      [
        [minLon, minLat],
        [splitLon, minLat],
        [splitLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat],
      ],
    ],
  };

  return [
    {
      asOfDate,
      faction: "RU",
      geometry: ru,
      sourceUrl: null,
      rawPayload: { mock: true, splitLon },
    },
    {
      asOfDate,
      faction: "UA",
      geometry: ua,
      sourceUrl: null,
      rawPayload: { mock: true, splitLon },
    },
  ];
}

function hashDate(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Target zones spread across the theater of operations. Each strike is drawn
// from a zone (weighted) and jittered by `spread` degrees, so most fall along
// the front and on Ukrainian cities, with progressively rarer deep-Russia
// (Moscow / Volga refineries) and EU/NATO-border incidents. Coordinates stay
// inside the ingest BBOX (lon 14..50, lat 43..60).
interface Zone {
  name: string;
  lon: number;
  lat: number;
  spread: number;
  weight: number;
  types: EventType[];
}

const ZONES: Zone[] = [
  // Front line — frequent shelling, drones, airstrikes.
  { name: "Donbas front", lon: 37.6, lat: 48.3, spread: 1.2, weight: 30, types: ["shelling", "drone_strike", "airstrike"] },
  { name: "Zaporizhzhia front", lon: 35.5, lat: 47.4, spread: 1.0, weight: 18, types: ["shelling", "drone_strike"] },
  // Ukrainian cities — missile + drone strikes.
  { name: "Kharkiv", lon: 36.23, lat: 49.99, spread: 0.3, weight: 12, types: ["missile_strike", "drone_strike"] },
  { name: "Kyiv", lon: 30.52, lat: 50.45, spread: 0.4, weight: 10, types: ["missile_strike", "drone_strike"] },
  { name: "Dnipro", lon: 35.05, lat: 48.46, spread: 0.3, weight: 7, types: ["missile_strike", "drone_strike"] },
  { name: "Odesa", lon: 30.73, lat: 46.48, spread: 0.35, weight: 7, types: ["missile_strike", "drone_strike"] },
  { name: "Lviv", lon: 24.03, lat: 49.84, spread: 0.3, weight: 3, types: ["missile_strike", "drone_strike"] },
  // Russian border oblasts — Ukrainian drone strikes / cross-border shelling.
  { name: "Belgorod", lon: 36.59, lat: 50.6, spread: 0.5, weight: 6, types: ["drone_strike", "shelling"] },
  { name: "Kursk", lon: 36.19, lat: 51.73, spread: 0.6, weight: 5, types: ["drone_strike"] },
  // Deep Russia — long-range drone strikes on Moscow and the refinery belt.
  { name: "Moscow region", lon: 37.62, lat: 55.75, spread: 0.6, weight: 4, types: ["drone_strike"] },
  { name: "Ryazan refinery", lon: 39.74, lat: 54.62, spread: 0.3, weight: 3, types: ["drone_strike"] },
  { name: "Volga refineries", lon: 47.5, lat: 53.2, spread: 1.6, weight: 3, types: ["drone_strike"] },
  { name: "Krasnodar/Tuapse", lon: 39.0, lat: 44.6, spread: 0.9, weight: 3, types: ["drone_strike"] },
  // EU/NATO border incidents — rare drone incursions / crashes.
  { name: "Poland border", lon: 23.0, lat: 50.7, spread: 0.6, weight: 1, types: ["drone_strike"] },
  { name: "Romania/Danube", lon: 28.6, lat: 45.2, spread: 0.5, weight: 1, types: ["drone_strike"] },
  { name: "Baltic states", lon: 24.5, lat: 56.5, spread: 1.6, weight: 1, types: ["drone_strike"] },
];

const ZONE_TOTAL_WEIGHT = ZONES.reduce((s, z) => s + z.weight, 0);

function pickZone(r: number): Zone {
  let acc = r * ZONE_TOTAL_WEIGHT;
  for (const z of ZONES) {
    acc -= z.weight;
    if (acc <= 0) return z;
  }
  return ZONES[0]!;
}

export class MockEventSource implements EventSource {
  readonly name = "mock";

  async fetchEvents(from: Date, to: Date): Promise<RawEvent[]> {
    const days = eachDay(from, to);
    const events: RawEvent[] = [];

    days.forEach((day) => {
      const rng = mulberry32(hashDate(dayKey(day)) ^ 0x9e3779b9);
      const count = 12 + Math.floor(rng() * 18); // 12..29 strikes/day
      for (let i = 0; i < count; i++) {
        const zone = pickZone(rng());
        // Gaussian-ish jitter via averaged uniforms keeps strikes clustered.
        const lon = zone.lon + (rng() + rng() - 1) * zone.spread;
        const lat = zone.lat + (rng() + rng() - 1) * zone.spread;
        const type = zone.types[Math.floor(rng() * zone.types.length)]!;
        const fatalities = rng() < 0.25 ? Math.floor(rng() * 8) : 0;
        const t = new Date(day);
        t.setUTCHours(Math.floor(rng() * 24), Math.floor(rng() * 60));
        events.push({
          externalId: `mock-${dayKey(day)}-${i}`,
          eventType: type,
          eventTime: t,
          lat: Number(lat.toFixed(4)),
          lon: Number(lon.toFixed(4)),
          adminArea: zone.name,
          actor: rng() < 0.5 ? "Russia" : "Ukraine",
          target: null,
          fatalities,
          sourceName: "mock generator",
          sourceUrl: null,
          confidence: 0.7,
          description: `Synthetic ${type.replace("_", " ")} near ${zone.name}`,
          rawPayload: { mock: true, zone: zone.name },
        });
      }
    });

    return events;
  }
}

export class MockControlSource implements ControlSource {
  readonly name = "mock";

  async availableDates(from: Date, to: Date): Promise<string[]> {
    // Weekly snapshots keep the mock dataset small but still animate.
    const days = eachDay(from, to);
    return days.filter((_, i) => i % 7 === 0).map(dayKey);
  }

  async fetchControl(asOfDate: string): Promise<RawControlArea[]> {
    // Recompute the day index against a fixed 6-month window anchor so the
    // drift is consistent regardless of which dates are requested.
    const anchor = new Date(asOfDate);
    const yearStart = new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1));
    const dayIndex = Math.floor(
      (anchor.getTime() - yearStart.getTime()) / 86400000,
    );
    return buildControlForDay(asOfDate, dayIndex % 180, 180);
  }
}
