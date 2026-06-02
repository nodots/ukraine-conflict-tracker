import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { MapPage } from "./pages/MapPage.js";

export function App() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <AppBar position="static" color="default" elevation={0}>
        <Toolbar variant="dense">
          <Typography variant="h6" sx={{ flex: 1, fontWeight: 600 }}>
            Ukraine Conflict Tracker
          </Typography>
          <Typography variant="caption" color="text.secondary">
            drone &amp; missile strikes · frontline movement
          </Typography>
        </Toolbar>
      </AppBar>
      <MapPage />
    </Box>
  );
}
