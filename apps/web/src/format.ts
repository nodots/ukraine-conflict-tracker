import type { EventType, Faction } from "@ukraine-tracker/shared";

// Strike type → marker color.
export const EVENT_COLORS: Record<EventType, string> = {
  drone_strike: "#facc15", // yellow
  missile_strike: "#ef4444", // red
  airstrike: "#fb923c", // orange
  shelling: "#60a5fa", // blue
  other: "#9ca3af", // gray
};

export const EVENT_LABELS: Record<EventType, string> = {
  drone_strike: "Drone strike",
  missile_strike: "Missile strike",
  airstrike: "Airstrike",
  shelling: "Shelling",
  other: "Other",
};

// Faction → fill color for area-of-control polygons.
export const FACTION_COLORS: Record<Faction, string> = {
  RU: "#dc2626", // red
  UA: "#2563eb", // blue
  contested: "#a855f7", // purple
};

export const FACTION_LABELS: Record<Faction, string> = {
  RU: "Russian-controlled",
  UA: "Ukrainian-controlled",
  contested: "Contested",
};

export function formatDate(d: string): string {
  // `d` is a calendar date string ("YYYY-MM-DD"). `new Date("2026-06-01")` parses
  // as UTC midnight, which then renders a day earlier in timezones behind UTC.
  // Append a local time so it's treated as that calendar day in local time.
  return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatArea(sqKm: number | null | undefined): string {
  if (sqKm === null || sqKm === undefined) return "—";
  return `${Math.round(sqKm).toLocaleString()} km²`;
}
