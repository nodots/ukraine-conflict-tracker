import type { EventType } from "./types.js";

// Base lethality/impact weight per event type. Missile and air strikes tend to
// carry heavier payloads than loitering-munition drone strikes or shelling, so
// they start higher. This is a presentation heuristic, not an analytic claim.
const TYPE_BASE_WEIGHT: Record<EventType, number> = {
  missile_strike: 0.6,
  airstrike: 0.55,
  drone_strike: 0.4,
  shelling: 0.35,
  other: 0.3,
};

// Derive a 0..1 severity used for marker sizing and heatmap weighting.
// Combines the event-type base weight with a saturating contribution from
// reported fatalities (log-scaled so a handful of deaths already reads as
// serious without a single mass-casualty event dominating the map).
export function deriveSeverity(
  eventType: EventType,
  fatalities: number | null | undefined,
): number {
  const base = TYPE_BASE_WEIGHT[eventType] ?? TYPE_BASE_WEIGHT.other;
  const deaths = Math.max(0, fatalities ?? 0);
  // log10(1+deaths)/log10(1+50) reaches ~1.0 around 50 fatalities.
  const fatalityFactor = Math.min(1, Math.log10(1 + deaths) / Math.log10(51));
  const severity = base + (1 - base) * fatalityFactor;
  return Math.max(0, Math.min(1, severity));
}
