import type { ControlSource, RawControlArea } from "./types.js";

// DeepState's own API locked its history listing behind per-client keys after a
// Nov-2025 incident, so historical snapshots can't be enumerated there anymore.
// The `cyterat/deepstate-map-data` GitHub mirror publishes one GeoJSON file per
// day (since 2024-07-08), each a single MultiPolygon of Russian-occupied
// territory. That is our RU control geometry; UA is derived (Ukraine boundary
// minus RU) at ingest, so this source only emits the RU faction.
const RAW_BASE =
  process.env.DEEPSTATE_GITHUB_BASE ??
  "https://raw.githubusercontent.com/cyterat/deepstate-map-data/main/data";

// Earliest daily file in the mirror; requests before this have no data.
const MIRROR_START = "2024-07-08";

interface DailyFile {
  type: "FeatureCollection";
  features: Array<{ geometry: unknown; properties?: unknown }>;
}

export class DeepStateGithubControlSource implements ControlSource {
  readonly name = "deepstate-github";

  // Weekly snapshots over the window — matches the mock cadence and keeps the
  // backfill volume sane. Dates before the mirror start are dropped with a note.
  async availableDates(from: Date, to: Date): Promise<string[]> {
    const dates: string[] = [];
    let skipped = 0;
    const cur = new Date(from);
    cur.setUTCHours(0, 0, 0, 0);
    while (cur <= to) {
      const iso = cur.toISOString().slice(0, 10);
      if (iso >= MIRROR_START) dates.push(iso);
      else skipped++;
      cur.setUTCDate(cur.getUTCDate() + 7);
    }
    if (skipped > 0) {
      console.log(
        `deepstate-github: skipped ${skipped} date(s) before mirror start ${MIRROR_START}`,
      );
    }
    return dates;
  }

  async fetchControl(asOfDate: string): Promise<RawControlArea[]> {
    const fileDate = asOfDate.replace(/-/g, "");
    const url = `${RAW_BASE}/deepstatemap_data_${fileDate}.geojson`;
    const resp = await fetch(url);
    if (resp.status === 404) {
      // No snapshot mirrored for this day; non-fatal, skip it.
      return [];
    }
    if (!resp.ok) {
      throw new Error(
        `deepstate-github request failed: ${resp.status} ${resp.statusText} (${url})`,
      );
    }
    const fc = (await resp.json()) as DailyFile;
    const feature = fc.features?.[0];
    if (!feature?.geometry) return [];

    return [
      {
        asOfDate,
        faction: "RU",
        geometry: feature.geometry,
        sourceUrl: url,
        rawPayload: { mirror: "cyterat/deepstate-map-data", fileDate },
      },
    ];
  }
}
