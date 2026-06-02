import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import {
  EVENT_COLORS,
  EVENT_LABELS,
  FACTION_COLORS,
  FACTION_LABELS,
} from "../format.js";
import type { EventType, Faction } from "@ukraine-tracker/shared";

export interface LayerToggles {
  control: boolean;
  frontline: boolean;
  strikes: boolean;
  heatmap: boolean;
}

export interface LegendProps {
  toggles: LayerToggles;
  onToggle: (key: keyof LayerToggles) => void;
}

export function Legend({ toggles, onToggle }: LegendProps) {
  return (
    <Box
      sx={{
        position: "absolute",
        top: 12,
        right: 12,
        bgcolor: "rgba(0,0,0,0.68)",
        backdropFilter: "blur(4px)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 1,
        px: 1.5,
        py: 1.25,
        width: 220,
      }}
    >
      <Typography variant="overline" color="text.secondary">
        Layers
      </Typography>
      <Stack spacing={0}>
        <LayerSwitch label="Areas of control" on={toggles.control} onChange={() => onToggle("control")} />
        <LayerSwitch label="Frontline" on={toggles.frontline} onChange={() => onToggle("frontline")} />
        <LayerSwitch label="Strikes" on={toggles.strikes} onChange={() => onToggle("strikes")} />
        <LayerSwitch label="Strike heatmap" on={toggles.heatmap} onChange={() => onToggle("heatmap")} />
      </Stack>

      <Typography variant="overline" color="text.secondary" sx={{ mt: 1, display: "block" }}>
        Control
      </Typography>
      {(Object.keys(FACTION_COLORS) as Faction[]).map((f) => (
        <Swatch key={f} color={FACTION_COLORS[f]} label={FACTION_LABELS[f]} square />
      ))}

      <Typography variant="overline" color="text.secondary" sx={{ mt: 1, display: "block" }}>
        Strike type
      </Typography>
      {(Object.keys(EVENT_COLORS) as EventType[]).map((t) => (
        <Swatch key={t} color={EVENT_COLORS[t]} label={EVENT_LABELS[t]} />
      ))}
    </Box>
  );
}

function LayerSwitch({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: () => void;
}) {
  return (
    <FormControlLabel
      control={<Switch size="small" checked={on} onChange={onChange} />}
      label={<Typography variant="body2">{label}</Typography>}
      sx={{ ml: 0, my: -0.25 }}
    />
  );
}

function Swatch({
  color,
  label,
  square,
}: {
  color: string;
  label: string;
  square?: boolean;
}) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ my: 0.25 }}>
      <Box
        sx={{
          width: 12,
          height: 12,
          borderRadius: square ? 0.5 : "50%",
          bgcolor: color,
          border: "1px solid rgba(0,0,0,0.6)",
        }}
      />
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  );
}
