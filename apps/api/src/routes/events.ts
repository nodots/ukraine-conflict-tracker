import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";

export const eventsRouter = Router();

const querySchema = z.object({
  from: z.string().optional(), // ISO date/datetime, inclusive
  to: z.string().optional(), // ISO date/datetime, exclusive
  type: z.string().optional(), // comma-separated event types
  actor: z.string().optional(),
  bbox: z.string().optional(), // "minLon,minLat,maxLon,maxLat"
  limit: z.coerce.number().int().min(1).max(20000).default(5000),
});

// GET /api/events — point events in a time window / area, as a GeoJSON
// FeatureCollection ready to drop into a MapLibre source.
eventsRouter.get("/", async (req, res, next) => {
  try {
    const q = querySchema.parse(req.query);
    const where: string[] = [];
    const params: unknown[] = [];

    if (q.from) {
      params.push(q.from);
      where.push(`event_time >= $${params.length}`);
    }
    if (q.to) {
      params.push(q.to);
      where.push(`event_time < $${params.length}`);
    }
    if (q.type) {
      const types = q.type.split(",").map((t) => t.trim()).filter(Boolean);
      if (types.length > 0) {
        params.push(types);
        where.push(`event_type = ANY($${params.length})`);
      }
    }
    if (q.actor) {
      params.push(q.actor);
      where.push(`actor = $${params.length}`);
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
      `SELECT id, event_type, event_time, lat, lon, admin_area, actor, target,
              fatalities, severity, source_type, source_name, source_url,
              confidence, description
         FROM events
         ${whereSql}
         ORDER BY event_time ASC
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
          eventType: r.event_type,
          eventTime: r.event_time,
          adminArea: r.admin_area,
          actor: r.actor,
          target: r.target,
          fatalities: r.fatalities,
          severity: Number(r.severity),
          sourceType: r.source_type,
          sourceName: r.source_name,
          sourceUrl: r.source_url,
          confidence: Number(r.confidence),
          description: r.description,
        },
      })),
    });
  } catch (err) {
    next(err);
  }
});
