import type { EventType } from "@ukraine-tracker/shared";
import type { EventSource, RawEvent } from "./types.js";

// UCDP Georeferenced Event Dataset (GED), free + ungated. The annual release
// (vXX.1) only covers through the prior year; recent months live in monthly
// "candidate" CSV files named GEDEvent_v<YY>_0_<M>.csv, where release N holds
// the events for month N. We fetch one file per month in the window.
//
// Caveats baked into this source's behavior: UCDP records only events with at
// least one death, and has no native strike-modality field — event type is
// inferred from the source headline, defaulting to "other".
const BASE =
  process.env.UCDP_CANDIDATE_BASE ??
  "https://ucdp.uu.se/downloads/candidateged";

// Theater bbox (same as the ingest validator) — UCDP files are global, so drop
// out-of-theater rows here to avoid shipping the whole planet to ingest.
const BBOX = { minLon: 14, maxLon: 50, minLat: 43, maxLat: 60 };

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

// Minimal RFC4180 CSV parser — UCDP fields contain commas and quotes.
function parseCSV(s: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
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

  async fetchEvents(from: Date, to: Date): Promise<RawEvent[]> {
    const out: RawEvent[] = [];
    for (const { year, month } of monthsInRange(from, to)) {
      const url = `${BASE}/GEDEvent_v${year % 100}_0_${month}.csv`;
      const resp = await fetch(url);
      if (resp.status === 404) {
        console.log(`ucdp: no candidate file for ${year}-${month} yet (${url})`);
        continue;
      }
      if (!resp.ok) {
        throw new Error(`ucdp request failed: ${resp.status} ${resp.statusText} (${url})`);
      }
      this.parseInto(await resp.text(), out);
    }
    return out;
  }

  private parseInto(text: string, out: RawEvent[]): void {
    const rows = parseCSV(text);
    const h = rows[0];
    if (!h) return;
    const col = (n: string) => h.indexOf(n);
    const iId = col("id"), iLat = col("latitude"), iLon = col("longitude"),
      iDate = col("date_start"), iHead = col("source_headline"),
      iWhere = col("where_description"), iAdm1 = col("adm_1"),
      iSideA = col("side_a"), iSideB = col("side_b"), iBest = col("best"),
      iOffice = col("source_office"), iClarity = col("event_clarity"),
      iConflict = col("conflict_name"), iTv = col("type_of_violence"),
      iPrec = col("where_prec");

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length < h.length) continue;
      const lat = Number(row[iLat]);
      const lon = Number(row[iLon]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lat < BBOX.minLat || lat > BBOX.maxLat || lon < BBOX.minLon || lon > BBOX.maxLon) {
        continue;
      }
      const headline = row[iHead] ?? "";
      const where = row[iWhere] ?? "";
      out.push({
        externalId: `ucdp-${row[iId]}`,
        eventType: mapEventType(`${headline} ${row[iConflict] ?? ""}`),
        // UCDP date_start is "YYYY-MM-DD HH:MM:SS.SSS" (day-resolution, time is
        // always 00:00). Pin to noon UTC like the other sources so day-resolution
        // events never sit on a midnight boundary that can shift across days.
        eventTime: new Date(`${(row[iDate] ?? "").slice(0, 10)}T12:00:00Z`),
        lat,
        lon,
        adminArea: row[iAdm1] || where || null,
        actor: mapActor(row[iSideA] ?? ""),
        target: row[iSideB] || null,
        fatalities: row[iBest] ? Number(row[iBest]) : null,
        sourceName: row[iOffice] || "UCDP GED",
        sourceUrl: null,
        confidence: row[iClarity] === "1" ? 0.8 : 0.6,
        description: where ? `${where} — ${headline}` : headline,
        rawPayload: {
          ucdp_id: row[iId],
          type_of_violence: row[iTv],
          where_prec: row[iPrec],
        },
      });
    }
  }
}
