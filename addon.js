const { addonBuilder } = require("stremio-addon-sdk");
const scrapers = require("./scrapers");

// Logo served from own server — URL injected at runtime by server.js
const ADDON_ID = "community.sharefy.streams";
const ADDON_NAME = "Sharefy";
const ADDON_VERSION = "1.0.1";
const BASE_URL = (process.env.ADDON_BASE_URL || "http://localhost:7000").replace(/\/+$/, "");
const CACHE_TTL_MS = parseInt(process.env.STREAM_CACHE_TTL_MS || "900000", 10);
const MAX_STREAMS = parseInt(process.env.MAX_STREAMS || "80", 10);
const MAX_STREAMS_PER_QUALITY = parseInt(process.env.MAX_STREAMS_PER_QUALITY || "12", 10);
const STREAM_SORT = (process.env.STREAM_SORT || "quality").toLowerCase();
const EXCLUDE_QUALITIES = new Set(
  (process.env.EXCLUDE_QUALITIES || "")
    .split(",")
    .map(q => q.trim().toLowerCase())
    .filter(Boolean)
);
const streamCache = new Map();

const manifest = {
  id: ADDON_ID,
  version: ADDON_VERSION,
  name: ADDON_NAME,
  description: "Find torrent streams from multiple sources for movies and series.",
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
const QUALITY_RANK = { "2160p": 0, "1080p": 1, "720p": 2, "480p": 3, "360p": 4 };

function compareStreams(a, b) {
  const qa = QUALITY_RANK[a._quality] ?? 9;
  const qb = QUALITY_RANK[b._quality] ?? 9;
  const sa = a._seeders || 0;
  const sb = b._seeders || 0;

  if (STREAM_SORT === "seeders") {
    if (sa !== sb) return sb - sa;
    return qa - qb;
  }

  if (qa !== qb) return qa - qb;
  return sb - sa;
}

function limitPerQuality(streams) {
  if (!Number.isFinite(MAX_STREAMS_PER_QUALITY) || MAX_STREAMS_PER_QUALITY <= 0) {
    return streams;
  }

  const counts = new Map();
  return streams.filter(stream => {
    const quality = stream._quality || "Unknown";
    const current = counts.get(quality) || 0;
    if (current >= MAX_STREAMS_PER_QUALITY) return false;
    counts.set(quality, current + 1);
    return true;
  });
}

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`\n[Sharefy] Requisição: type=${type} id=${id}`);

  const parts    = id.split(":");
  const imdbId   = parts[0];
  const season   = parts[1] ? parseInt(parts[1], 10) : null;
  const episode  = parts[2] ? parseInt(parts[2], 10) : null;
  const isSeries = type === "series";

  if (!/^tt\d+$/.test(imdbId)) {
    console.warn(`[Sharefy] IMDb ID inválido: ${imdbId}`);
    return { streams: [] };
  }

  if (isSeries && (!Number.isInteger(season) || !Number.isInteger(episode))) {
    console.warn(`[Sharefy] Episódio inválido: ${id}`);
    return { streams: [] };
  }

  const cacheKey = `${type}:${id}`;
  const cached = streamCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
    console.log(`[Sharefy] Cache hit: ${cached.streams.length} streams`);
    return { streams: cached.streams };
  }

  let raw = [];
  try {
    raw = await scrapers.scrapeAll(imdbId, isSeries, season, episode);
  } catch (err) {
    console.error("[Sharefy] Erro no scrapeAll:", err.message);
  }

  console.log(`[Sharefy] Raw streams recebidos: ${raw.length}`);

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

  console.log(`[Sharefy] Streams válidos: ${valid.length}`);

  // Deduplicar por infoHash
  const seen   = new Set();
  const unique = valid.filter(s => {
    if (!s.infoHash) return true;
    const key = s.infoHash.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const sorted = unique
    .filter(s => !EXCLUDE_QUALITIES.has(String(s._quality || "").toLowerCase()))
    .sort(compareStreams);

  // Limpar campos internos
  const streams = limitPerQuality(sorted)
    .slice(0, MAX_STREAMS)
    .map(({ _quality, _seeders, ...rest }) => rest);

  streamCache.set(cacheKey, { time: Date.now(), streams });

  console.log(`[Sharefy] Enviando ${streams.length} streams`);
  if (streams[0]) console.log(`[Sharefy] Exemplo:`, JSON.stringify(streams[0]).slice(0, 200));

  return { streams };
});

module.exports = builder.getInterface();
