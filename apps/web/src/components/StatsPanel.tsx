import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { EventType, StatsResponse } from "@ukraine-tracker/shared";
import { EVENT_COLORS, EVENT_LABELS, formatArea } from "../format.js";

export interface StatsPanelProps {
  stats: StatsResponse | null;
  windowLabel: string;
}

// Summary side panel for the current playback window: strikes by type,
// fatalities, and net RU territory change.
export function StatsPanel({ stats, windowLabel }: StatsPanelProps) {
  return (
    <Box
      sx={{
        position: "absolute",
        top: 12,
        left: 12,
        bgcolor: "rgba(0,0,0,0.68)",
        backdropFilter: "blur(4px)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 1,
        px: 1.5,
        py: 1.25,
        width: 240,
      }}
    >
      <Typography variant="overline" color="text.secondary">
        {windowLabel}
      </Typography>

      {!stats ? (
        <Typography variant="body2" color="text.secondary">
          loading…
        </Typography>
      ) : (
        <>
          <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              Total strikes
            </Typography>
            <Typography variant="body2">{stats.totalEvents.toLocaleString()}</Typography>
          </Stack>
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="body2" color="text.secondary">
              Fatalities
            </Typography>
            <Typography variant="body2">{stats.totalFatalities.toLocaleString()}</Typography>
          </Stack>

          <Divider sx={{ my: 1 }} />

          {(Object.keys(EVENT_COLORS) as EventType[]).map((t) => {
            const n = stats.byType[t] ?? 0;
            if (n === 0) return null;
            return (
              <Stack
                key={t}
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ my: 0.25 }}
              >
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      bgcolor: EVENT_COLORS[t],
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {EVENT_LABELS[t]}
                  </Typography>
                </Stack>
                <Typography variant="caption">{n.toLocaleString()}</Typography>
              </Stack>
            );
          })}

          <Divider sx={{ my: 1 }} />

          <Stack direction="row" justifyContent="space-between">
            <Typography variant="body2" color="text.secondary">
              Net UA territory
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color:
                  stats.netTerritoryChangeUaSqKm === null
                    ? "text.secondary"
                    : stats.netTerritoryChangeUaSqKm > 0
                      ? "#4ade80"
                      : "#f87171",
              }}
            >
              {stats.netTerritoryChangeUaSqKm === null
                ? "—"
                : `${stats.netTerritoryChangeUaSqKm > 0 ? "+" : ""}${formatArea(
                    stats.netTerritoryChangeUaSqKm,
                  )}`}
            </Typography>
          </Stack>
        </>
      )}
    </Box>
  );
}
