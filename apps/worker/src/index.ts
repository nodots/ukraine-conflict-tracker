import { pool } from "./db.js";
import { ingestControl, ingestEvents } from "./services/ingest.js";
import { finishRun, startRun } from "./services/runs.js";
import { AcledEventSource } from "./sources/acled.js";
import { DeepStateControlSource } from "./sources/deepstate.js";
import { DeepStateGithubControlSource } from "./sources/deepstate-github.js";
import { GdeltEventSource } from "./sources/gdelt.js";
import { MockControlSource, MockEventSource } from "./sources/mock.js";
import { UcdpEventSource } from "./sources/ucdp.js";
import type { ControlSource, EventSource } from "./sources/types.js";

function buildEventSource(): EventSource {
  const which = process.env.EVENT_SOURCE ?? "mock";
  if (which === "gdelt") return new GdeltEventSource();
  if (which === "ucdp") return new UcdpEventSource();
  if (which === "acled") {
    const email = process.env.ACLED_EMAIL;
    const password = process.env.ACLED_PASSWORD;
    if (!email || !password) {
      throw new Error(
        "ACLED_EMAIL and ACLED_PASSWORD are required for EVENT_SOURCE=acled",
      );
    }
    return new AcledEventSource(email, password);
  }
  return new MockEventSource();
}

function buildControlSource(): ControlSource {
  const which = process.env.CONTROL_SOURCE ?? "mock";
  if (which === "deepstate-github") return new DeepStateGithubControlSource();
  if (which === "deepstate") return new DeepStateControlSource();
  return new MockControlSource();
}

async function runEvents(from: Date, to: Date): Promise<void> {
  const source = buildEventSource();
  const runId = await startRun(`events:${source.name}`);
  try {
    const events = await source.fetchEvents(from, to);
    const counts = await ingestEvents(events);
    await finishRun(runId, {
      status: "success",
      recordsSeen: counts.seen,
      recordsInserted: counts.inserted,
      recordsSkipped: counts.skipped,
    });
    console.log(
      `events[${source.name}] seen=${counts.seen} inserted=${counts.inserted} skipped=${counts.skipped}`,
    );
  } catch (err) {
    await finishRun(runId, {
      status: "failure",
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

async function runControl(from: Date, to: Date): Promise<void> {
  const source = buildControlSource();
  const runId = await startRun(`control:${source.name}`);
  try {
    const dates = await source.availableDates(from, to);
    let seen = 0;
    let inserted = 0;
    for (const date of dates) {
      const areas = await source.fetchControl(date);
      if (areas.length === 0) continue;
      const counts = await ingestControl(date, areas, source.name);
      seen += counts.seen;
      inserted += counts.inserted;
    }
    await finishRun(runId, {
      status: "success",
      recordsSeen: seen,
      recordsInserted: inserted,
    });
    console.log(`control[${source.name}] dates=${dates.length} seen=${seen} inserted=${inserted}`);
  } catch (err) {
    await finishRun(runId, {
      status: "failure",
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

async function main() {
  const mode = process.env.INGEST_MODE ?? "backfill";
  const months = Number(process.env.BACKFILL_MONTHS ?? 6);
  const now = new Date();
  const from =
    mode === "daily"
      ? new Date(now.getTime() - 2 * 86400000) // last 2 days
      : new Date(new Date().setMonth(now.getMonth() - months));

  console.log(`ingest mode=${mode} from=${from.toISOString().slice(0, 10)} to=${now.toISOString().slice(0, 10)}`);

  await runControl(from, now);
  await runEvents(from, now);

  await pool.end();
  console.log("ingest complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
