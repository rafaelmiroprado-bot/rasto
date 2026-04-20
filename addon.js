const { addonBuilder } = require("stremio-addon-sdk");
const scrapers = require("./scrapers");

// Logo served from own server — URL injected at runtime by server.js
const BASE_URL = process.env.ADDON_BASE_URL || "http://localhost:7000";

const manifest = {
  id: "br.stremio.hookline",
  version: "1.0.0",
  name: "Hookline",
  description: "Find streams from multiple sources for movies and series.",
  logo:       `${BASE_URL}/logo.svg`,
  background: `${BASE_URL}/logo.svg`,
  resources: ["stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
  behaviorHints: {
    configurable: false,
    configurationRequired: false,
  },
};

const builder = new addonBuilder(manifest);

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`\n[Hookline] Requisição: type=${type} id=${id}`);

  const parts    = id.split(":");
  const imdbId   = parts[0];
  const season   = parts[1] ? parseInt(parts[1]) : null;
  const episode  = parts[2] ? parseInt(parts[2]) : null;
  const isSeries = type === "series" && season !== null;

  let raw = [];
  try {
    raw = await scrapers.scrapeAll(imdbId, isSeries, season, episode);
  } catch (err) {
    console.error("[Hookline] Erro no scrapeAll:", err.message);
  }

  console.log(`[Hookline] Raw streams recebidos: ${raw.length}`);

  // Validação — Stremio exige infoHash hex-40, hex-32 ou base32-32
  const HEX40 = /^[a-fA-F0-9]{40}$/;
  const HEX32 = /^[a-fA-F0-9]{32}$/;
  const B32   = /^[a-zA-Z2-7]{32}$/i;

  const valid = raw.filter(s => {
    if (s.url || s.externalUrl) return true;
    if (s.infoHash) {
      const h = s.infoHash.toLowerCase();
      return HEX40.test(h) || HEX32.test(h) || B32.test(h);
    }
    return false;
  });

  console.log(`[Hookline] Streams válidos: ${valid.length}`);

  // Deduplicar por infoHash
  const seen   = new Set();
  const unique = valid.filter(s => {
    if (!s.infoHash) return true;
    const key = s.infoHash.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Ordenar: qualidade > seeders
  const Q = { "2160p": 0, "1080p": 1, "720p": 2, "480p": 3, "360p": 4 };
  unique.sort((a, b) => {
    const qa = Q[a._quality] ?? 9;
    const qb = Q[b._quality] ?? 9;
    if (qa !== qb) return qa - qb;
    return (b._seeders || 0) - (a._seeders || 0);
  });

  // Limpar campos internos
  const streams = unique.map(({ _quality, _seeders, ...rest }) => rest);

  console.log(`[Hookline] Enviando ${streams.length} streams`);
  if (streams[0]) console.log(`[Hookline] Exemplo:`, JSON.stringify(streams[0]).slice(0, 200));

  return { streams };
});

module.exports = builder.getInterface();
