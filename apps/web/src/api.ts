import type {
  ControlFeatureCollection,
  EventFeatureCollection,
  FrontlineFeature,
  StatsResponse,
  ThermalFeatureCollection,
  TimelineResponse,
} from "@ukraine-tracker/shared";

const BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:6732/api";

export class ApiError extends Error {}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const resp = await fetch(`${BASE_URL}${path}`, { signal });
  if (!resp.ok) {
    let detail = `${resp.status} ${resp.statusText}`;
    try {
      const body = (await resp.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // ignore parse failure; keep status text
    }
    throw new ApiError(detail);
  }
  return (await resp.json()) as T;
}

export interface ControlResponse extends ControlFeatureCollection {
  asOfDate: string | null;
}

export function fetchTimeline(signal?: AbortSignal): Promise<TimelineResponse> {
  return request<TimelineResponse>("/timeline", signal);
}

export function fetchEvents(
  params: { from?: string; to?: string; type?: string },
  signal?: AbortSignal,
): Promise<EventFeatureCollection> {
  const q = new URLSearchParams();
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  if (params.type) q.set("type", params.type);
  return request<EventFeatureCollection>(`/events?${q.toString()}`, signal);
}

export function fetchControl(
  date: string,
  signal?: AbortSignal,
): Promise<ControlResponse> {
  return request<ControlResponse>(`/control?date=${date}`, signal);
}

export function fetchFrontline(
  date: string,
  signal?: AbortSignal,
): Promise<FrontlineFeature & { geometry: unknown }> {
  return request(`/frontline?date=${date}`, signal);
}

export function fetchThermal(
  params: { from?: string; to?: string },
  signal?: AbortSignal,
): Promise<ThermalFeatureCollection> {
  const q = new URLSearchParams();
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  return request<ThermalFeatureCollection>(`/thermal?${q.toString()}`, signal);
}

export function fetchStats(
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<StatsResponse> {
  return request<StatsResponse>(`/stats?from=${from}&to=${to}`, signal);
}
