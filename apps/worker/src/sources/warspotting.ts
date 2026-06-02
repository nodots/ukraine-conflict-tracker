import type { EventSource, RawEvent } from "./types.js";

// WarSpotting (ukr.warspotting.net) — visually-confirmed material losses in the
// Russo-Ukrainian war, the open successor to Oryx-style tracking but with a real
// JSON API. Free + ungated. Only Russian losses are served (lost_by is always
// "Russia"), so this layer is "Russian equipment destroyed/damaged" — i.e.
// losses inflicted by Ukraine. See https://ukr.warspotting.net/api/docs/
//
// All records map to the "equipment_loss" event type — these are confirmed kills
// of vehicles/systems, not strikes, so they get their own taxonomy member rather
// than being squeezed into the strike modalities. The destroyed equipment (model,
// category, status, munition tags) lives in description + rawPayload.
//
// Caveat: only a minority of records are geolocated (`geo` is a "lat,lon" string
// or null). RawEvent requires numeric coordinates, so non-geolocated losses are
// dropped here and surface as "skipped" in the run counts.
const BASE =
  process.env.WARSPOTTING_BASE ?? "https://ukr.warspotting.net/api";

// A descriptive User-Agent is required — the API returns HTTP 520 without one.
const USER_AGENT =
  process.env.WARSPOTTING_USER_AGENT ??
  "ukraine-conflict-tracker (+https://osint.nodots.com)";

// Theater bbox (same as the other event sources) — geolocated losses should
// already sit inside it, but clip for consistency.
const BBOX = { minLon: 14, maxLon: 50, minLat: 43, maxLat: 60 };

// The API caps callers at 10 requests / 10 seconds; space requests ~1.1s apart
// to stay comfortably under that across a multi-day backfill.
const REQUEST_SPACING_MS = 1_100;

// One loss record as returned in the `losses` array.
interface WarSpottingLoss {
  id: number;
  type: string; // equipment category, e.g. "Tanks", "Transport"
  model: string;
  status: string; // Destroyed | Damaged | Abandoned | Captured
  lost_by: string; // always "Russia" for this endpoint
  date: string; // YYYY-MM-DD
  nearest_location: string | null;
  geo: string | null; // "lat,lon" when geolocated, else null
  unit: string | null;
  tags: string | null;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// `geo` is "lat,lon"; returns null if absent or unparseable.
function parseGeo(geo: string | null): { lat: number; lon: number } | null {
  if (!geo) return null;
  const parts = geo.split(",");
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function eachDay(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cur = new Date(from);
  cur.setUTCHours(0, 0, 0, 0);
  while (cur <= to) {
    days.push(
      `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}-${String(cur.getUTCDate()).padStart(2, "0")}`,
    );
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

export class WarSpottingEventSource implements EventSource {
  readonly name = "warspotting";

  async fetchEvents(from: Date, to: Date): Promise<RawEvent[]> {
    const out: RawEvent[] = [];
    for (const day of eachDay(from, to)) {
      // The per-date endpoint returns up to 100 losses/page; page through until
      // a short page signals the last one.
      for (let page = 1; ; page++) {
        const losses = await this.fetchPage(day, page);
        for (const loss of losses) this.mapInto(loss, out);
        if (losses.length < 100) break;
        await sleep(REQUEST_SPACING_MS);
      }
      await sleep(REQUEST_SPACING_MS);
    }
    return out;
  }

  private async fetchPage(date: string, page: number): Promise<WarSpottingLoss[]> {
    // Trailing slash is required; the API 301-redirects otherwise.
    const url = `${BASE}/losses/russia/${date}/${page}/`;
    const resp = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!resp.ok) {
      throw new Error(`warspotting request failed: ${resp.status} ${resp.statusText} (${url})`);
    }
    const body = (await resp.json()) as { losses?: WarSpottingLoss[] };
    return body.losses ?? [];
  }

  private mapInto(loss: WarSpottingLoss, out: RawEvent[]): void {
    const coords = parseGeo(loss.geo);
    if (!coords) return; // non-geolocated loss — counted as skipped upstream
    const { lat, lon } = coords;
    if (lat < BBOX.minLat || lat > BBOX.maxLat || lon < BBOX.minLon || lon > BBOX.maxLon) {
      return;
    }

    const equipment = `${loss.model} (${loss.type})`;
    out.push({
      externalId: `warspotting-${loss.id}`,
      eventType: "equipment_loss",
      // Day-resolution; pin to noon UTC like the other sources so events never
      // sit on a midnight boundary that can shift across days.
      eventTime: new Date(`${loss.date}T12:00:00Z`),
      lat,
      lon,
      adminArea: loss.nearest_location || null,
      // The endpoint serves only Russian losses, so the equipment owner is
      // Russia and the loss was inflicted by Ukraine. This is a fixed inference
      // from the endpoint, not from the record.
      actor: "Ukraine",
      target: "Russia",
      fatalities: null, // equipment losses carry no casualty count
      sourceName: "WarSpotting",
      // HTML loss pages are bot-protected (403 to non-browser clients) and their
      // permalink form is unverified, so link the stable per-loss API endpoint.
      sourceUrl: `${BASE}/losses/russia/${loss.id}/`,
      confidence: 0.95, // visually confirmed with photo/video evidence
      description: `${loss.status}: ${equipment}${loss.tags ? ` [${loss.tags}]` : ""}`,
      rawPayload: loss,
    });
  }
}
