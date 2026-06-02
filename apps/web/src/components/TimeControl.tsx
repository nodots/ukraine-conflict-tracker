import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import SkipPreviousIcon from "@mui/icons-material/SkipPrevious";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { formatDate } from "../format.js";

export interface TimeControlProps {
  dates: string[];
  index: number;
  playing: boolean;
  speed: number; // playback steps per second
  onIndexChange: (index: number) => void;
  onTogglePlay: () => void;
  onSpeedChange: (speed: number) => void;
}

// The headline control: scrub through daily snapshots and play them back to
// watch the front move and strikes flash over the loaded window.
export function TimeControl({
  dates,
  index,
  playing,
  speed,
  onIndexChange,
  onTogglePlay,
  onSpeedChange,
}: TimeControlProps) {
  const max = Math.max(0, dates.length - 1);
  const current = dates[index];

  return (
    <Box
      sx={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(880px, calc(100% - 32px))",
        bgcolor: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(6px)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 1.5,
        px: 2,
        py: 1.25,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1.5}>
        <IconButton
          size="small"
          onClick={() => onIndexChange(Math.max(0, index - 1))}
          aria-label="previous day"
        >
          <SkipPreviousIcon fontSize="small" />
        </IconButton>
        <IconButton
          onClick={onTogglePlay}
          aria-label={playing ? "pause" : "play"}
          color="primary"
        >
          {playing ? <PauseIcon /> : <PlayArrowIcon />}
        </IconButton>
        <IconButton
          size="small"
          onClick={() => onIndexChange(Math.min(max, index + 1))}
          aria-label="next day"
        >
          <SkipNextIcon fontSize="small" />
        </IconButton>

        <Box sx={{ flex: 1, px: 1 }}>
          <Slider
            size="small"
            min={0}
            max={max}
            value={index}
            onChange={(_, v) => onIndexChange(v as number)}
            aria-label="date"
          />
        </Box>

        <Typography
          variant="body2"
          sx={{ minWidth: 130, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
        >
          {current ? formatDate(current) : "—"}
        </Typography>

        <Select
          size="small"
          value={speed}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          sx={{ height: 32, fontSize: 13 }}
        >
          <MenuItem value={2}>0.5×</MenuItem>
          <MenuItem value={4}>1×</MenuItem>
          <MenuItem value={8}>2×</MenuItem>
          <MenuItem value={16}>4×</MenuItem>
        </Select>
      </Stack>
    </Box>
  );
}
