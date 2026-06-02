import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EventType, StatsResponse } from "@ukraine-tracker/shared";
import {
  fetchControl,
  fetchEvents,
  fetchFrontline,
  fetchStats,
  fetchTimeline,
} from "../api.js";
import { Legend, type LayerToggles } from "../components/Legend.js";
import { StatsPanel } from "../components/StatsPanel.js";
import { TimeControl } from "../components/TimeControl.js";
import {
  EVENT_COLORS,
  EVENT_LABELS,
  FACTION_COLORS,
  formatDate,
} from "../format.js";

const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/dark";
// Eastern Ukraine theater.
const CENTER: [number, number] = [36, 48.5];
const ZOOM = 5.5;
// Rolling window of strikes shown for a given date (trailing days).
const WINDOW_DAYS = 7;

const SRC = {
  controlFill: "control-fill",
  frontline: "frontline",
  strikes: "strikes",
} as const;

const LYR = {
  controlFill: "control-fill-layer",
  controlOutline: "control-outline-layer",
  frontline: "frontline-layer",
  strikesHeat: "strikes-heat-layer",
  strikesCircle: "strikes-circle-layer",
} as const;

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

interface SelectedStrike {
  eventType: EventType;
  eventTime: string;
  adminArea: string | null;
  actor: string | null;
  fatalities: number | null;
  sourceName: string | null;
  sourceUrl: string | null;
  description: string | null;
}

