import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

// Return DATE columns (OID 1082) as the raw "YYYY-MM-DD" string rather than a
// JS Date. Otherwise res.json serializes them to a full UTC timestamp, which
// shifts the day across timezones and breaks the frontend's date math.
const DATE_OID = 1082;
pg.types.setTypeParser(DATE_OID, (v) => v);

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://ukraine:ukraine@localhost:5432/ukraine_tracker";

// Pin every connection to UTC (via a server option, set at connect time with no
// extra round-trip) so day-bucketing (date_trunc on event_time in the timeline
// query) is deterministic regardless of the host machine's timezone.
export const pool = new pg.Pool({
  connectionString,
  options: "-c timezone=UTC",
});
export const db = drizzle(pool, { schema });
