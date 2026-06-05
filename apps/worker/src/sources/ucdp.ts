import type { EventType } from "@ukraine-tracker/shared";
import type { EventSource, RawEvent } from "./types.js";

// UCDP Georeferenced Event Dataset (GED) via the official JSON API
// (ucdpapi.pcr.uu.se), token-gated with an x-ucdp-access-token header.
//
// The API serves two datasets through one endpoint, keyed by the version path
// segment:
//   - Stable release "<YY>.1" (e.g. 25.1) — the curated annual dataset, which
//     only covers through the prior year (v25.1 ends 2024-12-31). We pull it
//     once with StartDate/EndDate for the historical portion of the window.
//   - Monthly "candidate" release "<YY>.0.<M>" (e.g. 25.0.6) — the same data as
//     the GEDEvent_v25_0_6.csv file; release M holds the events for month M.
//     We pull one per month for the recent portion past the stable boundary.
//
// Caveats baked into this source's behavior: UCDP records only events with at
// least one death, and has no native strike-modality field — event type is
// inferred from the source headline, defaulting to "other".
const API_BASE =
  process.env.UCDP_API_BASE ?? "https://ucdpapi.pcr.uu.se/api/gedevents";

// Current stable release. Its major year minus one is the last year it covers;
// dates past that boundary come from monthly candidate releases instead.
const STABLE_VERSION = process.env.UCDP_STABLE_VERSION ?? "25.1";

// UCDP region the theater falls in. Ukraine and cross-border Russia/Belarus
// events are all "Europe"; we filter server-side to Europe, then trim to the
// bbox below client-side. (The API has no bbox filter.)
const REGION = "Europe";

const PAGE_SIZE = 1000;

