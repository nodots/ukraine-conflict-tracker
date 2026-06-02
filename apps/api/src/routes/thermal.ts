import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";

export const thermalRouter = Router();

const querySchema = z.object({
  from: z.string().optional(), // ISO, inclusive
  to: z.string().optional(), // ISO, exclusive
  bbox: z.string().optional(), // "minLon,minLat,maxLon,maxLat"
  limit: z.coerce.number().int().min(1).max(50000).default(20000),
});

// GET /api/thermal — FIRMS thermal anomalies (active fires) in a time window /
// area, as a GeoJSON FeatureCollection for a toggleable corroborating layer.
thermalRouter.get("/", async (req, res, next) => {
  try {
    const q = querySchema.parse(req.query);
    const where: string[] = [];
    const params: unknown[] = [];

    if (q.from) {
      params.push(q.from);
      where.push(`detected_at >= $${params.length}`);
    }
    if (q.to) {
      params.push(q.to);
      where.push(`detected_at < $${params.length}`);
    }
    if (q.bbox) {
      const parts = q.bbox.split(",").map(Number);
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
        const [minLon, minLat, maxLon, maxLat] = parts as [
          number,
          number,
          number,
          number,
        ];
        params.push(minLon, minLat, maxLon, maxLat);
        where.push(
          `lon BETWEEN $${params.length - 3} AND $${params.length - 1} AND lat BETWEEN $${params.length - 2} AND $${params.length}`,
        );
      }
    }

    params.push(q.limit);
    const limitIdx = params.length;

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT id, detected_at, lat, lon, frp, confidence, brightness,
              satellite, source_type
         FROM thermal_anomalies
         ${whereSql}
         ORDER BY detected_at ASC
         LIMIT $${limitIdx}`,
      params,
    );

    res.json({
      type: "FeatureCollection",
      features: rows.map((r) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [r.lon, r.lat] },
        properties: {
          id: r.id,
          detectedAt: r.detected_at,
          frp: r.frp === null ? null : Number(r.frp),
          confidence: r.confidence,
          brightness: r.brightness === null ? null : Number(r.brightness),
          satellite: r.satellite,
          sourceType: r.source_type,
        },
      })),
    });
  } catch (err) {
    next(err);
  }
});
