import { pool } from "./db.js";
import { ingestControl, ingestEvents } from "./services/ingest.js";
import { finishRun, startRun } from "./services/runs.js";
import { MockControlSource, MockEventSource } from "./sources/mock.js";

// Seed ~6 months of synthetic strikes + weekly control snapshots so the full
// map + time-slider works end-to-end before real feeds are wired.
async function main() {
  const months = Number(process.env.BACKFILL_MONTHS ?? 6);
  const now = new Date();
  const from = new Date(new Date().setMonth(now.getMonth() - months));

  const controlSource = new MockControlSource();
  const controlRun = await startRun("control:mock");
  let cSeen = 0;
  let cInserted = 0;
  for (const date of await controlSource.availableDates(from, now)) {
    const areas = await controlSource.fetchControl(date);
    const counts = await ingestControl(date, areas, "mock");
    cSeen += counts.seen;
    cInserted += counts.inserted;
  }
  await finishRun(controlRun, {
    status: "success",
    recordsSeen: cSeen,
    recordsInserted: cInserted,
  });
  console.log(`seeded control: seen=${cSeen} inserted=${cInserted}`);

  const eventSource = new MockEventSource();
  const eventRun = await startRun("events:mock");
  const events = await eventSource.fetchEvents(from, now);
  const counts = await ingestEvents(events);
  await finishRun(eventRun, {
    status: "success",
    recordsSeen: counts.seen,
    recordsInserted: counts.inserted,
    recordsSkipped: counts.skipped,
  });
  console.log(
    `seeded events: seen=${counts.seen} inserted=${counts.inserted} skipped=${counts.skipped}`,
  );

  await pool.end();
  console.log("mock seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
