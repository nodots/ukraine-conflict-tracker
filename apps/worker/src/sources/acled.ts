import type { EventType } from "@ukraine-tracker/shared";
import type { EventSource, RawEvent } from "./types.js";

// Map ACLED sub_event_type → our coarse event taxonomy. ACLED records most
// strikes under the "Explosions/Remote violence" event type with a more
// specific sub_event_type we key off here.
function mapEventType(subEventType: string): EventType {
  const s = subEventType.toLowerCase();
  if (s.includes("drone") || s.includes("uav") || s.includes("loitering")) {
    return "drone_strike";
  }
  if (s.includes("missile")) return "missile_strike";
  if (s.includes("air") || s.includes("aerial")) return "airstrike";
  if (s.includes("shelling") || s.includes("artillery") || s.includes("mortar")) {
    return "shelling";
  }
  return "other";
}

interface AcledRow {
  event_id_cnty: string;
  event_date: string;
  sub_event_type: string;
  latitude: string;
  longitude: string;
  admin1: string;
  actor1: string;
  actor2: string;
  fatalities: string;
  notes: string;
  source: string;
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

const OAUTH_URL = "https://acleddata.com/oauth/token";
const READ_URL = "https://acleddata.com/api/acled/read";

// Theater of operations: query each country, then the ingest BBOX clips to the
// region of interest (e.g. only European Russia, the part of the box that
// matters). ACLED filters by a single country per request, so we iterate.
const THEATER_COUNTRIES = [
  "Ukraine",
  "Russia",
  "Belarus",
  "Moldova",
  "Poland",
  "Slovakia",
  "Hungary",
  "Romania",
  "Lithuania",
  "Latvia",
  "Estonia",
];

// ACLED data API. The legacy key+email endpoint was retired 2025-09-15; the
// current API is OAuth2 password-grant: POST credentials for a bearer token,
// then call the read endpoint with it. Requires a myACLED account with a real
// password (Google SSO does not work — there is no password for the grant).
// Docs: https://acleddata.com/api-documentation/getting-started
export class AcledEventSource implements EventSource {
  readonly name = "acled";

  constructor(
    private readonly email: string,
    private readonly password: string,
  ) {}

  private async fetchToken(): Promise<string> {
    const body = new URLSearchParams({
      username: this.email,
      password: this.password,
      grant_type: "password",
      client_id: "acled",
      scope: "authenticated",
    });
    const resp = await fetch(OAUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await resp.json().catch(() => ({}))) as TokenResponse;
    if (!resp.ok || !data.access_token) {
      const detail = data.error_description ?? data.error ?? resp.statusText;
      throw new Error(`ACLED token request failed: ${resp.status} ${detail}`);
    }
    return data.access_token;
  }

  async fetchEvents(from: Date, to: Date): Promise<RawEvent[]> {
    const token = await this.fetchToken();
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);
    const events: RawEvent[] = [];

    for (const country of THEATER_COUNTRIES) {
      await this.fetchCountry(token, country, fromStr, toStr, events);
    }

    return events;
  }

  // Fetch every "Explosions/Remote violence" event for one country in the
  // window, paginating until a short page is returned, appending to `out`.
  private async fetchCountry(
    token: string,
    country: string,
    fromStr: string,
    toStr: string,
    out: RawEvent[],
  ): Promise<void> {
    let page = 1;
    for (;;) {
      const url = new URL(READ_URL);
      url.searchParams.set("_format", "json");
      url.searchParams.set("country", country);
      url.searchParams.set("event_date", `${fromStr}|${toStr}`);
      url.searchParams.set("event_date_where", "BETWEEN");
      url.searchParams.set("event_type", "Explosions/Remote violence");
      url.searchParams.set("limit", "5000");
      url.searchParams.set("page", String(page));

      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        throw new Error(
          `ACLED request failed for ${country}: ${resp.status} ${resp.statusText}`,
        );
      }
      const body = (await resp.json()) as { data?: AcledRow[] };
      const rows = body.data ?? [];
      for (const r of rows) {
        out.push({
          externalId: `acled-${r.event_id_cnty}`,
          eventType: mapEventType(r.sub_event_type),
          eventTime: new Date(`${r.event_date}T12:00:00Z`),
          lat: Number(r.latitude),
          lon: Number(r.longitude),
          adminArea: r.admin1 || null,
          actor: r.actor1 || null,
          target: r.actor2 || null,
          fatalities: r.fatalities ? Number(r.fatalities) : null,
          sourceName: r.source || "ACLED",
          sourceUrl: null,
          confidence: 0.8,
          description: r.notes || null,
          rawPayload: r,
        });
      }
      if (rows.length < 5000) break;
      page++;
    }
  }
}
