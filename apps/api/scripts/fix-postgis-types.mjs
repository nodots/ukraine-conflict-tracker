import { readFileSync, writeFileSync } from "node:fs";

// drizzle-kit treats the PostGIS geography type as an opaque custom type and
// wraps the whole name in double quotes (e.g. "geography(Point, 4326)"), which
// Postgres parses as a quoted identifier for a nonexistent type. This strips
// the surrounding quotes and normalizes to PostGIS's no-space introspection
// form (geography(Point,4326)) so the SQL executes and re-running generate does
// not produce spurious diffs.
const path = process.argv[2];
if (!path) {
  console.error("usage: fix-postgis-types.mjs <path-to-sql>");
  process.exit(1);
}

let sql = readFileSync(path, "utf8");
sql = sql.replace(
  /"geography\((Point|MultiPolygon|LineString),\s*4326\)"/g,
  "geography($1,4326)",
);
writeFileSync(path, sql);
console.log(`Patched ${path}`);
