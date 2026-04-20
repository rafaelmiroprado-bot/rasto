/**
 * Anzol — scrapers.js
 * Fontes otimizadas para rodar em servidor (Railway/VPS)
 * Todas com retry, múltiplos mirrors e headers anti-bloqueio
 */

const axios   = require("axios");
const cheerio = require("cheerio");

// ─── HTTP clients ─────────────────────────────────────────────────────────────

function makeClient(extraHeaders = {}) {
  return axios.create({
    timeout: 20000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Cache-Control": "max-age=0",
      ...extraHeaders,
    },
    maxRedirects: 5,
  });
}

const http     = makeClient();
const httpJson = makeClient({ "Accept": "application/json, text/plain, */*", "Content-Type": "application/json" });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractQuality(str) {
  if (!str) return "Unknown";
  if (/2160p|4K|UHD/i.test(str))    return "2160p";
  if (/1080p|FHD/i.test(str))       return "1080p";
  if (/720p|HD(?!R)/i.test(str))    return "720p";
  if (/480p/i.test(str))            return "480p";
  if (/360p/i.test(str))            return "360p";
  return "Unknown";
}

function extractCodec(str) {
  if (!str) return null;
  if (/HEVC|x265|H\.265/i.test(str)) return "x265";
  if (/AVC|x264|H\.264/i.test(str))  return "x264";
  if (/AV1/i.test(str))              return "AV1";
  if (/XviD/i.test(str))             return "XviD";
  return null;
}

function extractAudio(str) {
  if (!str) return null;
  if (/DTS-HD|DTSHD/i.test(str))      return "DTS-HD";
  if (/TrueHD|Atmos/i.test(str))      return "TrueHD";
  if (/DD\+|EAC3|E-AC-3/i.test(str)) return "DD+";
  if (/DTS/i.test(str))               return "DTS";
  if (/DD|AC3|Dolby/i.test(str))      return "DD";
  if (/AAC/i.test(str))               return "AAC";
  if (/MP3/i.test(str))               return "MP3";
  return null;
}

function parseNum(str) {
  if (!str) return 0;
  const n = parseInt(String(str).replace(/[^0-9]/g, ""), 10);
  return isNaN(n) ? 0 : n;
}

const TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.tracker.cl:1337/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.tiny-vps.com:6969/announce",
  "udp://tracker.moeking.me:6969/announce",
  "udp://tracker.leechers-paradise.org:6969/announce",
].map(t => `&tr=${encodeURIComponent(t)}`).join("");

