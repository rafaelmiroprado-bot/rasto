/**
 * TorrentBR Scraper — scrapers.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fontes implementadas (17 total):
 *  1.  YTS / YTS-Official       (API JSON)
 *  2.  EZTV                     (API JSON)
 *  3.  The Pirate Bay (apibay)  (API JSON — múltiplos mirrors)
 *  4.  TorrentGalaxy            (HTML — múltiplos mirrors)
 *  5.  LimeTorrents             (HTML — múltiplos mirrors)
 *  6.  1337x                    (HTML — múltiplos mirrors)
 *  7.  RuTracker                (HTML)
 *  8.  Nyaa.si                  (HTML)
 *  9.  RARBG / TorrentAPI       (API JSON)
 * 10.  Kickass Torrents         (HTML — múltiplos mirrors)
 * 11.  TorrentDownloads         (HTML)
 * 12.  TorLock                  (HTML)
 * 13.  Zooqle                   (HTML)
 * 14.  Internet Archive         (API JSON — domínio público)
 * 15.  Public Domain Torrents   (HTML — filmes clássicos)
 * 16.  ApacheTorrent            (HTML)
 * 17.  BTDigg                   (HTML — indexador DHT)
 */

const axios   = require("axios");
const cheerio = require("cheerio");

// ─── HTTP client com headers de browser ──────────────────────────────────────
const http = axios.create({
  timeout: 18000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
  },
  maxRedirects: 5,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractQuality(str) {
  if (!str) return "Unknown";
  if (/2160p|4K|UHD/i.test(str))       return "2160p";
  if (/1080p|FHD/i.test(str))          return "1080p";
  if (/720p|HD(?!R)/i.test(str))       return "720p";
  if (/480p/i.test(str))               return "480p";
  if (/360p/i.test(str))               return "360p";
  return "Unknown";
}

function extractCodec(str) {
  if (!str) return null;
  if (/HEVC|x265|H\.265/i.test(str)) return "x265";
  if (/AVC|x264|H\.264/i.test(str))  return "x264";
  if (/AV1/i.test(str))              return "AV1";
  if (/xvid/i.test(str))             return "XviD";
  return null;
}

function extractAudio(str) {
  if (!str) return null;
  if (/DTS-HD|DTSHD/i.test(str))         return "DTS-HD";
  if (/DTS/i.test(str))                  return "DTS";
  if (/TrueHD|Atmos/i.test(str))         return "TrueHD";
  if (/DD\+|EAC3|E-AC-3/i.test(str))    return "DD+";
  if (/DD|AC3|Dolby/i.test(str))         return "DD";
  if (/AAC/i.test(str))                  return "AAC";
  if (/MP3/i.test(str))                  return "MP3";
  return null;
}

function extractSource(str) {
  if (!str) return null;
  if (/BluRay|Blu-Ray|BDRip|BRRip/i.test(str)) return "BluRay";
  if (/WEB-DL|WEBDL/i.test(str))               return "WEB-DL";
  if (/WEBRip/i.test(str))                      return "WEBRip";
  if (/HDRip/i.test(str))                       return "HDRip";
  if (/HDTV/i.test(str))                        return "HDTV";
  if (/CAM|HDCAM/i.test(str))                   return "CAM";
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
  "udp://9.rarbg.com:2810/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.tiny-vps.com:6969/announce",
  "udp://tracker.moeking.me:6969/announce",
  "https://tracker.nanoha.org/announce",
  "udp://tracker.leechers-paradise.org:6969/announce",
  "udp://glotorrents.pw:6969/announce",
].map(t => `&tr=${encodeURIComponent(t)}`).join("");

function buildMagnet(infoHash, name) {
  return `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name || "")}${TRACKERS}`;
}

function makeStream({ source, title, quality, seeders, leechers, infoHash, magnet, size, codec, audio }) {
  const q = quality  || "Unknown";
  const s = seeders  || 0;
  const l = leechers || 0;

  // name: negrito no Stremio (fonte + qualidade)
  const nameLine = `${source} • ${q}`;

  // Montar linhas de descrição
  const lines = [];

  // Nome do release (truncado)
  if (title) {
    const t = title.length > 60 ? title.slice(0, 57) + "…" : title;
    lines.push(`📄 ${t}`);
  }

  // Qualidade + codec + audio
  const techParts = [q];
  if (codec) techParts.push(codec);
  if (audio) techParts.push(audio);
  lines.push(`🎬 ${techParts.join(" · ")}`);

  // Tamanho
  if (size) lines.push(`💾 ${size}`);

  // Seeds / peers
  lines.push(l > 0 ? `🌱 ${s} seeds  👥 ${l} peers` : `🌱 ${s} seeds`);

  const description = lines.join("\n");

  const obj = {
    name:        nameLine,
    description, // Stremio v5+
    title:       description, // fallback versões antigas
    _quality:    q,
    _seeders:    s,
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

function hashFromMagnet(magnet) {
  const m = (magnet || "").match(/btih:([a-fA-F0-9]{40})/i);
  return m ? m[1] : null;
}

async function tryMirrors(mirrors, fn) {
  for (const mirror of mirrors) {
    try {
      const result = await fn(mirror);
      if (result && result.length > 0) return result;
    } catch (e) {
      console.warn(`  mirror ${mirror} falhou: ${e.message}`);
    }
  }
  return [];
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. YTS
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeYTS(imdbId) {
  const mirrors = [
    "https://yts.mx/api/v2/list_movies.json",
    "https://yts-official.org/api/v2/list_movies.json",
  ];
  return tryMirrors(mirrors, async (url) => {
    const { data } = await http.get(`${url}?query_term=${imdbId}&limit=10`);
    if (!data?.data?.movies?.length) return [];
    const streams = [];
    for (const movie of data.data.movies) {
      for (const t of movie.torrents || []) {
        streams.push(makeStream({
          source: "YTS",
          title: movie.title_long || movie.title,
          quality: t.quality,
          codec:   t.video_codec || null,
          audio:   t.audio_channels ? `${t.audio_channels}ch` : null,
          seeders:  t.seeds,
          leechers: t.peers,
          infoHash: t.hash,
          size: t.size,
        }));
      }
    }
    console.log(`[YTS] ${streams.length}`);
    return streams;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. EZTV
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeEZTV(imdbId, season, episode) {
  try {
    const num = imdbId.replace("tt", "");
    const mirrors = [
      `https://eztv.re/api/get-torrents?imdb_id=${num}&limit=30`,
      `https://eztv.io/api/get-torrents?imdb_id=${num}&limit=30`,
    ];
    for (const url of mirrors) {
      try {
        const { data } = await http.get(url);
        if (!data?.torrents?.length) continue;
        let list = data.torrents;
        if (season !== null && episode !== null) {
          list = list.filter(t => {
            const m = (t.title || "").match(/S(\d+)E(\d+)/i);
            return m && parseInt(m[1]) === season && parseInt(m[2]) === episode;
          });
        }
        const streams = list.slice(0, 15).map(t => makeStream({
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
      } catch { continue; }
    }
  } catch (e) { console.warn("[EZTV]", e.message); }
  return [];
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. The Pirate Bay
// ══════════════════════════════════════════════════════════════════════════════
async function scrapePirateBay(query) {
  const mirrors = [
    "https://apibay.org/q.php",
    "https://piratebay.live/api/q.php",
  ];
  return tryMirrors(mirrors, async (base) => {
    const { data } = await http.get(`${base}?q=${encodeURIComponent(query)}&cat=0`);
    if (!Array.isArray(data) || data[0]?.name === "No results returned") return [];
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
// 4. TorrentGalaxy
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeTorrentGalaxy(query) {
  const mirrors = [
    "https://torrentgalaxy.one",
    "https://torrentgalaxy.hair",
    "https://torrentgalaxy-official.com",
    "https://tgx.rs",
  ];
  return tryMirrors(mirrors, async (base) => {
    const url = `${base}/torrents.php?search=${encodeURIComponent(query)}&cat=0&sort=seeders&order=desc`;
    const { data } = await http.get(url);
    const $ = cheerio.load(data);
    const streams = [];
    $(".tgxtablerow, tr.tr").each((_, row) => {
      const nameEl = $(row).find("a.txlight, td.coll-1 a").first();
      const name   = nameEl.text().trim();
      if (!name) return;
      const magnet = $(row).find('a[href^="magnet:"]').attr("href");
      if (!magnet) return;
      const seeders = parseNum($(row).find("span.seedsnum, .tgxtd.seederslabel").text());
      const size    = $(row).find(".tgxtd.nobr, td.coll-4").first().text().trim();
      streams.push(makeStream({
        source:   "TGX",
        title:    name,
        quality:  extractQuality(name),
        codec:    extractCodec(name),
        audio:    extractAudio(name),
        seeders,
        infoHash: hashFromMagnet(magnet),
        magnet,
        size,
      }));
    });
    console.log(`[TGX] ${streams.length} em ${base}`);
    return streams;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. LimeTorrents
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeLimeTorrents(query) {
  const mirrors = [
    "https://limetorrents.fun",
    "https://www.limetorrents.lol",
    "https://limetorrents.pro",
  ];
  return tryMirrors(mirrors, async (base) => {
    const url = `${base}/search/all/${encodeURIComponent(query)}/seeds/1/`;
    const { data } = await http.get(url);
    const $ = cheerio.load(data);
    const streams = [];
    $("table.table2 tbody tr").slice(0, 12).each((_, row) => {
      const name    = $(row).find("td:nth-child(1) a").last().text().trim();
      const magnet  = $(row).find('a[href^="magnet:"]').attr("href");
      if (!name || !magnet) return;
      const seeders = parseNum($(row).find("td.tdseed").text());
      const size    = $(row).find("td:nth-child(3)").text().trim();
      streams.push(makeStream({
        source:  "Lime",
        title:   name,
        quality: extractQuality(name),
        codec:   extractCodec(name),
        audio:   extractAudio(name),
        seeders,
        infoHash: hashFromMagnet(magnet),
        magnet,
        size,
      }));
    });
    console.log(`[Lime] ${streams.length}`);
    return streams;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. 1337x
// ══════════════════════════════════════════════════════════════════════════════
async function scrape1337x(query) {
  const mirrors = ["https://1337x.to", "https://1337x.st", "https://x1337x.eu"];
  return tryMirrors(mirrors, async (base) => {
    const { data } = await http.get(`${base}/search/${encodeURIComponent(query)}/1/`);
    const $ = cheerio.load(data);
    const rows = $("table.table-list tbody tr").toArray();
    if (!rows.length) return [];
    const items = rows.slice(0, 10).map(row => ({
      href:    base + ($(row).find("td.name a").eq(1).attr("href") || ""),
      name:    $(row).find("td.name a").eq(1).text().trim(),
      seeders: parseNum($(row).find("td.seeds").text()),
      size:    $(row).find("td.size").text().trim().split("\n")[0],
    })).filter(i => i.href !== base && i.name);
    const streams = (await Promise.all(items.slice(0, 8).map(async item => {
      try {
        const { data: d } = await http.get(item.href);
        const $d = cheerio.load(d);
        const magnet = $d('a[href^="magnet:"]').attr("href");
        if (!magnet) return null;
        return makeStream({
          source:  "1337x",
          title:   item.name,
          quality: extractQuality(item.name),
          codec:   extractCodec(item.name),
          audio:   extractAudio(item.name),
          seeders: item.seeders,
          infoHash: hashFromMagnet(magnet),
          magnet,
          size: item.size,
        });
      } catch { return null; }
    }))).filter(Boolean);
    console.log(`[1337x] ${streams.length}`);
    return streams;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. RuTracker
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeRuTracker(query) {
  try {
    const url = `https://rutracker.org/forum/tracker.php?nm=${encodeURIComponent(query)}`;
    const { data } = await http.get(url, { headers: { "Cookie": "bb_dl=1; bb_ssl=1" } });
    const $ = cheerio.load(data);
    const rows = $("table#search-results tbody tr").toArray().slice(0, 10);
    const items = rows.map(row => ({
      name:     $(row).find("td.t-title a.tLink").text().trim(),
      href:     $(row).find("td.t-title a.tLink").attr("href"),
      seeders:  parseNum($(row).find("td.seedmed b").text()),
      size:     $(row).find("td.tor-size").text().trim(),
    })).filter(i => i.name && i.href);

    const streams = (await Promise.all(items.slice(0, 4).map(async item => {
      try {
        const fullUrl = item.href.startsWith("http") ? item.href : `https://rutracker.org/forum/${item.href}`;
        const { data: d } = await http.get(fullUrl);
        const $d = cheerio.load(d);
        const magnet = $d('a.magnet-link[href^="magnet:"]').attr("href");
        if (!magnet) return null;
        return makeStream({
          source: "RuTrk",
          title: item.name,
          quality: extractQuality(item.name),
          seeders: item.seeders,
          infoHash: hashFromMagnet(magnet),
          magnet,
          size: item.size,
        });
      } catch { return null; }
    }))).filter(Boolean);

    console.log(`[RuTrk] ${streams.length}`);
    return streams;
  } catch (e) {
    console.warn("[RuTrk]", e.message);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 8. Nyaa.si
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeNyaa(query) {
  try {
    const url = `https://nyaa.si/?f=0&c=0_0&q=${encodeURIComponent(query)}&s=seeders&o=desc`;
    const { data } = await http.get(url);
    const $ = cheerio.load(data);
    const streams = [];
    $("table tbody tr").slice(0, 10).each((_, row) => {
      const name   = $(row).find("td:nth-child(2) a").last().text().trim();
      const magnet = $(row).find('a[href^="magnet:"]').attr("href");
      if (!name || !magnet) return;
      const seeders = parseNum($(row).find("td:nth-child(6)").text());
      const size    = $(row).find("td:nth-child(4)").text().trim();
      streams.push(makeStream({
        source: "Nyaa",
        title: name,
        quality: extractQuality(name),
        seeders,
        infoHash: hashFromMagnet(magnet),
        magnet,
        size,
      }));
    });
    console.log(`[Nyaa] ${streams.length}`);
    return streams;
  } catch (e) {
    console.warn("[Nyaa]", e.message);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 9. RARBG / TorrentAPI
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeTorrentApi(imdbId) {
  try {
    const tokenRes = await http.get(
      "https://torrentapi.org/pubapi_v2.php?get_token=get_token&app_id=stremio_torbr"
    );
    const token = tokenRes.data?.token;
    if (!token) return [];
    await new Promise(r => setTimeout(r, 1500));
    const { data } = await http.get(
      `https://torrentapi.org/pubapi_v2.php?mode=search&search_imdb=${imdbId}&token=${token}&format=json_extended&app_id=stremio_torbr`
    );
    if (!data?.torrent_results?.length) return [];
    const streams = data.torrent_results.slice(0, 10).map(t => makeStream({
      source:   "RARBG",
      title:    t.title,
      quality:  extractQuality(t.title),
      codec:    extractCodec(t.title),
      audio:    extractAudio(t.title),
      seeders:  t.seeders,
      leechers: t.leechers,
      infoHash: hashFromMagnet(t.download),
      magnet:   t.download,
      size: t.size ? `${(t.size / 1e9).toFixed(2)} GB` : null,
    }));
    console.log(`[RARBG] ${streams.length}`);
    return streams;
  } catch (e) {
    console.warn("[RARBG]", e.message);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 10. Kickass Torrents
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeKickass(query) {
  const mirrors = ["https://kickasstorrents.to", "https://katcr.to", "https://kat.cr"];
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
        source:  "KAT",
        title:   name,
        quality: extractQuality(name),
        codec:   extractCodec(name),
        audio:   extractAudio(name),
        seeders,
        infoHash: hashFromMagnet(magnet),
        magnet,
        size,
      }));
    });
    console.log(`[KAT] ${streams.length}`);
    return streams;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 11. TorrentDownloads
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
        const $d = cheerio.load(d);
        const magnet = $d('a[href^="magnet:"]').attr("href");
        if (!magnet) return null;
        return makeStream({
          source: "TDL",
          title: item.name,
          quality: extractQuality(item.name),
          seeders: parseNum($d(".seeds, .tseed").first().text()),
          infoHash: hashFromMagnet(magnet),
          magnet,
          size: $d(".cate_size, .tsize").first().text().trim(),
        });
      } catch { return null; }
    }))).filter(Boolean);
    console.log(`[TDL] ${streams.length}`);
    return streams;
  } catch (e) {
    console.warn("[TDL]", e.message);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 12. TorLock
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeTorLock(query) {
  try {
    const { data } = await http.get(
      `https://www.torlock.com/all/torrents/${encodeURIComponent(query)}.html?sort=seeds`
    );
    const $ = cheerio.load(data);
    const items = [];
    $("table.table tbody tr").slice(0, 8).each((_, row) => {
      const nameEl = $(row).find("td a.n").first();
      const href   = nameEl.attr("href");
      if (!href) return;
      items.push({
        href:    `https://www.torlock.com${href}`,
        name:    nameEl.text().trim(),
        seeders: parseNum($(row).find("td.tds").text()),
        size:    $(row).find("td.tds1").text().trim(),
      });
    });
    const streams = (await Promise.all(items.slice(0, 5).map(async item => {
      try {
        const { data: d } = await http.get(item.href);
        const $d = cheerio.load(d);
        const magnet = $d('a[href^="magnet:"]').attr("href");
        if (!magnet) return null;
        return makeStream({
          source: "TorLock",
          title: item.name,
          quality: extractQuality(item.name),
          seeders: item.seeders,
          infoHash: hashFromMagnet(magnet),
          magnet,
          size: item.size,
        });
      } catch { return null; }
    }))).filter(Boolean);
    console.log(`[TorLock] ${streams.length}`);
    return streams;
  } catch (e) {
    console.warn("[TorLock]", e.message);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 13. Zooqle
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeZooqle(query) {
  try {
    const { data } = await http.get(
      `https://zooqle.com/search?q=${encodeURIComponent(query)}&s=ns&v=t&sd=d`
    );
    const $ = cheerio.load(data);
    const streams = [];
    $("table.table tbody tr").slice(0, 10).each((_, row) => {
      const name   = $(row).find("td:nth-child(1) a").text().trim();
      const magnet = $(row).find('a[href^="magnet:"]').attr("href");
      if (!name || !magnet) return;
      streams.push(makeStream({
        source: "Zooqle",
        title: name,
        quality: extractQuality(name),
        seeders: parseNum($(row).find("td.sg").text()),
        infoHash: hashFromMagnet(magnet),
        magnet,
        size: $(row).find("td:nth-child(4)").text().trim(),
      }));
    });
    console.log(`[Zooqle] ${streams.length}`);
    return streams;
  } catch (e) {
    console.warn("[Zooqle]", e.message);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 14. Internet Archive  (domínio público)
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeInternetArchive(query) {
  try {
    const { data } = await http.get(
      `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}+mediatype:movies&fl[]=identifier,title&rows=6&output=json`
    );
    if (!data?.response?.docs?.length) return [];
    const streams = (await Promise.all(
      data.response.docs.slice(0, 4).map(async doc => {
        try {
          const { data: meta } = await http.get(`https://archive.org/metadata/${doc.identifier}`);
          const btih = meta?.metadata?.btih;
          if (!btih) return null;
          return makeStream({
            source: "Archive",
            title: doc.title || doc.identifier,
            quality: extractQuality(doc.title || ""),
            seeders: 0,
            infoHash: btih,
            magnet: buildMagnet(btih, doc.title),
          });
        } catch { return null; }
      })
    )).filter(Boolean);
    console.log(`[Archive] ${streams.length}`);
    return streams;
  } catch (e) {
    console.warn("[Archive]", e.message);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 15. Public Domain Torrents
// ══════════════════════════════════════════════════════════════════════════════
async function scrapePublicDomainTorrents(query) {
  try {
    const { data } = await http.get(
      `https://www.publicdomaintorrents.info/nshowcat.html?category=ALL&search=${encodeURIComponent(query)}`
    );
    const $ = cheerio.load(data);
    const streams = [];
    $("a[href$='.torrent']").slice(0, 5).each((_, el) => {
      const href = $(el).attr("href") || "";
      const name = $(el).closest("tr").find("td").first().text().trim() || $(el).text().trim();
      if (!href || !name) return;
      const fullHref = href.startsWith("http") ? href : `https://www.publicdomaintorrents.info/${href}`;
      streams.push({
        name:  "PDTorrents\nClassic",
        title: `📼 ${name} · Domínio Público`,
        externalUrl: fullHref,
        _quality: "360p",
        _seeders: 0,
      });
    });
    console.log(`[PDT] ${streams.length}`);
    return streams;
  } catch (e) {
    console.warn("[PDT]", e.message);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 16. ApacheTorrent
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeApacheTorrent(query) {
  try {
    const { data } = await http.get(
      `https://apachetorrent.com/?search=${encodeURIComponent(query)}`
    );
    const $ = cheerio.load(data);
    const streams = [];
    $(".torrent-list tr, .results tr, table tbody tr").slice(1, 11).each((_, row) => {
      const magnet = $(row).find('a[href^="magnet:"]').attr("href");
      const name   = $(row).find("td a").first().text().trim();
      if (!magnet || !name) return;
      streams.push(makeStream({
        source: "Apache",
        title: name,
        quality: extractQuality(name),
        seeders: parseNum($(row).find(".seeds, td:nth-child(5)").text()),
        infoHash: hashFromMagnet(magnet),
        magnet,
        size: $(row).find("td:nth-child(4), .size").text().trim(),
      }));
    });
    console.log(`[Apache] ${streams.length}`);
    return streams;
  } catch (e) {
    console.warn("[Apache]", e.message);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 17. BTDigg  (indexador DHT)
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeBTDigg(query) {
  try {
    const { data } = await http.get(
      `https://btdig.com/search?q=${encodeURIComponent(query)}&order=0&p=0`
    );
    const $ = cheerio.load(data);
    const streams = [];
    $(".one_result").slice(0, 8).each((_, el) => {
      const name   = $(el).find(".torrent_name a").text().trim();
      const magnet = $(el).find('a[href^="magnet:"]').attr("href");
      if (!name || !magnet) return;
      streams.push(makeStream({
        source: "BTDigg",
        title: name,
        quality: extractQuality(name),
        seeders: 0,
        infoHash: hashFromMagnet(magnet),
        magnet,
        size: $(el).find(".torrent_size").text().trim(),
      }));
    });
    console.log(`[BTDigg] ${streams.length}`);
    return streams;
  } catch (e) {
    console.warn("[BTDigg]", e.message);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MASTER — resolve título e dispara todos em paralelo
// ══════════════════════════════════════════════════════════════════════════════
async function scrapeAll(imdbId, isSeries, season, episode) {
  let title = imdbId, year = "";
  try {
    for (const key of ["b7c56d5e", "trilogy", "thewdb"]) {
      try {
        const { data } = await http.get(`https://www.omdbapi.com/?i=${imdbId}&apikey=${key}`);
        if (data?.Title) { title = data.Title; year = data.Year?.split("–")[0] || ""; break; }
      } catch { continue; }
    }
  } catch { /* usa imdbId como fallback */ }

  const query = isSeries
    ? `${title} S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`
    : `${title} ${year}`.trim();

  console.log(`\n[Master] "${query}" | ${imdbId}`);

  const tasks = [
    // ── APIs JSON (rápidas) ───────────────────────────────────────────
    scrapePirateBay(query),
    scrapeTorrentApi(imdbId),
    isSeries ? scrapeEZTV(imdbId, season, episode) : scrapeYTS(imdbId),

    // ── HTML scrapers ─────────────────────────────────────────────────
    scrapeTorrentGalaxy(query),
    scrapeLimeTorrents(query),
    scrape1337x(query),
    scrapeNyaa(query),
    scrapeKickass(query),
    scrapeBTDigg(query),
    scrapeZooqle(query),
    scrapeApacheTorrent(query),

    // ── Mais lentos / especializados ──────────────────────────────────
    scrapeTorrentDownloads(query),
    scrapeTorLock(query),
    scrapeInternetArchive(query),
    scrapePublicDomainTorrents(query),
    scrapeRuTracker(query),
  ];

  const results = await Promise.allSettled(tasks);
  return results.flatMap(r => r.status === "fulfilled" ? r.value : []);
}

module.exports = { scrapeAll };