function windowFor(date: string): { from: string; to: string } {
  const to = new Date(`${date}T23:59:59Z`);
  const from = new Date(to.getTime() - WINDOW_DAYS * 86400000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function MapPage() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [styleReady, setStyleReady] = useState(false);

  const [dates, setDates] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4); // steps per second
  const [toggles, setToggles] = useState<LayerToggles>({
    control: true,
    frontline: true,
    strikes: true,
    heatmap: false,
  });
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [selected, setSelected] = useState<SelectedStrike | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentDate = dates[index];

  // Init map once.
  useEffect(() => {
    if (!mapContainer.current) return;
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: BASEMAP_STYLE,
      center: CENTER,
      zoom: ZOOM,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      // Sources start empty; data is pushed via setData on date change.
      map.addSource(SRC.controlFill, { type: "geojson", data: EMPTY_FC });
      map.addSource(SRC.frontline, { type: "geojson", data: EMPTY_FC });
      map.addSource(SRC.strikes, { type: "geojson", data: EMPTY_FC });

      map.addLayer({
        id: LYR.controlFill,
        type: "fill",
        source: SRC.controlFill,
        paint: {
          "fill-color": [
            "match",
            ["get", "faction"],
            "RU",
            FACTION_COLORS.RU,
            "UA",
            FACTION_COLORS.UA,
            FACTION_COLORS.contested,
          ],
          "fill-opacity": 0.18,
        },
      });
      map.addLayer({
        id: LYR.controlOutline,
        type: "line",
        source: SRC.controlFill,
        paint: { "line-color": ["match", ["get", "faction"], "RU", FACTION_COLORS.RU, "UA", FACTION_COLORS.UA, FACTION_COLORS.contested], "line-opacity": 0.5, "line-width": 1 },
      });
      map.addLayer({
        id: LYR.frontline,
        type: "line",
        source: SRC.frontline,
        paint: { "line-color": "#ffffff", "line-width": 2.5, "line-opacity": 0.9 },
      });
      map.addLayer({
        id: LYR.strikesHeat,
        type: "heatmap",
        source: SRC.strikes,
        layout: { visibility: "none" },
        paint: {
          "heatmap-weight": ["get", "severity"],
          "heatmap-radius": 18,
          "heatmap-opacity": 0.7,
        },
      });
      map.addLayer({
        id: LYR.strikesCircle,
        type: "circle",
        source: SRC.strikes,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "severity"], 0, 3, 1, 9],
          "circle-color": [
            "match",
            ["get", "eventType"],
            "drone_strike",
            EVENT_COLORS.drone_strike,
            "missile_strike",
            EVENT_COLORS.missile_strike,
            "airstrike",
            EVENT_COLORS.airstrike,
            "shelling",
            EVENT_COLORS.shelling,
            EVENT_COLORS.other,
          ],
          "circle-stroke-color": "rgba(0,0,0,0.6)",
          "circle-stroke-width": 1,
          "circle-opacity": 0.85,
        },
      });

      map.on("click", LYR.strikesCircle, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as Record<string, string>;
        setSelected({
          eventType: p.eventType as EventType,
          eventTime: p.eventTime ?? "",
          adminArea: p.adminArea ?? null,
          actor: p.actor ?? null,
          fatalities: p.fatalities ? Number(p.fatalities) : null,
          sourceName: p.sourceName ?? null,
          sourceUrl: p.sourceUrl ?? null,
          description: p.description ?? null,
        });
      });
      map.on("mouseenter", LYR.strikesCircle, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", LYR.strikesCircle, () => {
        map.getCanvas().style.cursor = "";
      });

      setStyleReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setStyleReady(false);
    };
  }, []);

  // Load the timeline once; default to the most recent date.
  useEffect(() => {
    const controller = new AbortController();
    fetchTimeline(controller.signal)
      .then((t) => {
        const ds = t.days.map((d) => d.date);
        setDates(ds);
        setIndex(Math.max(0, ds.length - 1));
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, []);

  // Fetch + render data for the selected date (control, frontline, strikes).
  useEffect(() => {
    if (!styleReady || !currentDate) return;
    const map = mapRef.current;
    if (!map) return;
    const controller = new AbortController();
    const win = windowFor(currentDate);

    Promise.all([
      fetchControl(currentDate, controller.signal),
      fetchFrontline(currentDate, controller.signal),
      fetchEvents({ from: win.from, to: win.to }, controller.signal),
    ])
      .then(([control, frontline, events]) => {
        (map.getSource(SRC.controlFill) as maplibregl.GeoJSONSource | undefined)?.setData(
          control as unknown as GeoJSON.FeatureCollection,
        );
        (map.getSource(SRC.frontline) as maplibregl.GeoJSONSource | undefined)?.setData(
          (frontline.geometry
            ? { type: "Feature", geometry: frontline.geometry, properties: {} }
            : EMPTY_FC) as unknown as GeoJSON.Feature,
        );
        (map.getSource(SRC.strikes) as maplibregl.GeoJSONSource | undefined)?.setData(
          events as unknown as GeoJSON.FeatureCollection,
        );
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => controller.abort();
  }, [styleReady, currentDate]);

  // Fetch window stats for the panel.
  useEffect(() => {
    if (!currentDate) return;
    const controller = new AbortController();
    const win = windowFor(currentDate);
    fetchStats(win.from, win.to, controller.signal)
      .then(setStats)
      .catch(() => {
        // panel is non-load-bearing
      });
    return () => controller.abort();
  }, [currentDate]);

  // Apply layer visibility toggles.
  useEffect(() => {
    if (!styleReady) return;
    const map = mapRef.current;
    if (!map) return;
    const set = (id: string, on: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    };
    set(LYR.controlFill, toggles.control);
    set(LYR.controlOutline, toggles.control);
    set(LYR.frontline, toggles.frontline);
    set(LYR.strikesCircle, toggles.strikes);
    set(LYR.strikesHeat, toggles.heatmap);
  }, [styleReady, toggles]);

  // Playback: advance the date at `speed` steps per second; stop at the end.
  useEffect(() => {
    if (!playing || dates.length === 0) return;
    const id = setInterval(() => {
      setIndex((i) => {
        if (i >= dates.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 1000 / speed);
    return () => clearInterval(id);
  }, [playing, speed, dates.length]);

  const toggleLayer = (key: keyof LayerToggles) =>
    setToggles((prev) => ({ ...prev, [key]: !prev[key] }));

  const windowLabel = useMemo(() => {
    if (!currentDate) return "—";
    return `${WINDOW_DAYS}-day window ending ${formatDate(currentDate)}`;
  }, [currentDate]);

  return (
    <Box sx={{ position: "relative", flex: 1, minHeight: 0 }}>
      <Box ref={mapContainer} sx={{ position: "absolute", inset: 0 }} />

      <StatsPanel stats={stats} windowLabel={windowLabel} />
      <Legend toggles={toggles} onToggle={toggleLayer} />

      {dates.length > 0 && (
        <TimeControl
          dates={dates}
          index={index}
          playing={playing}
          speed={speed}
          onIndexChange={(i) => {
            setPlaying(false);
            setIndex(i);
          }}
          onTogglePlay={() => setPlaying((p) => !p)}
          onSpeedChange={setSpeed}
        />
      )}

      {error && (
        <Box
          sx={{
            position: "absolute",
            bottom: 90,
            left: "50%",
            transform: "translateX(-50%)",
            bgcolor: "rgba(120,0,0,0.8)",
            px: 2,
            py: 0.75,
            borderRadius: 1,
          }}
        >
          <Typography variant="caption">api error: {error}</Typography>
        </Box>
      )}

      <Box
        sx={{
          position: "absolute",
          bottom: 4,
          right: 8,
          opacity: 0.6,
        }}
      >
        <Typography variant="caption" color="text.secondary">
          Events: UCDP GED + GDELT · Control: DeepState · Basemap: OpenFreeMap
        </Typography>
      </Box>

      <Drawer
        anchor="right"
        open={selected !== null}
        onClose={() => setSelected(null)}
        slotProps={{ paper: { sx: { width: 340 } } }}
      >
        {selected && (
          <Box sx={{ p: 2.5 }}>
            <Stack direction="row" alignItems="flex-start" spacing={1}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="h6">{EVENT_LABELS[selected.eventType]}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {new Date(selected.eventTime).toLocaleString()}
                </Typography>
              </Box>
              <IconButton size="small" onClick={() => setSelected(null)} aria-label="close" sx={{ mt: -0.5 }}>
                <Box component="span" sx={{ fontSize: 18, lineHeight: 1 }}>
                  &times;
                </Box>
              </IconButton>
            </Stack>

            <Divider sx={{ my: 2 }} />

            <Stack spacing={1.25}>
              <Chip
                size="small"
                label={EVENT_LABELS[selected.eventType]}
                sx={{ bgcolor: EVENT_COLORS[selected.eventType], color: "#0a0a0a", fontWeight: 600, alignSelf: "flex-start" }}
              />
              {selected.adminArea && <Row label="Area" value={selected.adminArea} />}
              {selected.actor && <Row label="Actor" value={selected.actor} />}
              {selected.fatalities !== null && (
                <Row label="Fatalities" value={String(selected.fatalities)} />
              )}
              {selected.sourceName && <Row label="Source" value={selected.sourceName} />}
            </Stack>

            {selected.description && (
              <>
                <Divider sx={{ my: 2 }} />
                <Typography variant="body2" color="text.secondary">
                  {selected.description}
                </Typography>
              </>
            )}

            {selected.sourceUrl && (
              <>
                <Divider sx={{ my: 2 }} />
                <Link href={selected.sourceUrl} target="_blank" rel="noopener" variant="body2">
                  Open source
                </Link>
              </>
            )}
          </Box>
        )}
      </Drawer>
    </Box>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ textAlign: "right" }}>
        {value}
      </Typography>
    </Stack>
  );
}