function buildMagnet(hash, name) {
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name || "")}${TRACKERS}`;
}

function hashFromMagnet(magnet) {
  const m = (magnet || "").match(/xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
  return m ? m[1] : null;
}

function makeStream({ source, title, quality, seeders, leechers, infoHash, magnet, size, codec, audio }) {
  const q = quality || "Unknown";
  const s = seeders || 0;
  const l = leechers || 0;

  const lines = [];
  if (title) lines.push(`📄 ${title.length > 60 ? title.slice(0, 57) + "…" : title}`);
  const tech = [q, codec, audio].filter(Boolean).join(" · ");
  lines.push(`🎬 ${tech}`);
  if (size) lines.push(`💾 ${size}`);
  lines.push(l > 0 ? `🌱 ${s} seeds  👥 ${l} peers` : `🌱 ${s} seeds`);

  const description = lines.join("\n");

  const obj = {
    name:        `${source} • ${q}`,
    description,
    title: description,
    _quality: q,
    _seeders: s,
    behaviorHints: { bingeGroup: `stream|${q}` },
  };

  if (infoHash) {
    obj.infoHash = infoHash.toLowerCase();
    obj.magnet   = magnet || buildMagnet(infoHash, title || "");
  } else if (magnet) {
    obj.magnet = magnet;
  }
  return obj;
}

async function tryMirrors(mirrors, fn) {
  for (const mirror of mirrors) {
    try {
      const result = await fn(mirror);
      if (result && result.length > 0) return result;
    } catch (e) {
      console.warn(`  ↳ ${mirror} falhou: ${e.message}`);
    }
  }
  return [];
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. YTS  — API JSON oficial (melhor fonte para filmes)
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeYTS(imdbId) {
  const mirrors = [
    "https://yts.mx",
    "https://yts.lt",
    "https://yts.do",
  ];
  return tryMirrors(mirrors, async (base) => {
    const { data } = await httpJson.get(
      `${base}/api/v2/list_movies.json?query_term=${imdbId}&limit=10`
    );
    if (!data?.data?.movies?.length) return [];
    const streams = [];
    for (const movie of data.data.movies) {
      for (const t of (movie.torrents || [])) {
        streams.push(makeStream({
          source:   "YTS",
          title:    movie.title_long || movie.title,
          quality:  t.quality,
          codec:    t.video_codec || extractCodec(t.quality),
          audio:    t.audio_channels ? `${t.audio_channels}ch` : null,
          seeders:  t.seeds,
          leechers: t.peers,
          infoHash: t.hash,
          size:     t.size,
        }));
      }
    }
    console.log(`[YTS] ${streams.length}`);
    return streams;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. EZTV — API JSON oficial (séries)
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeEZTV(imdbId, season, episode) {
  const num = imdbId.replace("tt", "");
  const mirrors = [
    `https://eztv.re/api/get-torrents?imdb_id=${num}&limit=30`,
    `https://eztv.tf/api/get-torrents?imdb_id=${num}&limit=30`,
    `https://eztv.wf/api/get-torrents?imdb_id=${num}&limit=30`,
  ];
  for (const url of mirrors) {
    try {
      const { data } = await httpJson.get(url);
      if (!data?.torrents?.length) continue;
      let list = data.torrents;
      if (season !== null && episode !== null) {
        list = list.filter(t => {
          const m = (t.title || "").match(/S(\d+)E(\d+)/i);
          return m && parseInt(m[1]) === season && parseInt(m[2]) === episode;
        });
      }
      const streams = list.slice(0, 20).map(t => makeStream({
        source:   "EZTV",
        title:    t.title,
        quality:  extractQuality(t.title),
        codec:    extractCodec(t.title),
        audio:    extractAudio(t.title),
        seeders:  t.seeds,
        leechers: t.peers,
        infoHash: t.hash,
        size: t.size_bytes ? `${(t.size_bytes / 1e9).toFixed(2)} GB` : null,
      }));
      console.log(`[EZTV] ${streams.length}`);
      return streams;
    } catch (e) {
      console.warn(`[EZTV] ${url}: ${e.message}`);
    }
  }
  return [];
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. The Pirate Bay — via apibay.org (API JSON pública)
// ══════════════════════════════════════════════════════════════════════════════
async function scrapePirateBay(query) {
  const mirrors = [
    "https://apibay.org",
    "https://apibay.co",
  ];
  return tryMirrors(mirrors, async (base) => {
    const { data } = await httpJson.get(
      `${base}/q.php?q=${encodeURIComponent(query)}&cat=200`
    );
    if (!Array.isArray(data) || !data.length || data[0]?.name === "No results returned") return [];
    const streams = data.slice(0, 15).map(t => makeStream({
      source:   "TPB",
      title:    t.name,
      quality:  extractQuality(t.name),
      codec:    extractCodec(t.name),
      audio:    extractAudio(t.name),
      seeders:  parseNum(t.seeders),
      leechers: parseNum(t.leechers),
      infoHash: t.info_hash,
      size: t.size ? `${(parseInt(t.size) / 1e9).toFixed(2)} GB` : null,
    }));
    console.log(`[TPB] ${streams.length}`);
    return streams;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. Knaben API — agregador JSON público, excelente de servidor
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeKnaben(query) {
  try {
    const url = `https://api.knaben.eu/v1`;
    const { data } = await httpJson.post(url, {
      search_type: "torrent",
      search_field: "title",
      query,
      size: 20,
      from: 0,
      orderBy: "seeders",
      orderDirection: "desc",
    });
    if (!data?.hits?.length) return [];
    const streams = data.hits.slice(0, 15).map(t => {
      const hash = t.hash || hashFromMagnet(t.magnet);
      return makeStream({
        source:   "Knaben",
        title:    t.title,
        quality:  extractQuality(t.title),
        codec:    extractCodec(t.title),
        audio:    extractAudio(t.title),
        seeders:  t.seeders || 0,
        leechers: t.leechers || 0,
        infoHash: hash,
        magnet:   t.magnet || null,
        size: t.bytes ? `${(t.bytes / 1e9).toFixed(2)} GB` : null,
      });
    }).filter(s => s.infoHash || s.magnet);
    console.log(`[Knaben] ${streams.length}`);
    return streams;
  } catch (e) {
    console.warn(`[Knaben] ${e.message}`);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. Torrents.csv — API REST pública, sem bloqueio
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeTorrentsCsv(query) {
  const mirrors = [
    "https://torrents-csv.com",
    "https://torrents-csv.ml",
  ];
  return tryMirrors(mirrors, async (base) => {
    const { data } = await httpJson.get(
      `${base}/service/search?q=${encodeURIComponent(query)}&size=15&type=torrent`
    );
    const list = data?.torrents || data?.results || (Array.isArray(data) ? data : []);
    if (!list.length) return [];
    const streams = list.slice(0, 15).map(t => makeStream({
      source:   "TorrCSV",
      title:    t.name,
      quality:  extractQuality(t.name),
      codec:    extractCodec(t.name),
      audio:    extractAudio(t.name),
      seeders:  t.seeders || 0,
      leechers: t.leechers || 0,
      infoHash: t.infohash || t.hash,
      size: t.size_bytes ? `${(t.size_bytes / 1e9).toFixed(2)} GB` : null,
    })).filter(s => s.infoHash);
    console.log(`[TorrCSV] ${streams.length}`);
    return streams;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. Bitsearch.to — API JSON pública
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeBitsearch(query) {
  try {
    const { data } = await httpJson.get(
      `https://bitsearch.to/api/v1/search?q=${encodeURIComponent(query)}&category=1&sort=seeders`
    );
    const list = data?.results || data?.data || [];
    if (!list.length) return [];
    const streams = list.slice(0, 15).map(t => {
      const hash = t.infoHash || t.hash || hashFromMagnet(t.magnet);
      return makeStream({
        source:   "Bitsearch",
        title:    t.name || t.title,
        quality:  extractQuality(t.name || t.title),
        codec:    extractCodec(t.name || t.title),
        audio:    extractAudio(t.name || t.title),
        seeders:  t.stats?.seeders || t.seeders || 0,
        leechers: t.stats?.leechers || t.leechers || 0,
        infoHash: hash,
        size: t.stats?.size || t.size || null,
      });
    }).filter(s => s.infoHash);
    console.log(`[Bitsearch] ${streams.length}`);
    return streams;
  } catch (e) {
    console.warn(`[Bitsearch] ${e.message}`);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. Solidtorrents — API JSON
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeSolidtorrents(query) {
  const mirrors = [
    "https://solidtorrents.to",
    "https://solidtorrents.eu",
    "https://solidtorrents.net",
  ];
  return tryMirrors(mirrors, async (base) => {
    const { data } = await httpJson.get(
      `${base}/api/v1/search?q=${encodeURIComponent(query)}&category=video&sort=seeders`
    );
    const list = data?.results || [];
    if (!list.length) return [];
    const streams = list.slice(0, 15).map(t => makeStream({
      source:   "Solid",
      title:    t.title,
      quality:  extractQuality(t.title),
      codec:    extractCodec(t.title),
      audio:    extractAudio(t.title),
      seeders:  t.swarm?.seeders || 0,
      leechers: t.swarm?.leechers || 0,
      infoHash: t.infohash,
      size: t.size || null,
    })).filter(s => s.infoHash);
    console.log(`[Solid] ${streams.length}`);
    return streams;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 8. TorrentGalaxy — HTML scraping com headers reais
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeTorrentGalaxy(query) {
  const mirrors = [
    "https://torrentgalaxy.one",
    "https://torrentgalaxy.to",
    "https://tgx.rs",
    "https://torrentgalaxy.hair",
    "https://torrentgalaxy-official.com",
  ];
  return tryMirrors(mirrors, async (base) => {
    const { data } = await http.get(
      `${base}/torrents.php?search=${encodeURIComponent(query)}&cat=0&sort=seeders&order=desc`,
      { headers: { "Referer": base + "/", "X-Requested-With": "XMLHttpRequest" } }
    );
    const $ = cheerio.load(data);
    const streams = [];
    $(".tgxtablerow, tr.tgxtablerow").each((_, row) => {
      const nameEl = $(row).find("a.txlight").first();
      const name   = nameEl.text().trim();
      if (!name) return;
      const magnet = $(row).find('a[href^="magnet:"]').attr("href");
      if (!magnet) return;
      const seeders = parseNum($(row).find("span.seedsnum").text());
      const size    = $(row).find("span.badge-secondary").first().text().trim();
      streams.push(makeStream({
        source: "TGX", title: name,
        quality: extractQuality(name), codec: extractCodec(name), audio: extractAudio(name),
        seeders, infoHash: hashFromMagnet(magnet), magnet, size,
      }));
    });
    console.log(`[TGX] ${streams.length} em ${base}`);
    return streams;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 9. 1337x — HTML scraping
// ══════════════════════════════════════════════════════════════════════════════
async function scrape1337x(query) {
  const mirrors = [
    "https://1337x.to",
    "https://1337x.st",
    "https://1337x.gd",
    "https://x1337x.ws",
  ];
  return tryMirrors(mirrors, async (base) => {
    const { data } = await http.get(
      `${base}/search/${encodeURIComponent(query)}/1/`,
      { headers: { "Referer": base + "/" } }
    );
    const $ = cheerio.load(data);
    const rows = $("table.table-list tbody tr").toArray();
    if (!rows.length) return [];

    const items = rows.slice(0, 8).map(row => ({
      href:    base + ($(row).find("td.name a").eq(1).attr("href") || ""),
      name:    $(row).find("td.name a").eq(1).text().trim(),
      seeders: parseNum($(row).find("td.seeds").text()),
      size:    $(row).find("td.size").text().trim().split("\n")[0],
    })).filter(i => i.href !== base && i.name);

    const streams = (await Promise.all(items.map(async item => {
      try {
        const { data: d } = await http.get(item.href, { headers: { "Referer": base + "/" } });
        const $d  = cheerio.load(d);
        const mag = $d('a[href^="magnet:"]').attr("href");
        if (!mag) return null;
        return makeStream({
          source: "1337x", title: item.name,
          quality: extractQuality(item.name), codec: extractCodec(item.name), audio: extractAudio(item.name),
          seeders: item.seeders, infoHash: hashFromMagnet(mag), magnet: mag, size: item.size,
        });
      } catch { return null; }
    }))).filter(Boolean);

    console.log(`[1337x] ${streams.length}`);
    return streams;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 10. LimeTorrents — HTML
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeLimeTorrents(query) {
  const mirrors = [
    "https://www.limetorrents.lol",
    "https://limetorrents.info",
    "https://limetor.com",
    "https://limetorrents.fun",
  ];
  return tryMirrors(mirrors, async (base) => {
    const { data } = await http.get(
      `${base}/search/all/${encodeURIComponent(query)}/seeds/1/`
    );
    const $ = cheerio.load(data);
    const streams = [];
    $("table.table2 tbody tr").slice(0, 10).each((_, row) => {
      const name   = $(row).find("td a").eq(1).text().trim() || $(row).find("td a").first().text().trim();
      const magnet = $(row).find('a[href^="magnet:"]').attr("href");
      if (!name || !magnet) return;
      const seeders = parseNum($(row).find("td.tdseed").text());
      const size    = $(row).find("td:nth-child(3)").text().trim();
      streams.push(makeStream({
        source: "Lime", title: name,
        quality: extractQuality(name), codec: extractCodec(name), audio: extractAudio(name),
        seeders, infoHash: hashFromMagnet(magnet), magnet, size,
      }));
    });
    console.log(`[Lime] ${streams.length}`);
    return streams;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 11. Nyaa.si — HTML (anime)
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeNyaa(query) {
  try {
    const { data } = await http.get(
      `https://nyaa.si/?f=0&c=0_0&q=${encodeURIComponent(query)}&s=seeders&o=desc`
    );
    const $ = cheerio.load(data);
    const streams = [];
    $("table tbody tr").slice(0, 10).each((_, row) => {
      const name   = $(row).find("td:nth-child(2) a").last().text().trim();
      const magnet = $(row).find('a[href^="magnet:"]').attr("href");
      if (!name || !magnet) return;
      streams.push(makeStream({
        source: "Nyaa", title: name,
        quality: extractQuality(name), codec: extractCodec(name), audio: extractAudio(name),
        seeders: parseNum($(row).find("td:nth-child(6)").text()),
        infoHash: hashFromMagnet(magnet), magnet,
        size: $(row).find("td:nth-child(4)").text().trim(),
      }));
    });
    console.log(`[Nyaa] ${streams.length}`);
    return streams;
  } catch (e) { console.warn(`[Nyaa] ${e.message}`); return []; }
}

// ══════════════════════════════════════════════════════════════════════════════
// 12. Snowfl — JSON API agregadora
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeSnowfl(query) {
  try {
    const { data } = await httpJson.get(
      `https://snowfl.com/b.json?q=${encodeURIComponent(query)}&p=0&s=SEED&t=VIDEO&hideXXX=1`
    );
    const list = Array.isArray(data) ? data : (data?.results || []);
    if (!list.length) return [];
    const streams = list.slice(0, 15).map(t => {
      const hash = t.hash || t.infohash;
      return makeStream({
        source:   "Snowfl",
        title:    t.title || t.name,
        quality:  extractQuality(t.title || t.name),
        codec:    extractCodec(t.title || t.name),
        audio:    extractAudio(t.title || t.name),
        seeders:  t.seeder || t.seeders || 0,
        leechers: t.leech  || t.leechers || 0,
        infoHash: hash,
        magnet:   hash ? buildMagnet(hash, t.title) : null,
        size:     t.size || null,
      });
    }).filter(s => s.infoHash);
    console.log(`[Snowfl] ${streams.length}`);
    return streams;
  } catch (e) { console.warn(`[Snowfl] ${e.message}`); return []; }
}

// ══════════════════════════════════════════════════════════════════════════════
// 13. RuTracker — HTML
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeRuTracker(query) {
  try {
    const { data } = await http.get(
      `https://rutracker.org/forum/tracker.php?nm=${encodeURIComponent(query)}`,
      { headers: { "Cookie": "bb_dl=1; bb_ssl=1; bb_session=0" } }
    );
    const $ = cheerio.load(data);
    const items = [];
    $("table#search-results tbody tr").slice(0, 6).each((_, row) => {
      const a    = $(row).find("td.t-title a.tLink");
      const href = a.attr("href");
      if (!href) return;
      items.push({
        href:    href.startsWith("http") ? href : `https://rutracker.org/forum/${href}`,
        name:    a.text().trim(),
        seeders: parseNum($(row).find("td.seedmed b").text()),
        size:    $(row).find("td.tor-size").text().trim(),
      });
    });
    const streams = (await Promise.all(items.slice(0, 4).map(async item => {
      try {
        const { data: d } = await http.get(item.href);
        const mag = cheerio.load(d)('a.magnet-link[href^="magnet:"]').attr("href");
        if (!mag) return null;
        return makeStream({
          source: "RuTrk", title: item.name,
          quality: extractQuality(item.name), codec: extractCodec(item.name), audio: extractAudio(item.name),
          seeders: item.seeders, infoHash: hashFromMagnet(mag), magnet: mag, size: item.size,
        });
      } catch { return null; }
    }))).filter(Boolean);
    console.log(`[RuTrk] ${streams.length}`);
    return streams;
  } catch (e) { console.warn(`[RuTrk] ${e.message}`); return []; }
}


// ══════════════════════════════════════════════════════════════════════════════
// 14. EXT.to — novo indexador JSON, substituto do TorrentGalaxy
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeEXT(query) {
  try {
    const { data } = await httpJson.get(
      `https://ext.to/api/v1/search?q=${encodeURIComponent(query)}&sort=seeders&order=desc`
    );
    const list = data?.results || data?.torrents || (Array.isArray(data) ? data : []);
    if (!list.length) return [];
    const streams = list.slice(0, 15).map(t => {
      const hash = t.hash || t.infohash || t.info_hash || hashFromMagnet(t.magnet);
      return makeStream({
        source:   "EXT",
        title:    t.name || t.title,
        quality:  extractQuality(t.name || t.title),
        codec:    extractCodec(t.name || t.title),
        audio:    extractAudio(t.name || t.title),
        seeders:  t.seeders || t.seeds || 0,
        leechers: t.leechers || t.peers || 0,
        infoHash: hash,
        magnet:   t.magnet || (hash ? buildMagnet(hash, t.name) : null),
        size:     t.size || null,
      });
    }).filter(s => s.infoHash || s.magnet);
    console.log(`[EXT] ${streams.length}`);
    return streams;
  } catch (e) { console.warn(`[EXT] ${e.message}`); return []; }
}

// ══════════════════════════════════════════════════════════════════════════════
// 15. RARGB (rargb.to) — clone pós-shutdown do RARBG original
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeRARGB(query) {
  const mirrors = [
    "https://rargb.to",
    "https://www.rargb.to",
    "https://rarbg.to",
  ];
  return tryMirrors(mirrors, async (base) => {
    const { data } = await http.get(
      `${base}/search/?search=${encodeURIComponent(query)}&order=seeders&by=DESC`,
      { headers: { "Referer": base + "/" } }
    );
    const $ = cheerio.load(data);
    const streams = [];
    $("tr.lista2").slice(0, 12).each((_, row) => {
      const nameEl = $(row).find("td:nth-child(2) a");
      const name   = nameEl.text().trim();
      const magnet = $(row).find('a[href^="magnet:"]').attr("href");
      if (!name || !magnet) return;
      const seeders = parseNum($(row).find("td:nth-child(6)").text());
      const size    = $(row).find("td:nth-child(4)").text().trim();
      streams.push(makeStream({
        source: "RARGB", title: name,
        quality: extractQuality(name), codec: extractCodec(name), audio: extractAudio(name),
        seeders, infoHash: hashFromMagnet(magnet), magnet, size,
      }));
    });
    console.log(`[RARGB] ${streams.length}`);
    return streams;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 16. Torlock — torrents verificados, sem fakes
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeTorlock(query) {
  const mirrors = [
    "https://www.torlock.com",
    "https://torlock2.com",
  ];
  return tryMirrors(mirrors, async (base) => {
    const { data } = await http.get(
      `${base}/all/torrents/${encodeURIComponent(query)}.html?sort=seeds`
    );
    const $ = cheerio.load(data);
    const items = [];
    $("table.table tbody tr").slice(0, 8).each((_, row) => {
      const a    = $(row).find("td a.n").first();
      const href = a.attr("href");
      if (!href) return;
      items.push({
        href:    `${base}${href}`,
        name:    a.text().trim(),
        seeders: parseNum($(row).find("td.tds").text()),
        size:    $(row).find("td.tds1").text().trim(),
      });
    });
    const streams = (await Promise.all(items.slice(0, 5).map(async item => {
      try {
        const { data: d } = await http.get(item.href, { headers: { "Referer": base + "/" } });
        const mag = cheerio.load(d)('a[href^="magnet:"]').attr("href");
        if (!mag) return null;
        return makeStream({
          source: "Torlock", title: item.name,
          quality: extractQuality(item.name), codec: extractCodec(item.name), audio: extractAudio(item.name),
          seeders: item.seeders, infoHash: hashFromMagnet(mag), magnet: mag, size: item.size,
        });
      } catch { return null; }
    }))).filter(Boolean);
    console.log(`[Torlock] ${streams.length}`);
    return streams;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 17. SpeedTorrent — site brasileiro de torrents
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeSpeedTorrent(query) {
  const mirrors = [
    "https://www.speedtorrent.app",
    "https://speedtorrent.net",
  ];
  return tryMirrors(mirrors, async (base) => {
    const { data } = await http.get(
      `${base}/busca/${encodeURIComponent(query)}`
    );
    const $ = cheerio.load(data);
    const streams = [];
    $(".torrent-item, .result-item, tr.torrent").slice(0, 10).each((_, el) => {
      const magnet = $(el).find('a[href^="magnet:"]').attr("href");
      const name   = $(el).find(".torrent-name, .name, td a").first().text().trim();
      if (!magnet || !name) return;
      const seeders = parseNum($(el).find(".seeds, .seeders").text());
      const size    = $(el).find(".size").text().trim();
      streams.push(makeStream({
        source: "SpeedTR", title: name,
        quality: extractQuality(name), codec: extractCodec(name), audio: extractAudio(name),
        seeders, infoHash: hashFromMagnet(magnet), magnet, size,
      }));
    });
    console.log(`[SpeedTR] ${streams.length}`);
    return streams;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 18. TorrentDownloads — grande acervo geral
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeTorrentDownloads(query) {
  try {
    const { data } = await http.get(
      `https://www.torrentdownloads.pro/search/?search=${encodeURIComponent(query)}`
    );
    const $ = cheerio.load(data);
    const links = [];
    $(".tor_row .tor_title a, .torrents_table a.title").slice(0, 8).each((_, el) => {
      const href = $(el).attr("href");
      if (href) links.push({ href: "https://www.torrentdownloads.pro" + href, name: $(el).text().trim() });
    });
    const streams = (await Promise.all(links.map(async item => {
      try {
        const { data: d } = await http.get(item.href);
        const $d   = cheerio.load(d);
        const mag  = $d('a[href^="magnet:"]').attr("href");
        if (!mag) return null;
        return makeStream({
          source: "TDL", title: item.name,
          quality: extractQuality(item.name), codec: extractCodec(item.name), audio: extractAudio(item.name),
          seeders: parseNum($d(".seeds, .tseed").first().text()),
          infoHash: hashFromMagnet(mag), magnet: mag,
          size: $d(".cate_size, .tsize").first().text().trim(),
        });
      } catch { return null; }
    }))).filter(Boolean);
    console.log(`[TDL] ${streams.length}`);
    return streams;
  } catch (e) { console.warn(`[TDL] ${e.message}`); return []; }
}

// ══════════════════════════════════════════════════════════════════════════════
// 19. Kickass Torrents — clássico
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeKickass(query) {
  const mirrors = [
    "https://kickasstorrents.to",
    "https://katcr.to",
    "https://kickass.cm",
  ];
  return tryMirrors(mirrors, async (base) => {
    const { data } = await http.get(`${base}/usearch/${encodeURIComponent(query)}/`);
    const $ = cheerio.load(data);
    const streams = [];
    $("tr.odd, tr.even").slice(0, 10).each((_, row) => {
      const magnet  = $(row).find('a[href^="magnet:"]').attr("href");
      if (!magnet) return;
      const name    = $(row).find("a.cellMainLink").text().trim();
      const seeders = parseNum($(row).find("td.green").first().text());
      const size    = $(row).find("td.nobr").first().text().trim();
      streams.push(makeStream({
        source: "KAT", title: name,
        quality: extractQuality(name), codec: extractCodec(name), audio: extractAudio(name),
        seeders, leechers: parseNum($(row).find("td.red").first().text()),
        infoHash: hashFromMagnet(magnet), magnet, size,
      }));
    });
    console.log(`[KAT] ${streams.length}`);
    return streams;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 20. Zooqle — bom acervo de filmes/séries
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeZooqle(query) {
  try {
    const { data } = await http.get(
      `https://zooqle.com/search?q=${encodeURIComponent(query)}&s=ns&v=t&sd=d&fmt=rss`
    );
    const $ = cheerio.load(data, { xmlMode: true });
    const streams = [];
    $("item").slice(0, 12).each((_, el) => {
      const name   = $(el).find("title").text().trim();
      const magnet = $(el).find("torrent\:magnetURI, magnetURI").text().trim()
                  || $(el).find("link").text().trim();
      if (!name) return;
      const seeders = parseNum($(el).find("torrent\:seeds, seeds").text());
      const size    = $(el).find("torrent\:contentLength, contentLength").text().trim();
      const sizeGB  = size ? `${(parseInt(size) / 1e9).toFixed(2)} GB` : null;
      if (!magnet || !magnet.startsWith("magnet:")) return;
      streams.push(makeStream({
        source: "Zooqle", title: name,
        quality: extractQuality(name), codec: extractCodec(name), audio: extractAudio(name),
        seeders, infoHash: hashFromMagnet(magnet), magnet, size: sizeGB,
      }));
    });
    console.log(`[Zooqle] ${streams.length}`);
    return streams;
  } catch (e) { console.warn(`[Zooqle] ${e.message}`); return []; }
}

// ══════════════════════════════════════════════════════════════════════════════
// MASTER
// ══════════════════════════════════════════════════════════════════════════════
async function resolveTitle(imdbId) {
  const keys   = ["b7c56d5e", "f1b47d65", "a77b3ead"];
  const mirrors = [
    `https://v3-cinemeta.strem.io/meta/movie/${imdbId}.json`,
    `https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`,
  ];

  // Try Cinemeta first (Stremio's own metadata — very reliable from servers)
  for (const url of mirrors) {
    try {
      const { data } = await httpJson.get(url);
      if (data?.meta?.name) {
        return { title: data.meta.name, year: data.meta.year ? String(data.meta.year) : "" };
      }
    } catch { continue; }
  }

  // Fallback: OMDB
  for (const key of keys) {
    try {
      const { data } = await httpJson.get(`https://www.omdbapi.com/?i=${imdbId}&apikey=${key}`);
      if (data?.Title) return { title: data.Title, year: data.Year?.split("–")[0] || "" };
    } catch { continue; }
  }

  return { title: imdbId, year: "" };
}

async function scrapeAll(imdbId, isSeries, season, episode) {
  const { title, year } = await resolveTitle(imdbId);

  const query = isSeries
    ? `${title} S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`
    : `${title} ${year}`.trim();

  console.log(`\n[Anzol] "${query}" | ${imdbId}`);

  const tasks = [
    // ── APIs JSON (mais confiáveis de servidor) ───────────────────────
    isSeries ? scrapeEZTV(imdbId, season, episode) : scrapeYTS(imdbId),
    scrapePirateBay(query),
    scrapeKnaben(query),
    scrapeTorrentsCsv(query),
    scrapeBitsearch(query),
    scrapeSolidtorrents(query),
    scrapeSnowfl(query),
    scrapeEXT(query),
    // ── HTML scrapers ─────────────────────────────────────────────────
    scrapeTorrentGalaxy(query),
    scrape1337x(query),
    scrapeLimeTorrents(query),
    scrapeNyaa(query),
    scrapeRuTracker(query),
    scrapeRARGB(query),
    scrapeTorlock(query),
    scrapeSpeedTorrent(query),
    scrapeTorrentDownloads(query),
    scrapeKickass(query),
    scrapeZooqle(query),
  ];

  const results = await Promise.allSettled(tasks);
  return results.flatMap(r => r.status === "fulfilled" ? r.value : []);
}

module.exports = { scrapeAll };
