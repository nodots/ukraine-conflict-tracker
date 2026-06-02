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

export const pool = new pg.Pool({ connectionString });

// Pin every connection to UTC so day-bucketing (date_trunc on event_time in the
// timeline query) is deterministic regardless of the host machine's timezone.
pool.on("connect", (client) => {
  client.query("SET TIME ZONE 'UTC'");
});

export const db = drizzle(pool, { schema });
