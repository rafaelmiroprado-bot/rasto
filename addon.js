const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const scrapers = require("./scrapers");

const manifest = {
  id: "br.stremio.torrent.scraper",
  version: "1.0.0",
  name: "TorrentBR Scraper",
  description:
    "Raspa torrents de múltiplas fontes para filmes e séries. Suporta YTS, 1337x, The Pirate Bay e mais.",
  logo: "https://i.imgur.com/p4MQHQV.png",
  background: "https://i.imgur.com/p4MQHQV.png",
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
  console.log(`\n[TorrentBR] Buscando streams para: type=${type} id=${id}`);

  // Parse id — filmes: "tt1234567", séries: "tt1234567:1:2"
  const parts = id.split(":");
  const imdbId = parts[0];
  const season = parts[1] ? parseInt(parts[1]) : null;
  const episode = parts[2] ? parseInt(parts[2]) : null;

  const isSeries = type === "series" && season !== null;

  let allStreams = [];

  try {
    const results = await scrapers.scrapeAll(imdbId, isSeries, season, episode);
    allStreams = results;
  } catch (err) {
    console.error("[TorrentBR] Erro geral no scraping:", err.message);
  }

  // Deduplicar por infoHash
  const seen = new Set();
  const unique = allStreams.filter((s) => {
    if (!s.infoHash) return true;
    const key = s.infoHash.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Ordenar: qualidade > seeders
  const qualityOrder = { "2160p": 0, "1080p": 1, "720p": 2, "480p": 3, "360p": 4 };
  unique.sort((a, b) => {
    const qa = qualityOrder[a._quality] ?? 9;
    const qb = qualityOrder[b._quality] ?? 9;
    if (qa !== qb) return qa - qb;
    return (b._seeders || 0) - (a._seeders || 0);
  });

  console.log(`[TorrentBR] Total de streams encontrados: ${unique.length}`);

  return { streams: unique };
});

module.exports = builder.getInterface();
