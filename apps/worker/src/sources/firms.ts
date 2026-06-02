// NASA FIRMS active-fire / thermal-anomaly detections (VIIRS/MODIS). Free,
// ungated beyond a free MAP_KEY. The Area CSV API serves up to 5 days per call:
//   /api/area/csv/<MAP_KEY>/<SOURCE>/<west,south,east,north>/<dayRange>/<startDate>
// A corroborating layer (fires/explosions, incl. refinery fires in Russia), not a
// strike filter — it includes agricultural fires. NRT (..._NRT) covers only the
// last ~2 months; the SP archive (..._SP) covers older dates. To backfill a long
// window set FIRMS_SOURCES to include both NRT and SP — the dedup key is keyed on
// satellite (not the NRT/SP stream) so the same detection from both collapses.

export interface RawThermal {
  externalId: string;
  detectedAt: Date;
  lat: number;
  lon: number;
  frp: number | null;
  confidence: string | null;
  brightness: number | null;
  satellite: string | null;
  instrument: string | null;
  daynight: string | null;
  rawPayload: unknown;
}

const AREA_BASE =
  process.env.FIRMS_BASE ?? "https://firms.modaps.eosdis.nasa.gov/api/area/csv";
// west,south,east,north — same theater box as the rest of the pipeline.
const BBOX = "14,43,50,60";
const SOURCES = (process.env.FIRMS_SOURCES ?? "VIIRS_SNPP_NRT,VIIRS_NOAA20_NRT")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const MAX_DAYS_PER_CALL = 5;

export class FirmsThermalSource {
  readonly name = "firms";

  constructor(private readonly mapKey: string) {}

  async fetchThermal(from: Date, to: Date): Promise<RawThermal[]> {
    const out: RawThermal[] = [];
    for (const source of SOURCES) {
      const cur = new Date(from);
      cur.setUTCHours(0, 0, 0, 0);
      while (cur <= to) {
        const startStr = cur.toISOString().slice(0, 10);
        const remaining = Math.ceil((to.getTime() - cur.getTime()) / 86400000) + 1;
        const days = Math.min(MAX_DAYS_PER_CALL, Math.max(1, remaining));
        const url = `${AREA_BASE}/${this.mapKey}/${source}/${BBOX}/${days}/${startStr}`;
        const resp = await fetch(url);
        if (resp.status === 404) {
          // A source may not cover this date range (NRT vs SP); skip the chunk.
          cur.setUTCDate(cur.getUTCDate() + days);
          continue;
        }
        if (!resp.ok) {
          throw new Error(`FIRMS request failed: ${resp.status} ${resp.statusText}`);
        }
        const text = await resp.text();
        // FIRMS returns an error message as plain text (not CSV) for a bad key.
        if (text.startsWith("Invalid") || text.includes("MAP_KEY")) {
          throw new Error(`FIRMS rejected request: ${text.slice(0, 120)}`);
        }
        this.parseInto(text, source, out);
        cur.setUTCDate(cur.getUTCDate() + days);
      }
    }
    return out;
  }

  private parseInto(text: string, source: string, out: RawThermal[]): void {
    const lines = text.trim().split("\n");
    if (lines.length < 2) return; // header only or empty
    const header = lines[0]!.split(",");
    const col = (n: string) => header.indexOf(n);
    const iLat = col("latitude"), iLon = col("longitude"),
      iDate = col("acq_date"), iTime = col("acq_time"),
      iSat = col("satellite"), iInst = col("instrument"),
      iConf = col("confidence"), iFrp = col("frp"), iDn = col("daynight"),
      iBri = col("bright_ti4") >= 0 ? col("bright_ti4") : col("brightness");

    for (let r = 1; r < lines.length; r++) {
      const c = lines[r]!.split(",");
      if (c.length < header.length) continue;
      const conf = c[iConf] ?? "";
      if (conf === "l") continue; // drop low-confidence VIIRS detections
      const lat = Number(c[iLat]);
      const lon = Number(c[iLon]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const date = c[iDate] ?? "";
      const time = (c[iTime] ?? "").padStart(4, "0"); // HHMM (UTC)
      if (date.length < 10) continue;
      // Key on satellite (not the NRT/SP source) so the same observation from
      // both the real-time and archive streams dedupes.
      const sat = c[iSat] || "x";

      out.push({
        externalId: `firms-${sat}-${date}-${time}-${lat}-${lon}`,
        detectedAt: new Date(`${date}T${time.slice(0, 2)}:${time.slice(2, 4)}:00Z`),
        lat,
        lon,
        frp: iFrp >= 0 && c[iFrp] ? Number(c[iFrp]) : null,
        confidence: conf || null,
        brightness: iBri >= 0 && c[iBri] ? Number(c[iBri]) : null,
        satellite: c[iSat] || null,
        instrument: c[iInst] || null,
        daynight: c[iDn] || null,
        rawPayload: { source },
      });
    }
  }
}
