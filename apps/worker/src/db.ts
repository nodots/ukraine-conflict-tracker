import pg from "pg";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://ukraine:ukraine@localhost:5433/ukraine_tracker";

// Pin every connection to UTC (via a server option, no extra round-trip) so
// date/time math (date_trunc, now()) is deterministic regardless of the host
// machine's timezone.
export const pool = new pg.Pool({
  connectionString,
  options: "-c timezone=UTC",
});
