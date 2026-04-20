const express = require("express");
const cors    = require("cors");
const path    = require("path");

// ── Detecta URL base do próprio servidor para o logo ─────────────────────────
// Railway injeta RAILWAY_PUBLIC_DOMAIN; fallback para PORT
const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
if (publicDomain && !process.env.ADDON_BASE_URL) {
  process.env.ADDON_BASE_URL = `https://${publicDomain}`;
}

const addonInterface = require("./addon");
const { getRouter }  = require("stremio-addon-sdk");

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

// Serve SVG logo with correct content-type
app.get("/logo.svg", (req, res) => {
  res.setHeader("Content-Type", "image/svg+xml");
  res.sendFile(path.join(__dirname, "public", "logo.svg"));
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", name: "Sharefy", baseUrl: process.env.ADDON_BASE_URL, time: new Date().toISOString() });
});

// Test endpoint
app.get("/test", async (req, res) => {
  try {
    const scrapers = require("./scrapers");
    const imdbId   = req.query.id || "tt0468569";
    const streams  = await scrapers.scrapeAll(imdbId, false, null, null);
    const valid    = streams.filter(s => s.infoHash || s.url);
    res.json({
      imdbId,
      total: streams.length,
      valid: valid.length,
      sample: valid.slice(0, 3).map(s => ({
        name: s.name, infoHash: s.infoHash, seeders: s._seeders, quality: s._quality,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Stremio addon routes
app.use(getRouter(addonInterface));

// Fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, "0.0.0.0", () => {
  const base = process.env.ADDON_BASE_URL || `http://localhost:${PORT}`;
  console.log(`[Sharefy] Running at ${base}`);
  console.log(`[Sharefy] Logo:     ${base}/logo.svg`);
  console.log(`[Sharefy] Manifest: ${base}/manifest.json`);
  console.log(`[Sharefy] Test:     ${base}/test`);
});
