import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
import { deriveSeverity, type EventType } from "@ukraine-tracker/shared";

export const adminRouter = Router();

const createEventSchema = z.object({
  eventType: z.enum([
    "drone_strike",
    "missile_strike",
    "shelling",
    "airstrike",
    "equipment_loss",
    "other",
  ]),
  eventTime: z.string(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  adminArea: z.string().optional(),
  actor: z.string().optional(),
  target: z.string().optional(),
  fatalities: z.number().int().min(0).optional(),
  sourceName: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  confidence: z.number().min(0).max(1).default(0.6),
  description: z.string().optional(),
});

// POST /api/admin/events — manual event entry (curation fallback). Severity is
// derived server-side from type + fatalities so it stays consistent with feeds.
adminRouter.post("/events", async (req, res, next) => {
  try {
    const body = createEventSchema.parse(req.body);
    const severity = deriveSeverity(
      body.eventType as EventType,
      body.fatalities ?? null,
    );

    const { rows } = await pool.query(
      `INSERT INTO events
         (event_type, event_time, location, lat, lon, admin_area, actor, target,
          fatalities, severity, source_type, source_name, source_url, confidence,
          description)
       VALUES
         ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326), $3, $4, $5, $6, $7,
          $8, $9, 'manual', $10, $11, $12, $13)
       RETURNING id`,
      [
        body.eventType,
        body.eventTime,
        body.lat,
        body.lon,
        body.adminArea ?? null,
        body.actor ?? null,
        body.target ?? null,
        body.fatalities ?? null,
        severity,
        body.sourceName ?? null,
        body.sourceUrl ?? null,
        body.confidence,
        body.description ?? null,
      ],
    );

    res.status(201).json({ id: rows[0]?.id, severity });
  } catch (err) {
    next(err);
  }
});
