const { addonBuilder } = require("stremio-addon-sdk");
const scrapers = require("./scrapers");

const manifest = {
  id: "br.stremio.stream.finder",
  version: "1.0.0",
  name: "StreamBR Finder",
  description: "Busca streams de múltiplas fontes para filmes e séries.",
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
  console.log(`\n[StreamBR] type=${type} id=${id}`);

  const parts   = id.split(":");
  const imdbId  = parts[0];
  const season  = parts[1] ? parseInt(parts[1]) : null;
  const episode = parts[2] ? parseInt(parts[2]) : null;
  const isSeries = type === "series" && season !== null;

  let allStreams = [];
  try {
    allStreams = await scrapers.scrapeAll(imdbId, isSeries, season, episode);
  } catch (err) {
    console.error("[StreamBR] Erro:", err.message);
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

  // Ordenar por qualidade > seeders
  const qualityOrder = { "2160p": 0, "1080p": 1, "720p": 2, "480p": 3, "360p": 4 };
  unique.sort((a, b) => {
    const qa = qualityOrder[a._quality] ?? 9;
    const qb = qualityOrder[b._quality] ?? 9;
    if (qa !== qb) return qa - qb;
    return (b._seeders || 0) - (a._seeders || 0);
  });

  console.log(`[StreamBR] ${unique.length} streams encontrados`);
  return { streams: unique };
});

module.exports = builder.getInterface();
