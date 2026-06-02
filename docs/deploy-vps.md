# Deploying on a single VPS (Docker Compose)

Runs the whole app on one cheap box: PostGIS, the API, the ingestion worker, and
Caddy (static web + automatic HTTPS). Sized for a tiny private audience.

## 1. Get a VPS
Any small instance works (~$4–6/mo): Hetzner CX22, DigitalOcean, Vultr, Linode.
2 vCPU / 4 GB is comfortable. Use a recent Ubuntu/Debian.

## 2. Install Docker
```bash
curl -fsSL https://get.docker.com | sh
```
(Compose v2 ships with Docker Engine as `docker compose`.)

## 3. Get the code + configure
```bash
git clone https://github.com/nodots/ukraine-conflict-tracker.git
cd ukraine-conflict-tracker
cp deploy.env.example .env
# edit .env: set a strong DB_PASSWORD, your PUBLIC_DOMAIN/PUBLIC_ORIGIN,
# and (optionally) FIRMS_MAP_KEY
```

## 4. Point DNS
Create an A record for `PUBLIC_DOMAIN` → the VPS IP. Caddy obtains a TLS cert
automatically on first start (ports 80 and 443 must be open).

## 5. Launch
```bash
docker compose up -d --build
```
This starts PostGIS, runs DB migrations, brings up the API behind Caddy, and the
worker begins ingesting (control + GDELT strikes + WarSpotting equipment losses
+ FIRMS thermal) on the `INGEST_INTERVAL` loop.

## 6. One-time historical backfill
The loop runs in `daily` mode (recent days only). Pull the full window once:
```bash
docker compose run --rm -e INGEST_MODE=backfill -e BACKFILL_MONTHS=6 \
  -e NODE_OPTIONS=--max-old-space-size=4096 \
  worker pnpm --filter @ukraine-tracker/worker ingest
```
Add the clean Ukraine-lethal UCDP layer (refresh ~monthly):
```bash
docker compose run --rm -e EVENT_SOURCE=ucdp -e INGEST_MODE=backfill \
  worker pnpm --filter @ukraine-tracker/worker ingest
```

## 7. Restrict access (recommended)
The app has no auth. Put it behind **Cloudflare Access** (free up to 50 users):
proxy the domain through Cloudflare, then add a Zero-Trust Access policy that
allows only your collaborators' emails. No code changes required.

## Operations
- Logs: `docker compose logs -f worker` (or `api`, `web`, `db`).
- Update: `git pull && docker compose up -d --build`.
- Backups: `docker compose exec db pg_dump -U ukraine ukraine_tracker | gzip > backup.sql.gz`.
- Data persists in the `pgdata` volume across restarts.

## Notes
- Secrets live only in `.env` (gitignored) — never committed.
- The API/worker run via `tsx` from source; only `@ukraine-tracker/shared` is
  compiled in the image.
- `PUBLIC_DOMAIN` blank → Caddy serves plain HTTP on :80 (fine behind Cloudflare
  or for local testing).