// A backfill makes many sequential requests (months × pages); a single
// transient network error (DNS hiccup, dropped connection) otherwise aborts
// the whole run. Retry only when fetch() itself throws — HTTP errors are
// handled by the caller and are not retried here.
const MAX_ATTEMPTS = 4;

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      if (attempt === MAX_ATTEMPTS) break;
      const backoffMs = 500 * 2 ** (attempt - 1); // 500, 1000, 2000
      console.log(`ucdp: fetch error (${message}), retry ${attempt}/${MAX_ATTEMPTS - 1} in ${backoffMs}ms`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

// Theater bbox (same as the ingest validator) — Region=Europe still includes
// out-of-theater rows, so drop them here before shipping to ingest.
const BBOX = { minLon: 14, maxLon: 50, minLat: 43, maxLat: 60 };

// Shape of a GED event as returned by the JSON API (fields we read).
interface UcdpApiEvent {
  id: number;
  latitude: number;
  longitude: number;
  date_start: string;
  source_headline: string | null;
  where_description: string | null;
  adm_1: string | null;
  side_a: string | null;
  side_b: string | null;
  best: number | null;
  source_office: string | null;
  event_clarity: number;
  conflict_name: string | null;
  type_of_violence: number;
  where_prec: number;
}

interface UcdpApiResponse {
  Result: UcdpApiEvent[];
  NextPageUrl: string | null;
}

// Infer our coarse taxonomy from the (often Ukrainian-press) headline text.
function mapEventType(text: string): EventType {
  const s = text.toLowerCase();
  if (s.includes("drone") || s.includes("uav") || s.includes("shahed") || s.includes("loitering")) {
    return "drone_strike";
  }
  if (
    s.includes("missile") || s.includes("rocket") || s.includes("ballistic") ||
    s.includes("kalibr") || s.includes("iskander") || s.includes("kinzhal") || s.includes("s-300")
  ) {
    return "missile_strike";
  }
  if (
    s.includes("airstrike") || s.includes("air strike") || s.includes("aviation") ||
    s.includes("warplane") || s.includes("glide bomb") || s.includes("guided bomb") || s.includes(" kab")
  ) {
    return "airstrike";
  }
  if (s.includes("shell") || s.includes("artillery") || s.includes("mortar") || s.includes("mlrs") || s.includes("grad")) {
    return "shelling";
  }
  return "other";
}

function mapActor(sideA: string): string | null {
  const s = sideA.toLowerCase();
  if (s.includes("russia")) return "Russia";
  if (s.includes("ukraine")) return "Ukraine";
  return sideA || null;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthsInRange(from: Date, to: Date): Array<{ year: number; month: number }> {
  const out: Array<{ year: number; month: number }> = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth() + 1; // 1-based
  const endY = to.getUTCFullYear();
  const endM = to.getUTCMonth() + 1;
  while (y < endY || (y === endY && m <= endM)) {
    out.push({ year: y, month: m });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

export class UcdpEventSource implements EventSource {
  readonly name = "ucdp";
  private readonly token: string;
  // Last year covered by the stable release (e.g. "25.1" -> 2024).
  private readonly stableThroughYear: number;

  constructor() {
    const token = process.env.UCDP_API_TOKEN;
    if (!token) {
      throw new Error("UCDP_API_TOKEN is required for EVENT_SOURCE=ucdp");
    }
    this.token = token;
    const stableMajor = Number(STABLE_VERSION.split(".")[0]);
    this.stableThroughYear = 2000 + stableMajor - 1;
  }

  async fetchEvents(from: Date, to: Date): Promise<RawEvent[]> {
    const out: RawEvent[] = [];
    const boundary = new Date(Date.UTC(this.stableThroughYear, 11, 31, 23, 59, 59));

    // Historical portion: one paged query against the stable release.
    if (from <= boundary) {
      const stableTo = to < boundary ? to : boundary;
      await this.fetchVersion(
        STABLE_VERSION,
        { StartDate: ymd(from), EndDate: ymd(stableTo) },
        out,
        false,
      );
    }

    // Recent portion: one paged query per month against the candidate release.
    // The version scopes the dataset to that month, so no date filter is needed.
    if (to > boundary) {
      const candFrom =
        from > boundary ? from : new Date(Date.UTC(this.stableThroughYear + 1, 0, 1));
      for (const { year, month } of monthsInRange(candFrom, to)) {
        const version = `${year % 100}.0.${month}`;
        await this.fetchVersion(version, {}, out, true);
      }
    }

    return out;
  }

  // Page through one version, applying the Region filter plus any extra params.
  // tolerateMissing swallows the 400/404 the API returns for a candidate month
  // that hasn't been released yet.
  private async fetchVersion(
    version: string,
    params: Record<string, string>,
    out: RawEvent[],
    tolerateMissing: boolean,
  ): Promise<void> {
    const qs = new URLSearchParams({
      pagesize: String(PAGE_SIZE),
      Region: REGION,
      ...params,
    });
    let url: string | null = `${API_BASE}/${version}?${qs.toString()}`;
    while (url) {
      const resp = await fetchWithRetry(url, {
        headers: { "x-ucdp-access-token": this.token },
      });
      if (tolerateMissing && (resp.status === 404 || resp.status === 400)) {
        console.log(`ucdp: no candidate release ${version} yet (${resp.status})`);
        return;
      }
      if (!resp.ok) {
        throw new Error(
          `ucdp request failed: ${resp.status} ${resp.statusText} (${url})`,
        );
      }
      // resp.json() is typed unknown; cast to the documented API shape — we
      // only read Result/NextPageUrl and tolerate missing fields per-event.
      const body = (await resp.json()) as UcdpApiResponse;
      this.parseInto(body.Result, out);
      url = body.NextPageUrl;
    }
  }

  private parseInto(events: UcdpApiEvent[], out: RawEvent[]): void {
    for (const e of events) {
      const lat = Number(e.latitude);
      const lon = Number(e.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lat < BBOX.minLat || lat > BBOX.maxLat || lon < BBOX.minLon || lon > BBOX.maxLon) {
        continue;
      }
      const headline = e.source_headline ?? "";
      const where = e.where_description ?? "";
      out.push({
        externalId: `ucdp-${e.id}`,
        eventType: mapEventType(`${headline} ${e.conflict_name ?? ""}`),
        // UCDP date_start is day-resolution ("YYYY-MM-DD"). Pin to noon UTC like
        // the other sources so day-resolution events never sit on a midnight
        // boundary that can shift across days.
        eventTime: new Date(`${String(e.date_start).slice(0, 10)}T12:00:00Z`),
        lat,
        lon,
        adminArea: e.adm_1 || where || null,
        actor: mapActor(e.side_a ?? ""),
        target: e.side_b || null,
        fatalities: e.best != null ? Number(e.best) : null,
        sourceName: e.source_office || "UCDP GED",
        sourceUrl: null,
        confidence: e.event_clarity === 1 ? 0.8 : 0.6,
        description: where ? `${where} — ${headline}` : headline,
        rawPayload: {
          ucdp_id: e.id,
          type_of_violence: e.type_of_violence,
          where_prec: e.where_prec,
        },
      });
    }
  }
}
