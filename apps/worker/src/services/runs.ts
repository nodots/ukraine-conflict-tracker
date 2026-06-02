import { pool } from "../db.js";

// Start an ingestion run row; returns its id for finishRun().
export async function startRun(source: string): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO ingestion_runs (source, status) VALUES ($1, 'running') RETURNING id`,
    [source],
  );
  return rows[0].id as number;
}

export async function finishRun(
  id: number,
  result: {
    status: "success" | "failure";
    message?: string;
    recordsSeen?: number;
    recordsInserted?: number;
    recordsSkipped?: number;
  },
): Promise<void> {
  await pool.query(
    `UPDATE ingestion_runs
        SET status = $2, message = $3, finished_at = now(),
            records_seen = $4, records_inserted = $5, records_skipped = $6
      WHERE id = $1`,
    [
      id,
      result.status,
      result.message ?? null,
      result.recordsSeen ?? 0,
      result.recordsInserted ?? 0,
      result.recordsSkipped ?? 0,
    ],
  );
}
