#!/usr/bin/env bash
set -euo pipefail

# Initialize a local PostgreSQL database with PostGIS for the Ukraine conflict tracker.
# Assumes a running PostgreSQL server reachable via the libpq env vars or peer auth.

DB_NAME="${DB_NAME:-ukraine_tracker}"
DB_USER="${DB_USER:-ukraine}"
DB_PASSWORD="${DB_PASSWORD:-ukraine}"

PSQL_ADMIN=(psql -v ON_ERROR_STOP=1)

echo "Creating role ${DB_USER} (if missing)…"
"${PSQL_ADMIN[@]}" -d postgres <<SQL || true
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;
SQL

echo "Creating database ${DB_NAME} (if missing)…"
createdb -O "${DB_USER}" "${DB_NAME}" 2>/dev/null || echo "  (already exists)"

echo "Enabling PostGIS extension…"
"${PSQL_ADMIN[@]}" -d "${DB_NAME}" <<SQL
CREATE EXTENSION IF NOT EXISTS postgis;
SQL

echo "Done. DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"
