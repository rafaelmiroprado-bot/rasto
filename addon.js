const { addonBuilder } = require("stremio-addon-sdk");
const scrapers = require("./scrapers");

const manifest = {
  id: "community.purefy",
  version: "1.0.0",
  name: "Purefy",
  description: "Streams from the shadows. Finds torrents from multiple sources.",
  logo:       "https://raw.githubusercontent.com/Stremio/stremio-brand/master/Logo/logo_symbol/logo_symbol_blue.png",
  catalogs: [],
  resources: ["stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  behaviorHints: {
    configurable: false,
    configurationRequired: false,
  },
};

const builder = new addonBuilder(manifest);

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[Purefy] request: ${type} ${id}`);

  try {
    const parts    = id.split(":");
    const imdbId   = parts[0];
    const season   = parts[1] ? parseInt(parts[1]) : null;
    const episode  = parts[2] ? parseInt(parts[2]) : null;
    const isSeries = type === "series";

    const raw = await scrapers.scrapeAll(imdbId, isSeries, season, episode);

    // Only send what Stremio actually accepts
    const streams = raw
      .filter(s => s && (s.infoHash || s.url))
      .map(s => {
        const out = {
          name:        s.name,
          title:       s.title || s.description || s.name,
          behaviorHints: s.behaviorHints || {},
        };
        if (s.infoHash) out.infoHash = s.infoHash;
        if (s.url)      out.url      = s.url;
        if (s.sources)  out.sources  = s.sources;
        return out;
      });

    console.log(`[Purefy] returning ${streams.length} streams`);
    return { streams };
  } catch (err) {
    console.error(`[Purefy] error:`, err.message);
    return { streams: [] };
  }
});

module.exports = builder.getInterface();
