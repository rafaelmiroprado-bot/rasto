const express = require("express");
const cors = require("cors");
const path = require("path");
const addonInterface = require("./addon");
const { getRouter } = require("stremio-addon-sdk");

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

// ── Stremio addon routes ───────────────────────────────────────────────────
app.use(getRouter(addonInterface));

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║        TorrentBR Scraper — Stremio Addon                 ║
╠══════════════════════════════════════════════════════════╣
║  Página de instalação : http://localhost:${PORT}             ║
║  Manifest             : http://localhost:${PORT}/manifest.json ║
╚══════════════════════════════════════════════════════════╝
  `);
});
