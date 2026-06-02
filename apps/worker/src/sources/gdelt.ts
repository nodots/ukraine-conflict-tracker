import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import type { EventType } from "@ukraine-tracker/shared";
import type { EventSource, RawEvent } from "./types.js";

// Ukraine boundary outer ring, loaded once for point-in-polygon attribution.
const ukraineRing: number[][] = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, "../data/ukraine-boundary.geojson"), "utf8");
  const fc = JSON.parse(raw) as { features: Array<{ geometry: { coordinates: number[][][] } }> };
  return fc.features[0]!.geometry.coordinates[0]!;
})();

// Ray-casting point-in-polygon against the Ukraine outer ring.
function inUkraine(lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ukraineRing.length - 1; i < ukraineRing.length; j = i++) {
    const xi = ukraineRing[i]![0]!, yi = ukraineRing[i]![1]!;
    const xj = ukraineRing[j]![0]!, yj = ukraineRing[j]![1]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Nationality markers that reliably name a belligerent as the *attacker* in a
// news URL slug: the adjective form ("russian"/"ukrainian") plus unambiguous
// government/leader terms. Bare country nouns ("russia"/"ukraine") and city
// names ("kyiv"/"moscow") are deliberately excluded — they appear in war-name
// boilerplate ("russia-ukraine-war"), geographic context ("near-ukraine-
// border"), and outlet domains (kyivpost.com, moscowtimes.com), all of which
// would misattribute.
const RU_MARKERS = /\b(russian|kremlin|putin)\b/;
const UA_MARKERS = /\b(ukrainian|zelensky|zelenskyy)\b/;

// Attribute the attacker, preferring signals in the source over geography.
// GDELT geocoding tells us where a munition landed, not who launched it, so a
// strike outside Ukraine is NOT necessarily Ukrainian: stray Russian munitions
// regularly land on NATO/EU/Moldova soil (e.g. drones crashing in Romania).
// Returns null when no signal supports an attribution — better an empty Actor
// field than a confident wrong one.
function attributeActor(
  url: string,
  actor1cc: string,
  lon: number,
  lat: number,
): string | null {
  // 1. Source text: the attacker is usually named in the headline/slug.
  const u = url.toLowerCase();
  const ru = RU_MARKERS.test(u);
  const ua = UA_MARKERS.test(u);
  if (ru && !ua) return "Russia";
  if (ua && !ru) return "Ukraine";
  // 2. GDELT's structured initiator (Actor1 acts on Actor2). The country codes
  //    are far more reliable than its free-text actor names, though still noisy.
  if (actor1cc === "RUS") return "Russia";
  if (actor1cc === "UKR") return "Ukraine";
  // 3. Geography, only where it's unambiguous: a strike inside Ukraine is
  //    Russian (Ukraine does not strike its own unoccupied territory; the rare
  //    strike on Russian-occupied UA soil is caught by the text rule above).
  if (inUkraine(lon, lat)) return "Russia";
  // 4. Outside Ukraine with no textual or structured signal: unknown. Don't
  //    guess "Ukraine" — that is exactly what mislabeled the stray-munition
  //    strikes on NATO/EU/Moldova soil.
  return null;
}

// GDELT 1.0 daily event files — the machine-readable aggregation of global news
// (CNN, NYT, Guardian, Reuters, and thousands more), geocoded, free, ungated.
// One TSV-in-zip file per day: <BASE>/YYYYMMDD.export.CSV.zip. Captures events
// wherever news reports them, so unlike UCDP it covers strikes inside Russia and
// EU-border incidents. Tradeoff: geocoding is to place/country centroids, and
// the same real event recurs across many outlets (we cut low-corroboration rows
// via a minimum article count and dedup on the stable GlobalEventID at ingest).
const BASE = process.env.GDELT_EVENTS_BASE ?? "http://data.gdeltproject.org/events";

const BBOX = { minLon: 14, maxLon: 50, minLat: 43, maxLat: 60 };
const MIN_ARTICLES = Number(process.env.GDELT_MIN_ARTICLES ?? 3);

// Keep only "strike" CAMEO event codes — bombing (183), artillery/tanks (194),
// and aerial weapons / missiles / drones (195). Excluding the generic "use
// conventional military force" (190) drops the bulk of the capital-centroid /
// diplomatic noise ("the Kremlin says…"); excluding small-arms fighting (193)
// drops high-volume frontline infantry combat that isn't a strike.
const KINETIC_PREFIXES = ["183", "194", "195"];
function isKinetic(eventCode: string): boolean {
  return KINETIC_PREFIXES.some((p) => eventCode.startsWith(p));
}

// Known GDELT geocoding artifacts: place names the geocoder confuses with
// weapon/operation names, producing phantom strike clusters. "Oreshnik" (a
// Russian missile) gets pinned to a village in Kirov Oblast. Drop these by name.
const NAME_BLOCKLIST = ["oreshnik", "burevestnik"];
function isBadGeocode(name: string): boolean {
  const n = name.toLowerCase();
  return NAME_BLOCKLIST.some((b) => n.includes(b));
}

// GDELT 1.0 export column indices (tab-separated, 58 cols, no header).
const COL = {
  id: 0, date: 1, actor1cc: 7, actor2cc: 17, evcode: 26, quad: 29,
  numArticles: 33, geoName: 50, lat: 53, lon: 54, url: 57,
};

// This is a Russia–Ukraine war tracker, so an event must involve one of the
// belligerents as an actor. GDELT's structured actor COUNTRY codes are far more
// reliable than its free-text actor names (which yield garbage like "NATO",
// "Iran", "FIGHTER JET"); requiring RUS/UKR here drops off-topic and
// policy/analysis articles that were mis-coded as strikes.
function isBelligerent(a1cc: string, a2cc: string): boolean {
  return a1cc === "RUS" || a1cc === "UKR" || a2cc === "RUS" || a2cc === "UKR";
}


// The export carries no article text, so modality is inferred from the source
// URL slug first (often "...russian-drone-strike..."), then the CAMEO action
// code as a fallback (195 = employ aerial weapons, 194 = artillery and tanks).
function mapEventType(eventCode: string, url: string): EventType {
  const u = url.toLowerCase();
  if (u.includes("drone") || u.includes("uav") || u.includes("shahed")) return "drone_strike";
  if (u.includes("missile") || u.includes("rocket") || u.includes("ballistic") || u.includes("kalibr") || u.includes("iskander")) {
    return "missile_strike";
  }
  if (u.includes("airstrike") || u.includes("air-strike") || u.includes("glide-bomb") || u.includes("aerial")) {
    return "airstrike";
  }
  if (u.includes("shell") || u.includes("artillery") || u.includes("mortar")) return "shelling";
  if (eventCode.startsWith("195")) return "airstrike";
  if (eventCode.startsWith("194")) return "shelling";
  return "other";
}

// Force a fresh string copy. String.split() yields "sliced strings" that retain
// a hidden reference to the entire parent CSV (~tens of MB per daily file);
// storing them in the accumulated events array would pin every file's full text
// in memory and exhaust the heap. Round-tripping through a Buffer breaks that.
function cp(s: string | undefined | null): string | null {
  return s == null || s === "" ? null : Buffer.from(s, "utf8").toString("utf8");
}

function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function eachDay(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cur = new Date(from);
  cur.setUTCHours(0, 0, 0, 0);
  while (cur <= to) {
    days.push(
      `${cur.getUTCFullYear()}${String(cur.getUTCMonth() + 1).padStart(2, "0")}${String(cur.getUTCDate()).padStart(2, "0")}`,
    );
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

export class GdeltEventSource implements EventSource {
  readonly name = "gdelt";

  async fetchEvents(from: Date, to: Date): Promise<RawEvent[]> {
    const out: RawEvent[] = [];
    for (const day of eachDay(from, to)) {
      const url = `${BASE}/${day}.export.CSV.zip`;
      const resp = await fetch(url);
      if (resp.status === 404) {
        console.log(`gdelt: no daily file for ${day}`);
        continue;
      }
      if (!resp.ok) {
        throw new Error(`gdelt request failed: ${resp.status} ${resp.statusText} (${url})`);
      }
      const buf = new Uint8Array(await resp.arrayBuffer());
      const unzipped = unzipSync(buf);
      const csvBytes = Object.values(unzipped)[0];
      if (!csvBytes) continue;
      this.parseInto(new TextDecoder().decode(csvBytes), out);
    }
    return out;
  }

  private parseInto(text: string, out: RawEvent[]): void {
    for (const line of text.split("\n")) {
      if (!line) continue;
      const c = line.split("\t");
      if (c.length < 58) continue;
      if (c[COL.quad] !== "4") continue; // material conflict only
      if (!isKinetic(c[COL.evcode] ?? "")) continue;
      if (Number(c[COL.numArticles]) < MIN_ARTICLES) continue;
      if (!isBelligerent(c[COL.actor1cc] ?? "", c[COL.actor2cc] ?? "")) continue;
      const lat = Number(c[COL.lat]);
      const lon = Number(c[COL.lon]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lat < BBOX.minLat || lat > BBOX.maxLat || lon < BBOX.minLon || lon > BBOX.maxLon) continue;
      if (isBadGeocode(c[COL.geoName] ?? "")) continue;

      const sqldate = c[COL.date] ?? ""; // YYYYMMDD
      if (sqldate.length < 8) continue;
      const y = Number(sqldate.slice(0, 4));
      const m = Number(sqldate.slice(4, 6));
      const d = Number(sqldate.slice(6, 8));
      const url = c[COL.url] ?? "";
      const where = cp(c[COL.geoName]);

      // Every stored string is copied via cp()/template/domainOf so none retain
      // the parent CSV text (see cp() above).
      out.push({
        externalId: `gdelt-${c[COL.id]}`,
        eventType: mapEventType(c[COL.evcode] ?? "", url),
        eventTime: new Date(Date.UTC(y, m - 1, d, 12)),
        lat,
        lon,
        adminArea: where,
        actor: attributeActor(url, c[COL.actor1cc] ?? "", lon, lat),
        target: null,
        fatalities: null, // GDELT events carry no fatality count
        sourceName: domainOf(url),
        sourceUrl: cp(url),
        // More corroborating articles → higher confidence, capped.
        confidence: Math.min(0.9, 0.4 + Number(c[COL.numArticles]) * 0.05),
        description: where,
        rawPayload: {
          gdelt_id: cp(c[COL.id]),
          event_code: cp(c[COL.evcode]),
          num_articles: cp(c[COL.numArticles]),
        },
      });
    }
  }
}
