#!/usr/bin/env sh

# Run the daily ingest at a fixed UTC wall-clock time. The wait is recomputed on
# every iteration from the current clock, so the schedule survives container
# restarts — a plain `sleep INTERVAL` loop anchors to container start time and
# drifts. Default 07:30 UTC: late enough that GDELT has published the prior
# day's export (~06:00 UTC), so each run captures the day that just ended
# instead of straddling the publish window and lagging a day behind.

TARGET_UTC="${INGEST_TIME_UTC:-07:30}"
h="${TARGET_UTC%%:*}"
m="${TARGET_UTC##*:}"
# Strip a single leading zero so dash arithmetic doesn't read 07/08/09 as octal.
h="${h#0}"; h="${h:-0}"
m="${m#0}"; m="${m:-0}"
target=$(( h * 3600 + m * 60 ))

run() { pnpm --filter @ukraine-tracker/worker ingest || true; }

# Ingest once on start so a fresh deploy populates without waiting a full day.
run

while true; do
  now=$(date -u +%s)
  into_day=$(( now % 86400 ))
  if [ "$into_day" -lt "$target" ]; then
    wait=$(( target - into_day ))
  else
    wait=$(( 86400 - into_day + target ))
  fi
  echo "worker: next ingest at ${TARGET_UTC} UTC (in ${wait}s)"
  sleep "$wait"
  run
done
