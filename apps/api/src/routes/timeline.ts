import { Router } from "express";
import { pool } from "../db/client.js";

export const timelineRouter = Router();

// GET /api/timeline — the available date range plus per-day event counts and
// per-faction controlled area. Drives the time-slider ticks and the
// territory-over-time sparkline. Days are the union of dates that have any
// layer — events, control snapshots, or thermal anomalies — so a day carried
// only by the thermal layer (e.g. today, before slower sources publish) is
// still reachable on the slider.
timelineRouter.get("/", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `WITH event_days AS (
         SELECT date_trunc('day', event_time)::date AS d, count(*)::int AS n
           FROM events
          GROUP BY 1
       ),
       ru AS (
         SELECT as_of_date AS d, area_sq_km
           FROM control_areas WHERE faction = 'RU'
       ),
       ua AS (
         SELECT as_of_date AS d, area_sq_km
           FROM control_areas WHERE faction = 'UA'
       ),
       thermal_days AS (
         SELECT DISTINCT date_trunc('day', detected_at)::date AS d
           FROM thermal_anomalies
       ),
       all_days AS (
         SELECT d FROM event_days
         UNION SELECT d FROM ru
         UNION SELECT d FROM ua
         UNION SELECT d FROM thermal_days
       )
       SELECT a.d AS date,
              COALESCE(e.n, 0) AS event_count,
              ru.area_sq_km AS area_ru_sq_km,
              ua.area_sq_km AS area_ua_sq_km
         FROM all_days a
         LEFT JOIN event_days e ON e.d = a.d
         LEFT JOIN ru ON ru.d = a.d
         LEFT JOIN ua ON ua.d = a.d
        ORDER BY a.d ASC`,
    );

    const days = rows.map((r) => ({
      date: r.date,
      eventCount: r.event_count,
      areaRuSqKm: r.area_ru_sq_km,
      areaUaSqKm: r.area_ua_sq_km,
    }));

    res.json({
      minDate: days[0]?.date ?? null,
      maxDate: days[days.length - 1]?.date ?? null,
      days,
    });
  } catch (err) {
    next(err);
  }
});
