/**
 * Purefy — scrapers.js
 * Inspirado no Torrentio: APIs JSON confiáveis + sources de tracker.
 */

const axios   = require("axios");
const cheerio = require("cheerio");

const TIMEOUT = 12000;

const http = axios.create({
  timeout: TIMEOUT,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/html, */*",
  },
});

// Trackers: crítico para o Stremio resolver os torrents
const TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://open.tracker.cl:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://p4p.arenabg.com:1337/announce",
  "udp://tracker.moeking.me:6969/announce",
  "udp://9.rarbg.com:2810/announce",
];

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────
function quality(s) {
  if (!s) return "";
  if (/2160p|4K|UHD/i.test(s))  return "2160p";
  if (/1080p/i.test(s))         return "1080p";
  if (/720p/i.test(s))          return "720p";
  if (/480p/i.test(s))          return "480p";
  if (/360p/i.test(s))          return "360p";
  return "";
}

function validHash(h) {
  if (!h) return null;
  h = String(h).replace(/^.*btih:/i, "").trim().toLowerCase();
  if (/^[a-f0-9]{40}$/.test(h)) return h;
  return null;
}

function hashFromMagnet(m) {
  const r = (m || "").match(/xt=urn:btih:([a-fA-F0-9]{40})/i);
  return r ? r[1].toLowerCase() : null;
}

function formatSize(bytes) {
  if (!bytes) return "";
  const gb = +bytes / 1e9;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(+bytes/1e6).toFixed(0)} MB`;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseCount(value) {
  const n = parseInt(String(value || "").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function firstText($, root, selectors) {
  for (const selector of selectors.filter(Boolean)) {
    const value = cleanText($(root).find(selector).first().text());
    if (value) return value;
  }
  return "";
}

function firstAttr($, root, selector, attr) {
  const value = $(root).find(selector).first().attr(attr);
  return value ? String(value).trim() : "";
}

function absUrl(base, href) {
  if (!href || /^magnet:/i.test(href)) return href || "";
  try { return new URL(href, base).toString(); }
  catch { return ""; }
}

function sizeFromText(value) {
  return cleanText(value).match(/\d+(?:[.,]\d+)?\s*(?:TB|GB|MB|KB|TiB|GiB|MiB|KiB)/i)?.[0] || "";
}

function pickTorrentLink($, root, config) {
  const selector = config.linkSelector || "a";
  const anchors = $(root).find(selector).toArray().map(a => {
    const href = $(a).attr("href") || "";
    const title = cleanText($(a).attr("title") || $(a).text());
    return { href, title };
  }).filter(a => {
    if (!a.href || /^magnet:/i.test(a.href) || !a.title) return false;
    if (config.matchLink) return config.matchLink(a.href, a.title);
    return /torrent|download|view|details/i.test(a.href);
  });

  anchors.sort((a, b) => b.title.length - a.title.length);
  return anchors[0] || null;
}

async function magnetFromDetail(url) {
  if (!url) return "";
  try {
    const { data } = await http.get(url);
    return cheerio.load(data)('a[href^="magnet:"]').first().attr("href") || "";
  } catch {
    return "";
  }
}

async function scrapeSearchSite(source, configs) {
  for (const config of configs) {
    try {
      const { data } = await http.get(config.url);
      const $ = cheerio.load(data);
      const rows = $(config.rowSelector).toArray();
      const items = rows.map(row => {
        const magnet = firstAttr($, row, 'a[href^="magnet:"]', "href");
        const link = pickTorrentLink($, row, config);
        const title = firstText($, row, config.titleSelectors || []) || link?.title || "";
        const detailUrl = absUrl(config.url, link?.href || "");
        const seeds = parseCount(firstText($, row, config.seedSelectors || []));
        const size = firstText($, row, config.sizeSelectors || []) || sizeFromText($(row).text());
        return { title, detailUrl, magnet, seeds, size };
      }).filter(item => item.title && (item.magnet || item.detailUrl)).slice(0, config.limit || 6);

      const out = (await Promise.all(items.map(async item => {
        const magnet = item.magnet || await magnetFromDetail(item.detailUrl);
        return buildStream(source, item.title, quality(item.title), item.seeds, hashFromMagnet(magnet), item.size);
      }))).filter(Boolean);

      console.log(`[${source}] ${out.length}`);
      return out;
    } catch (e) {
      console.warn(`[${source}] ${e.message}`);
    }
  }
  return [];
}

function buildStream(source, title, q, seeds, hash, size) {
  const h = validHash(hash);
  if (!h) return null;

  const q2    = q || quality(title) || "";
  const name  = q2 ? `Purefy ${q2}\n${source}` : `Purefy\n${source}`;
  const info  = [];
  if (title) info.push(`📄 ${title.length > 70 ? title.slice(0,67)+"…" : title}`);
  if (size)  info.push(`💾 ${size}`);
  info.push(`👥 ${seeds || 0}`);

  return {
    name,
    title:    info.join("\n"),
    infoHash: h,
    sources:  TRACKERS.map(t => `tracker:${t}`).concat([`dht:${h}`]),
    behaviorHints: {
      bingeGroup: `purefy|${q2 || "unknown"}`,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Scrapers
// ──────────────────────────────────────────────────────────────────────────

async function yts(imdbId) {
  try {
    const { data } = await http.get(`https://yts.mx/api/v2/list_movies.json?query_term=${imdbId}&limit=10`);
    if (!data?.data?.movies?.length) return [];
    const out = [];
    for (const m of data.data.movies) {
      for (const t of (m.torrents || [])) {
        const s = buildStream("YTS", m.title_long, t.quality, t.seeds, t.hash, t.size);
        if (s) out.push(s);
      }
    }
    console.log(`[YTS] ${out.length}`);
    return out;
  } catch (e) { console.warn(`[YTS] ${e.message}`); return []; }
}

async function eztv(imdbId, season, episode) {
  const id = imdbId.replace("tt","");
  const urls = [
    `https://eztv.re/api/get-torrents?imdb_id=${id}&limit=40`,
    `https://eztv.tf/api/get-torrents?imdb_id=${id}&limit=40`,
    `https://eztv.wf/api/get-torrents?imdb_id=${id}&limit=40`,
  ];
  for (const url of urls) {
    try {
      const { data } = await http.get(url);
      if (!data?.torrents?.length) continue;
      let list = data.torrents;
      if (season != null && episode != null) {
        list = list.filter(t => {
          const m = (t.title||"").match(/S(\d+)E(\d+)/i);
          return m && +m[1]===season && +m[2]===episode;
        });
      }
      const out = list.slice(0,20).map(t =>
        buildStream("EZTV", t.title, quality(t.title), t.seeds, t.hash, formatSize(t.size_bytes))
      ).filter(Boolean);
      console.log(`[EZTV] ${out.length}`);
      return out;
    } catch { continue; }
  }
  return [];
}

async function tpb(query) {
  try {
    const { data } = await http.get(`https://apibay.org/q.php?q=${encodeURIComponent(query)}&cat=200`);
    if (!Array.isArray(data) || data[0]?.name === "No results returned") return [];
    const out = data.slice(0,15).map(t =>
      buildStream("TPB", t.name, quality(t.name), +t.seeders, t.info_hash, formatSize(t.size))
    ).filter(Boolean);
    console.log(`[TPB] ${out.length}`);
    return out;
  } catch (e) { console.warn(`[TPB] ${e.message}`); return []; }
}

async function torrentsCsv(query) {
  try {
    const { data } = await http.get(`https://torrents-csv.com/service/search?q=${encodeURIComponent(query)}&size=15&type=torrent`);
    const list = data?.torrents || (Array.isArray(data) ? data : []);
    const out = list.slice(0,15).map(t =>
      buildStream("TorrCSV", t.name, quality(t.name), t.seeders, t.infohash||t.hash, formatSize(t.size_bytes))
    ).filter(Boolean);
    console.log(`[TorrCSV] ${out.length}`);
    return out;
  } catch (e) { console.warn(`[TorrCSV] ${e.message}`); return []; }
}

async function bitsearch(query) {
  try {
    const { data } = await http.get(`https://bitsearch.to/api/v1/search?q=${encodeURIComponent(query)}&sort=seeders`);
    const list = data?.results || data?.data || [];
    const out = list.slice(0,15).map(t => {
      const name = t.name || t.title || "";
      const h = t.infoHash || t.hash || hashFromMagnet(t.magnet);
      return buildStream("Bitsearch", name, quality(name), t.stats?.seeders||t.seeders||0, h, t.stats?.size||t.size);
    }).filter(Boolean);
    console.log(`[Bitsearch] ${out.length}`);
    return out;
  } catch (e) { console.warn(`[Bitsearch] ${e.message}`); return []; }
}

async function knaben(query) {
  try {
    const { data } = await http.post("https://api.knaben.eu/v1", {
      search_type: "torrent",
      search_field: "title",
      query,
      size: 20,
      from: 0,
      orderBy: "seeders",
      orderDirection: "desc",
    });
    if (!data?.hits?.length) return [];
    const out = data.hits.slice(0,15).map(t => {
      const h = validHash(t.hash) || hashFromMagnet(t.magnet);
      return buildStream("Knaben", t.title, quality(t.title), t.seeders, h, formatSize(t.bytes));
    }).filter(Boolean);
    console.log(`[Knaben] ${out.length}`);
    return out;
  } catch (e) { console.warn(`[Knaben] ${e.message}`); return []; }
}

async function x1337(query) {
  try {
    const base = "https://1337x.to";
    const { data } = await http.get(`${base}/search/${encodeURIComponent(query)}/1/`);
    const $ = cheerio.load(data);
    const rows = $("table.table-list tbody tr").toArray().slice(0,6);
    if (!rows.length) return [];

    const items = rows.map(r => ({
      href:  base + ($(r).find("td.name a").eq(1).attr("href")||""),
      name:  $(r).find("td.name a").eq(1).text().trim(),
      seeds: +$(r).find("td.seeds").text().replace(/\D/g,"") || 0,
      size:  $(r).find("td.size").text().trim().split("\n")[0],
    })).filter(i => i.href && i.name);

    const out = (await Promise.all(items.map(async i => {
      try {
        const { data: d } = await http.get(i.href);
        const mag = cheerio.load(d)('a[href^="magnet:"]').attr("href");
        if (!mag) return null;
        return buildStream("1337x", i.name, quality(i.name), i.seeds, hashFromMagnet(mag), i.size);
      } catch { return null; }
    }))).filter(Boolean);

    console.log(`[1337x] ${out.length}`);
    return out;
  } catch (e) { console.warn(`[1337x] ${e.message}`); return []; }
}

async function nyaa(query) {
  try {
    const { data } = await http.get(`https://nyaa.si/?page=rss&q=${encodeURIComponent(query)}&s=seeders&o=desc`);
    const $ = cheerio.load(data, { xmlMode: true });
    const out = $("item").toArray().slice(0, 12).map(item => {
      const $item = $(item);
      const title = cleanText($item.find("title").first().text());
      const hash = cleanText($item.find("nyaa\\:infoHash").first().text());
      const seeds = parseCount($item.find("nyaa\\:seeders").first().text());
      const size = cleanText($item.find("nyaa\\:size").first().text());
      return buildStream("Nyaa", title, quality(title), seeds, hash, size);
    }).filter(Boolean);
    console.log(`[Nyaa] ${out.length}`);
    return out;
  } catch (e) { console.warn(`[Nyaa] ${e.message}`); return []; }
}

async function torrentGalaxy(query) {
  const q = encodeURIComponent(query);
  return scrapeSearchSite("TorrentGalaxy", [
    {
      url: `https://torrentgalaxy.to/torrents.php?search=${q}&sort=seeders&order=desc`,
      rowSelector: ".tgxtablerow, table tr",
      linkSelector: 'a[href*="/torrent/"]',
      titleSelectors: ['a[href*="/torrent/"]'],
      seedSelectors: [".tgxtablecell:nth-child(11)", "td:nth-child(11)"],
      sizeSelectors: [".tgxtablecell:nth-child(8)", "td:nth-child(8)"],
      limit: 6,
      matchLink: href => /\/torrent\//i.test(href),
    },
    {
      url: `https://tgx.rs/torrents.php?search=${q}&sort=seeders&order=desc`,
      rowSelector: ".tgxtablerow, table tr",
      linkSelector: 'a[href*="/torrent/"]',
      titleSelectors: ['a[href*="/torrent/"]'],
      seedSelectors: [".tgxtablecell:nth-child(11)", "td:nth-child(11)"],
      sizeSelectors: [".tgxtablecell:nth-child(8)", "td:nth-child(8)"],
      limit: 6,
      matchLink: href => /\/torrent\//i.test(href),
    },
  ]);
}

async function limeTorrents(query) {
  const slug = encodeURIComponent(cleanText(query).replace(/\s+/g, "-"));
  return scrapeSearchSite("LimeTorrents", [
    {
      url: `https://www.limetorrents.lol/search/all/${slug}/seeds/1/`,
      rowSelector: "table.table2 tr, .table2 tr",
      linkSelector: "a",
      titleSelectors: ['a[href*=".html"]'],
      seedSelectors: [".tdseed", "td:nth-child(3)"],
      sizeSelectors: [".tdnormal", "td:nth-child(2)"],
      limit: 6,
      matchLink: href => /torrent|\.html/i.test(href),
    },
    {
      url: `https://www.limetorrents.asia/search/all/${slug}/seeds/1/`,
      rowSelector: "table.table2 tr, .table2 tr",
      linkSelector: "a",
      titleSelectors: ['a[href*=".html"]'],
      seedSelectors: [".tdseed", "td:nth-child(3)"],
      sizeSelectors: [".tdnormal", "td:nth-child(2)"],
      limit: 6,
      matchLink: href => /torrent|\.html/i.test(href),
    },
  ]);
}

async function torlock(query) {
  const slug = encodeURIComponent(cleanText(query).replace(/\s+/g, "-"));
  return scrapeSearchSite("TorLock", [
    {
      url: `https://www.torlock.com/all/torrents/${slug}.html?sort=seeds`,
      rowSelector: "table tr",
      linkSelector: 'a[href*="/torrent/"]',
      titleSelectors: ['a[href*="/torrent/"]'],
      seedSelectors: ["td:nth-child(5)", ".seeders", ".seeds"],
      sizeSelectors: ["td:nth-child(4)", ".size"],
      limit: 6,
      matchLink: href => /\/torrent\//i.test(href),
    },
    {
      url: `https://torlock-official.live/all/torrents/${slug}.html?sort=seeds`,
      rowSelector: "table tr",
      linkSelector: 'a[href*="/torrent/"]',
      titleSelectors: ['a[href*="/torrent/"]'],
      seedSelectors: ["td:nth-child(5)", ".seeders", ".seeds"],
      sizeSelectors: ["td:nth-child(4)", ".size"],
      limit: 6,
      matchLink: href => /\/torrent\//i.test(href),
    },
  ]);
}

async function torrentDownloads(query) {
  const q = encodeURIComponent(query);
  return scrapeSearchSite("TorrentDownloads", [
    {
      url: `https://www.torrentdownloads.pro/search/?search=${q}`,
      rowSelector: "table tr, .inner_container tr",
      linkSelector: 'a[href*="/torrent/"]',
      titleSelectors: ['a[href*="/torrent/"]'],
      seedSelectors: ["td:nth-child(4)", ".seeders", ".seeds"],
      sizeSelectors: ["td:nth-child(3)", ".size"],
      limit: 6,
      matchLink: href => /\/torrent\//i.test(href),
    },
    {
      url: `https://www.torrentdownloads.me/search/?search=${q}`,
      rowSelector: "table tr, .inner_container tr",
      linkSelector: 'a[href*="/torrent/"]',
      titleSelectors: ['a[href*="/torrent/"]'],
      seedSelectors: ["td:nth-child(4)", ".seeders", ".seeds"],
      sizeSelectors: ["td:nth-child(3)", ".size"],
      limit: 6,
      matchLink: href => /\/torrent\//i.test(href),
    },
  ]);
}

async function extTo(query) {
  const q = encodeURIComponent(query);
  return scrapeSearchSite("EXT.to", [
    {
      url: `https://ext.to/search/?q=${q}`,
      rowSelector: ".search-result, .torrent, table tr, li",
      linkSelector: "a",
      titleSelectors: [".torrent-title a", ".title a", 'a[href*="/torrent/"]', "a"],
      seedSelectors: [".seeders", ".seeds", "td:nth-child(5)"],
      sizeSelectors: [".size", "td:nth-child(4)"],
      limit: 6,
      matchLink: href => /\/torrent\/|\/download\//i.test(href),
    },
  ]);
}

async function rargb(query) {
  const q = encodeURIComponent(query);
  return scrapeSearchSite("RARGB", [
    {
      url: `https://rargb.to/search/?search=${q}`,
      rowSelector: "table tr, .lista2",
      linkSelector: "a",
      titleSelectors: ['a[href*="/torrent/"]', "a"],
      seedSelectors: [".seeders", ".seeds", "td:nth-child(4)"],
      sizeSelectors: [".size", "td:nth-child(3)"],
      limit: 6,
      matchLink: href => /\/torrent\//i.test(href),
    },
  ]);
}

// ──────────────────────────────────────────────────────────────────────────
// Resolve title via Cinemeta (Stremio's own metadata API)
// ──────────────────────────────────────────────────────────────────────────
async function resolveTitle(imdbId, type) {
  const urls = [
    `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`,
    `https://v3-cinemeta.strem.io/meta/movie/${imdbId}.json`,
    `https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`,
  ];
  for (const url of urls) {
    try {
      const { data } = await http.get(url);
      if (data?.meta?.name) return { title: data.meta.name, year: String(data.meta.year||"") };
    } catch {}
  }
  return { title: imdbId, year: "" };
}

// ──────────────────────────────────────────────────────────────────────────
// MASTER
// ──────────────────────────────────────────────────────────────────────────
async function scrapeAll(imdbId, isSeries, season, episode) {
  const type = isSeries ? "series" : "movie";
  const { title, year } = await resolveTitle(imdbId, type);

  const query = isSeries
    ? `${title} S${String(season).padStart(2,"0")}E${String(episode).padStart(2,"0")}`
    : `${title} ${year}`.trim();

  console.log(`\n[Purefy] Query: "${query}" (${imdbId})`);

  const rankedSites = [
    tpb(query),
    knaben(query),
    torrentsCsv(query),
    bitsearch(query),
    x1337(query),
    torrentGalaxy(query),
    nyaa(query),
    limeTorrents(query),
    torlock(query),
    torrentDownloads(query),
    extTo(query),
    rargb(query),
  ];

  const tasks = isSeries
    ? [ eztv(imdbId, season, episode), ...rankedSites ]
    : [ yts(imdbId), ...rankedSites ];

  const results = await Promise.allSettled(tasks);
  const all     = results.flatMap(r => r.status === "fulfilled" ? r.value : []);

  // Dedup por infoHash
  const seen = new Set();
  const unique = all.filter(s => {
    if (seen.has(s.infoHash)) return false;
    seen.add(s.infoHash);
    return true;
  });

  // Ordenar por qualidade > seeders
  const Q = { "2160p":0, "1080p":1, "720p":2, "480p":3, "360p":4 };
  unique.sort((a, b) => {
    const qa = Q[a.name.match(/\d+p/)?.[0]] ?? 9;
    const qb = Q[b.name.match(/\d+p/)?.[0]] ?? 9;
    return qa - qb;
  });

  console.log(`[Purefy] Total: ${unique.length} streams`);
  return unique;
}

module.exports = { scrapeAll };
