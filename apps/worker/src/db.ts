import pg from "pg";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://ukraine:ukraine@localhost:5433/ukraine_tracker";

export const pool = new pg.Pool({ connectionString });

// Pin every connection to UTC so date/time math (date_trunc, now()) is
// deterministic regardless of the host machine's timezone.
pool.on("connect", (client) => {
  client.query("SET TIME ZONE 'UTC'");
});
