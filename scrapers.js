/**
 * Phantom — scrapers.js
 * Estratégia: APIs JSON confiáveis primeiro, HTML scrapers como bônus.
 * Todas as fontes rodam em paralelo via Promise.allSettled.
 */

const axios   = require("axios");
const cheerio = require("cheerio");

const http = axios.create({
  timeout: 15000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/html, */*",
    "Accept-Language": "en-US,en;q=0.9",
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function quality(s) {
  if (!s) return "Unknown";
  if (/2160p|4K|UHD/i.test(s))  return "2160p";
  if (/1080p|FHD/i.test(s))     return "1080p";
  if (/720p/i.test(s))          return "720p";
  if (/480p/i.test(s))          return "480p";
  if (/360p/i.test(s))          return "360p";
  return "Unknown";
}

function codec(s) {
  if (!s) return null;
  if (/HEVC|x265|H\.265/i.test(s)) return "x265";
  if (/x264|H\.264|AVC/i.test(s))  return "x264";
  if (/AV1/i.test(s))              return "AV1";
  return null;
}

function audio(s) {
  if (!s) return null;
  if (/DTS-HD/i.test(s))           return "DTS-HD";
  if (/TrueHD|Atmos/i.test(s))     return "TrueHD";
  if (/DD\+|EAC3/i.test(s))        return "DD+";
  if (/DTS/i.test(s))              return "DTS";
  if (/DD|AC3|Dolby/i.test(s))     return "DD";
  if (/AAC/i.test(s))              return "AAC";
  return null;
}

function num(s) {
  const n = parseInt(String(s || "").replace(/\D/g, ""), 10);
  return isNaN(n) ? 0 : n;
}

function hashFromMagnet(m) {
  const r = (m || "").match(/xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
  return r ? r[1].toLowerCase() : null;
}

function validHash(h) {
  if (!h) return null;
  h = String(h).replace(/^.*btih:/i, "").trim().toLowerCase();
  if (/^[a-f0-9]{40}$/.test(h))  return h;
  if (/^[a-f0-9]{32}$/.test(h))  return h;
  if (/^[a-z2-7]{32}$/.test(h))  return h;
  return null;
}

const TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.tracker.cl:1337/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://open.stealth.si:80/announce",
].map(t => `&tr=${encodeURIComponent(t)}`).join("");

function magnet(hash, name) {
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name || "")}${TRACKERS}`;
}

function stream(source, title, q, seeds, hash, mag, size, leechers) {
  const h = validHash(hash) || validHash(hashFromMagnet(mag));
  if (!h) return null; // Stremio needs a valid hash

  const q2   = q || quality(title);
  const s    = seeds    || 0;
  const l    = leechers || 0;
  const c    = codec(title);
  const a    = audio(title);
  const name = `${source} • ${q2}`;

  const lines = [];
  if (title) lines.push(`📄 ${title.length > 55 ? title.slice(0,52)+"…" : title}`);
  lines.push(`🎬 ${[q2, c, a].filter(Boolean).join(" · ")}`);
  if (size)  lines.push(`💾 ${size}`);
  lines.push(l > 0 ? `🌱 ${s} seeds  👥 ${l} peers` : `🌱 ${s} seeds`);

  const desc = lines.join("\n");
  return {
    name, description: desc, title: desc,
    infoHash: h,
    magnet: mag || magnet(h, title),
    _q: q2, _s: s,
    behaviorHints: { bingeGroup: `phantom|${q2}` },
  };
}

async function mirrors(urls, fn) {
  for (const url of urls) {
    try {
      const r = await fn(url);
      if (r && r.length) return r;
    } catch(e) { console.warn(`  ↳ ${url}: ${e.message}`); }
  }
  return [];
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. YTS — API JSON, melhor para filmes
// ══════════════════════════════════════════════════════════════════════════════
async function yts(imdbId) {
  return mirrors([
    "https://yts.mx",
    "https://yts.lt",
    "https://yts.do",
  ], async base => {
    const { data } = await http.get(`${base}/api/v2/list_movies.json?query_term=${imdbId}&limit=10`);
    if (!data?.data?.movies?.length) return [];
    const out = [];
    for (const m of data.data.movies) {
      for (const t of (m.torrents || [])) {
        const s = stream("YTS", m.title_long || m.title, t.quality, t.seeds, t.hash, null, t.size, t.peers);
        if (s) out.push(s);
      }
    }
    console.log(`[YTS] ${out.length}`);
    return out;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. EZTV — API JSON, melhor para séries
// ══════════════════════════════════════════════════════════════════════════════
async function eztv(imdbId, season, episode) {
  const id = imdbId.replace("tt","");
  return mirrors([
    `https://eztv.re/api/get-torrents?imdb_id=${id}&limit=30`,
    `https://eztv.tf/api/get-torrents?imdb_id=${id}&limit=30`,
    `https://eztv.wf/api/get-torrents?imdb_id=${id}&limit=30`,
  ], async url => {
    const { data } = await http.get(url);
    if (!data?.torrents?.length) return [];
    let list = data.torrents;
    if (season != null && episode != null) {
      list = list.filter(t => {
        const m = (t.title||"").match(/S(\d+)E(\d+)/i);
        return m && +m[1]===season && +m[2]===episode;
      });
    }
    const out = list.slice(0,20).map(t => {
      const size = t.size_bytes ? `${(t.size_bytes/1e9).toFixed(2)} GB` : null;
      return stream("EZTV", t.title, quality(t.title), t.seeds, t.hash, null, size, t.peers);
    }).filter(Boolean);
    console.log(`[EZTV] ${out.length}`);
    return out;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. The Pirate Bay — apibay JSON
// ══════════════════════════════════════════════════════════════════════════════
async function tpb(query) {
  return mirrors([
    "https://apibay.org",
    "https://apibay.co",
  ], async base => {
    const { data } = await http.get(`${base}/q.php?q=${encodeURIComponent(query)}&cat=200`);
    if (!Array.isArray(data) || data[0]?.name === "No results returned") return [];
    const out = data.slice(0,15).map(t => {
      const size = t.size ? `${(+t.size/1e9).toFixed(2)} GB` : null;
      return stream("TPB", t.name, quality(t.name), num(t.seeders), t.info_hash, null, size, num(t.leechers));
    }).filter(Boolean);
    console.log(`[TPB] ${out.length}`);
    return out;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. Knaben — agregador POST JSON
// ══════════════════════════════════════════════════════════════════════════════
async function knaben(query) {
  try {
    const { data } = await http.post("https://api.knaben.eu/v1", {
      search_type: "torrent", search_field: "title",
      query, size: 20, from: 0, orderBy: "seeders", orderDirection: "desc",
    });
    if (!data?.hits?.length) return [];
    const out = data.hits.slice(0,15).map(t => {
      const h = validHash(t.hash) || validHash(hashFromMagnet(t.magnet));
      const size = t.bytes ? `${(t.bytes/1e9).toFixed(2)} GB` : null;
      return stream("Knaben", t.title, quality(t.title), t.seeders||0, h, t.magnet||null, size, t.leechers||0);
    }).filter(Boolean);
    console.log(`[Knaben] ${out.length}`);
    return out;
  } catch(e) { console.warn(`[Knaben] ${e.message}`); return []; }
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. Torrents.csv — API REST pública
// ══════════════════════════════════════════════════════════════════════════════
async function torrentsCsv(query) {
  return mirrors([
    "https://torrents-csv.com",
    "https://torrents-csv.ml",
  ], async base => {
    const { data } = await http.get(`${base}/service/search?q=${encodeURIComponent(query)}&size=15&type=torrent`);
    const list = data?.torrents || (Array.isArray(data) ? data : []);
    if (!list.length) return [];
    const out = list.slice(0,15).map(t => {
      const size = t.size_bytes ? `${(t.size_bytes/1e9).toFixed(2)} GB` : null;
      return stream("TorrCSV", t.name, quality(t.name), t.seeders||0, t.infohash||t.hash, null, size, t.leechers||0);
    }).filter(Boolean);
    console.log(`[TorrCSV] ${out.length}`);
    return out;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. Bitsearch — API JSON
// ══════════════════════════════════════════════════════════════════════════════
async function bitsearch(query) {
  try {
    const { data } = await http.get(`https://bitsearch.to/api/v1/search?q=${encodeURIComponent(query)}&category=1&sort=seeders`);
    const list = data?.results || data?.data || [];
    if (!list.length) return [];
    const out = list.slice(0,15).map(t => {
      const name = t.name || t.title || "";
      const h = validHash(t.infoHash || t.hash) || validHash(hashFromMagnet(t.magnet));
      return stream("Bitsearch", name, quality(name), t.stats?.seeders||t.seeders||0, h, t.magnet||null, t.stats?.size||t.size||null, t.stats?.leechers||t.leechers||0);
    }).filter(Boolean);
    console.log(`[Bitsearch] ${out.length}`);
    return out;
  } catch(e) { console.warn(`[Bitsearch] ${e.message}`); return []; }
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. Solidtorrents — API JSON
// ══════════════════════════════════════════════════════════════════════════════
async function solid(query) {
  return mirrors([
    "https://solidtorrents.to",
    "https://solidtorrents.eu",
    "https://solidtorrents.net",
  ], async base => {
    const { data } = await http.get(`${base}/api/v1/search?q=${encodeURIComponent(query)}&category=video&sort=seeders`);
    if (!data?.results?.length) return [];
    const out = data.results.slice(0,15).map(t => {
      return stream("Solid", t.title, quality(t.title), t.swarm?.seeders||0, t.infohash, null, t.size||null, t.swarm?.leechers||0);
    }).filter(Boolean);
    console.log(`[Solid] ${out.length}`);
    return out;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 8. 1337x — HTML scraping
// ══════════════════════════════════════════════════════════════════════════════
async function x1337(query) {
  return mirrors(["https://1337x.to","https://1337x.st","https://x1337x.ws"], async base => {
    const { data } = await http.get(`${base}/search/${encodeURIComponent(query)}/1/`);
    const $ = cheerio.load(data);
    const rows = $("table.table-list tbody tr").toArray();
    if (!rows.length) return [];

    const items = rows.slice(0,8).map(r => ({
      href:  base + ($(r).find("td.name a").eq(1).attr("href")||""),
      name:  $(r).find("td.name a").eq(1).text().trim(),
      seeds: num($(r).find("td.seeds").text()),
      size:  $(r).find("td.size").text().trim().split("\n")[0],
    })).filter(i => i.href !== base && i.name);

    const out = (await Promise.all(items.map(async i => {
      try {
        const { data: d } = await http.get(i.href);
        const mag = cheerio.load(d)('a[href^="magnet:"]').attr("href");
        if (!mag) return null;
        return stream("1337x", i.name, quality(i.name), i.seeds, null, mag, i.size);
      } catch { return null; }
    }))).filter(Boolean);

    console.log(`[1337x] ${out.length}`);
    return out;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 9. TorrentGalaxy — HTML scraping
// ══════════════════════════════════════════════════════════════════════════════
async function tgx(query) {
  return mirrors([
    "https://torrentgalaxy.one",
    "https://torrentgalaxy.to",
    "https://tgx.rs",
  ], async base => {
    const { data } = await http.get(`${base}/torrents.php?search=${encodeURIComponent(query)}&sort=seeders&order=desc`);
    const $ = cheerio.load(data);
    const out = [];
    $(".tgxtablerow").each((_, r) => {
      const name = $(r).find("a.txlight").first().text().trim();
      const mag  = $(r).find('a[href^="magnet:"]').attr("href");
      if (!name || !mag) return;
      const s = stream("TGX", name, quality(name), num($(r).find("span.seedsnum").text()), null, mag,
        $(r).find("span.badge-secondary").first().text().trim());
      if (s) out.push(s);
    });
    console.log(`[TGX] ${out.length}`);
    return out;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 10. LimeTorrents — HTML scraping
// ══════════════════════════════════════════════════════════════════════════════
async function lime(query) {
  return mirrors([
    "https://www.limetorrents.lol",
    "https://limetor.com",
    "https://limetorrents.info",
  ], async base => {
    const { data } = await http.get(`${base}/search/all/${encodeURIComponent(query)}/seeds/1/`);
    const $ = cheerio.load(data);
    const out = [];
    $("table.table2 tbody tr").slice(0,10).each((_, r) => {
      const name = $(r).find("td a").eq(1).text().trim() || $(r).find("td a").first().text().trim();
      const mag  = $(r).find('a[href^="magnet:"]').attr("href");
      if (!name || !mag) return;
      const s = stream("Lime", name, quality(name), num($(r).find("td.tdseed").text()), null, mag,
        $(r).find("td:nth-child(3)").text().trim());
      if (s) out.push(s);
    });
    console.log(`[Lime] ${out.length}`);
    return out;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 11. Nyaa — HTML scraping (anime)
// ══════════════════════════════════════════════════════════════════════════════
async function nyaa(query) {
  try {
    const { data } = await http.get(`https://nyaa.si/?f=0&c=0_0&q=${encodeURIComponent(query)}&s=seeders&o=desc`);
    const $ = cheerio.load(data);
    const out = [];
    $("table tbody tr").slice(0,10).each((_, r) => {
      const name = $(r).find("td:nth-child(2) a").last().text().trim();
      const mag  = $(r).find('a[href^="magnet:"]').attr("href");
      if (!name || !mag) return;
      const s = stream("Nyaa", name, quality(name), num($(r).find("td:nth-child(6)").text()), null, mag,
        $(r).find("td:nth-child(4)").text().trim());
      if (s) out.push(s);
    });
    console.log(`[Nyaa] ${out.length}`);
    return out;
  } catch(e) { console.warn(`[Nyaa] ${e.message}`); return []; }
}

// ══════════════════════════════════════════════════════════════════════════════
// RESOLVE TITLE — Cinemeta (Stremio) → OMDB fallback
// ══════════════════════════════════════════════════════════════════════════════
async function resolveTitle(imdbId, type) {
  const cineUrls = [
    `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`,
    `https://v3-cinemeta.strem.io/meta/movie/${imdbId}.json`,
    `https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`,
  ];
  for (const url of cineUrls) {
    try {
      const { data } = await http.get(url);
      if (data?.meta?.name) return { title: data.meta.name, year: String(data.meta.year||"") };
    } catch {}
  }
  for (const key of ["b7c56d5e","f1b47d65","a77b3ead"]) {
    try {
      const { data } = await http.get(`https://www.omdbapi.com/?i=${imdbId}&apikey=${key}`);
      if (data?.Title) return { title: data.Title, year: data.Year?.split("–")[0]||"" };
    } catch {}
  }
  return { title: imdbId, year: "" };
}

// ══════════════════════════════════════════════════════════════════════════════
// MASTER
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeAll(imdbId, isSeries, season, episode) {
  const type = isSeries ? "series" : "movie";
  const { title, year } = await resolveTitle(imdbId, type);

  const query = isSeries
    ? `${title} S${String(season).padStart(2,"0")}E${String(episode).padStart(2,"0")}`
    : `${title} ${year}`.trim();

  console.log(`\n[Phantom] "${query}" | ${imdbId}`);

  const tasks = isSeries
    ? [ eztv(imdbId, season, episode), tpb(query), knaben(query), torrentsCsv(query),
        bitsearch(query), x1337(query), lime(query), nyaa(query) ]
    : [ yts(imdbId), tpb(query), knaben(query), torrentsCsv(query),
        bitsearch(query), solid(query), x1337(query), tgx(query), lime(query), nyaa(query) ];

  const results = await Promise.allSettled(tasks);
  return results.flatMap(r => r.status === "fulfilled" ? r.value : []);
}

module.exports = { scrapeAll };
