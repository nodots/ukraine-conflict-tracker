import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";

export const frontlineRouter = Router();

const querySchema = z.object({
  date: z.string().optional(),
  source: z.string().optional(),
});

// GET /api/frontline?date=YYYY-MM-DD — the derived contact line for the
// snapshot on or just before `date`, as a single GeoJSON Feature.
frontlineRouter.get("/", async (req, res, next) => {
  try {
    const q = querySchema.parse(req.query);
    const params: unknown[] = [];
    const conds: string[] = [];
    if (q.date) {
      params.push(q.date);
      conds.push(`as_of_date <= $${params.length}`);
    }
    if (q.source) {
      params.push(q.source);
      conds.push(`source_type = $${params.length}`);
    }
    const whereSql = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";

    const { rows } = await pool.query(
      `SELECT as_of_date, source_type, ST_AsGeoJSON(geom)::json AS geometry
         FROM frontlines
         ${whereSql}
         ORDER BY as_of_date DESC
         LIMIT 1`,
      params,
    );

    const row = rows[0];
    if (!row) {
      res.json({ type: "Feature", geometry: null, properties: { asOfDate: null } });
      return;
    }

    res.json({
      type: "Feature",
      geometry: row.geometry,
      properties: { asOfDate: row.as_of_date, sourceType: row.source_type },
    });
  } catch (err) {
    next(err);
  }
});
