import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";

export const controlRouter = Router();

const querySchema = z.object({
  date: z.string().optional(), // YYYY-MM-DD; defaults to latest snapshot
  source: z.string().optional(),
});

// GET /api/control?date=YYYY-MM-DD — control polygons for the snapshot on or
// just before `date`, one Feature per faction, as a GeoJSON FeatureCollection.
controlRouter.get("/", async (req, res, next) => {
  try {
    const q = querySchema.parse(req.query);
    const params: unknown[] = [];

    // Resolve the effective snapshot date: the most recent as_of_date <= date
    // (or the latest available if no date given).
    let dateFilter = "";
    if (q.date) {
      params.push(q.date);
      dateFilter = `WHERE as_of_date <= $${params.length}`;
    }
    if (q.source) {
      params.push(q.source);
      dateFilter += dateFilter ? ` AND source_type = $${params.length}` : `WHERE source_type = $${params.length}`;
    }

    const dateRow = await pool.query(
      `SELECT max(as_of_date) AS d FROM control_areas ${dateFilter}`,
      params,
    );
    const effectiveDate: string | null = dateRow.rows[0]?.d ?? null;
    if (!effectiveDate) {
      res.json({ type: "FeatureCollection", features: [], asOfDate: null });
      return;
    }

    const fetchParams: unknown[] = [effectiveDate];
    let sourceFilter = "";
    if (q.source) {
      fetchParams.push(q.source);
      sourceFilter = `AND source_type = $${fetchParams.length}`;
    }

    const { rows } = await pool.query(
      `SELECT faction, as_of_date, area_sq_km, source_type,
              ST_AsGeoJSON(geom)::json AS geometry
         FROM control_areas
        WHERE as_of_date = $1 ${sourceFilter}`,
      fetchParams,
    );

    res.json({
      type: "FeatureCollection",
      asOfDate: effectiveDate,
      features: rows.map((r) => ({
        type: "Feature",
        geometry: r.geometry,
        properties: {
          faction: r.faction,
          asOfDate: r.as_of_date,
          areaSqKm: r.area_sq_km,
          sourceType: r.source_type,
        },
      })),
    });
  } catch (err) {
    next(err);
  }
});
