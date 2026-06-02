import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";

export const statsRouter = Router();

const querySchema = z.object({
  from: z.string(),
  to: z.string(),
});

// GET /api/stats?from&to — summary counts for the selected window: strikes by
// type, total fatalities, and net UA territory change across the window.
statsRouter.get("/", async (req, res, next) => {
  try {
    const q = querySchema.parse(req.query);

    const byType = await pool.query(
      `SELECT event_type, count(*)::int AS n, COALESCE(sum(fatalities), 0)::int AS deaths
         FROM events
        WHERE event_time >= $1 AND event_time < $2
        GROUP BY event_type`,
      [q.from, q.to],
    );

    const byTypeMap: Record<string, number> = {};
    let totalEvents = 0;
    let totalFatalities = 0;
    for (const r of byType.rows) {
      byTypeMap[r.event_type] = r.n;
      totalEvents += r.n;
      totalFatalities += r.deaths;
    }

    // UA controlled area at the snapshot on/before `from` and on/before `to`.
    const uaArea = async (d: string): Promise<number | null> => {
      const { rows } = await pool.query(
        `SELECT area_sq_km
           FROM control_areas
          WHERE faction = 'UA' AND as_of_date <= $1
          ORDER BY as_of_date DESC
          LIMIT 1`,
        [d],
      );
      return rows[0]?.area_sq_km ?? null;
    };
    const uaFrom = await uaArea(q.from);
    const uaTo = await uaArea(q.to);
    const netTerritoryChangeUaSqKm =
      uaFrom !== null && uaTo !== null ? uaTo - uaFrom : null;

    res.json({
      from: q.from,
      to: q.to,
      totalEvents,
      byType: byTypeMap,
      totalFatalities,
      netTerritoryChangeUaSqKm,
    });
  } catch (err) {
    next(err);
  }
});
