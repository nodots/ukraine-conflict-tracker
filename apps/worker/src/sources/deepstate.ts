import type { Faction } from "@ukraine-tracker/shared";
import type { ControlSource, RawControlArea } from "./types.js";

// DeepState publishes a public GeoJSON of areas of control. The exact endpoint
// and date-addressing scheme change over time; this source isolates that so the
// rest of the pipeline is unaffected. Configure the base URL via env if needed.
//
// NOTE: This is a best-effort scaffold for the real feed. Until the live
// endpoint/format is confirmed, run the worker with CONTROL_SOURCE=mock.
const DEFAULT_BASE =
  process.env.DEEPSTATE_BASE_URL ?? "https://deepstatemap.live/api";

interface DeepStateFeature {
  type: "Feature";
  geometry: unknown;
  properties: Record<string, unknown>;
}

// Classify a DeepState feature into a faction from its properties/name. The
// real feed tags occupied vs liberated areas; adjust the predicate to match.
function classifyFaction(props: Record<string, unknown>): Faction | null {
  const name = String(props.name ?? "").toLowerCase();
  if (name.includes("occupied") || name.includes("russia")) return "RU";
  if (name.includes("liberated") || name.includes("ukraine")) return "UA";
  return null;
}

export class DeepStateControlSource implements ControlSource {
  readonly name = "deepstate";

  // Without a confirmed historical index endpoint we cannot enumerate dates
  // remotely; the worker passes the date range and we currently return the
  // requested daily dates, letting fetchControl no-op on days with no data.
  async availableDates(from: Date, to: Date): Promise<string[]> {
    const days: string[] = [];
    const cur = new Date(from);
    cur.setUTCHours(0, 0, 0, 0);
    while (cur <= to) {
      days.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 7); // weekly to keep volume sane
    }
    return days;
  }

  async fetchControl(asOfDate: string): Promise<RawControlArea[]> {
    const url = `${DEFAULT_BASE}/history/${asOfDate}/geojson`;
    const resp = await fetch(url);
    if (!resp.ok) {
      // Missing snapshot for this date is not fatal; skip it.
      return [];
    }
    const fc = (await resp.json()) as { features?: DeepStateFeature[] };
    const areas: RawControlArea[] = [];
    for (const f of fc.features ?? []) {
      const faction = classifyFaction(f.properties ?? {});
      if (!faction) continue;
      areas.push({
        asOfDate,
        faction,
        geometry: f.geometry,
        sourceUrl: url,
        rawPayload: f.properties,
      });
    }
    return areas;
  }
}
