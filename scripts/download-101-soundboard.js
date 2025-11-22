#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const https = require('https');
const { URL } = require('url');
const zlib = require('zlib');
const { setTimeout: sleep } = require('timers/promises');
const cheerio = require('cheerio');

const SOUND_DATA_DIR = path.join(__dirname, '..', 'data', 'soundboards');
const SOUND_PUBLIC_DIR = path.join(__dirname, '..', 'public', 'soundboards');

// Use a "real browser" UA to avoid blocked payloads / 404s from CDN
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

// Some boards are now fronted by stricter bot protection; allow users to pass a
// cookie copied from a real browser session to bypass the challenge locally.
const COOKIE_HEADER = process.env.SB_101SOUNDBOARDS_COOKIE;

const BASE_HEADERS = {
  'User-Agent': USER_AGENT,
  // mimic modern chromium fetch headers
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  Connection: 'keep-alive',
  Referer: 'https://www.101soundboards.com/',
  Origin: 'https://www.101soundboards.com',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Dest': 'document',
  'Sec-Ch-Ua': '"Chromium";v="127", "Not=A?Brand";v="99"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
};

if (COOKIE_HEADER) BASE_HEADERS.Cookie = COOKIE_HEADER;

const normaliseString = (value) => (typeof value === 'string' ? value.trim() : '');

const ensureDir = async (targetPath) => {
  await fsPromises.mkdir(targetPath, { recursive: true });
};

// === Networking helpers (with redirect + compression) =======================
const fetchText = (url) =>
  new Promise((resolve, reject) => {
    const requestUrl = typeof url === 'string' ? url : url.toString();
    const u = new URL(requestUrl);
    const req = https.request(
      u,
      {
        method: 'GET',
        headers: BASE_HEADERS,
      },
      (res) => {
        // follow simple redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, requestUrl).toString();
          return resolve(fetchText(next));
        }
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          return reject(new Error(`Request failed with status ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const enc = (res.headers['content-encoding'] || '').toLowerCase();
          try {
            let out;
            if (enc.includes('br')) out = zlib.brotliDecompressSync(buf);
            else if (enc.includes('gzip')) out = zlib.gunzipSync(buf);
            else if (enc.includes('deflate')) out = zlib.inflateSync(buf);
            else out = buf;
            resolve(out.toString('utf8'));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });

const fetchBinary = (url) =>
  new Promise((resolve, reject) => {
    const requestUrl = typeof url === 'string' ? url : url.toString();
    const u = new URL(requestUrl);
    const req = https.request(
      u,
      {
        method: 'GET',
        headers: { ...BASE_HEADERS, Accept: '*/*', 'Sec-Fetch-Dest': 'empty' },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, requestUrl).toString();
          return resolve(fetchBinary(next));
        }
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          return reject(new Error(`Request failed with status ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }
    );
    req.on('error', reject);
    req.end();
  });

// === Legacy JSON parsing (kept in case it still exists on some pages) =======
const parseNuxtState = (html) => {
  const $ = cheerio.load(html);
  const scripts = [];
  $('script').each((_, el) => {
    const text = $(el).html();
    if (!text) return;
    if (text.includes('__NUXT__') || text.includes('soundboards')) {
      scripts.push(text);
    }
  });
  for (const script of scripts) {
    const nuxtMatch = script.match(/window\.__NUXT__\s*=\s*(\{.*\})/s);
    if (nuxtMatch) {
      try { return JSON.parse(nuxtMatch[1]); } catch { /* next */ }
    }
    const jsonMatch = script.match(/=\s*(\{\s*"data"[\s\S]+\})\s*;?$/s);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[1]); } catch { /* next */ }
    }
  }
  return null;
};

const flatten = (input, results = []) => {
  if (!input) return results;
  if (Array.isArray(input)) { input.forEach((i) => flatten(i, results)); return results; }
  if (typeof input === 'object') { results.push(input); Object.values(input).forEach((v) => flatten(v, results)); }
  return results;
};

const extractClips = (state) => {
  const candidates = flatten(state);
  const clips = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const possibleUrl = normaliseString(
      candidate.url || candidate.soundUrl || candidate.downloadUrl || candidate.sound || candidate.audio
    );
    if (!possibleUrl || !/\.(mp3|wav|ogg|m4a|aac)(?:\?|$)/i.test(possibleUrl)) continue;
    const title = normaliseString(candidate.title || candidate.name || candidate.label || candidate.slug) || 'Sound Clip';
    const duration = Number(candidate.duration || candidate.length || candidate.time) || 0;
    const tagsRaw = candidate.tags || candidate.categories || candidate.keywords;
    const tags = Array.isArray(tagsRaw) ? tagsRaw.map((t) => normaliseString(t)).filter(Boolean)
      : normaliseString(tagsRaw).split(',').map((t) => t.trim()).filter(Boolean);
    clips.push({ url: possibleUrl, title, duration, tags });
  }
  return clips;
};

// === Fallback DOM scraping ===================================================
function extractClipsFallback(html, boardUrl) {
  const $ = cheerio.load(html);

  // capture both /sound/ and /sounds/ forms
  const soundLinks = new Set();
  $('a[href*="/sound"]').each((_, a) => {
    const href = ($(a).attr('href') || '').trim();
    if (/(\/sound(s)?\/\d+[-a-z0-9]+)/i.test(href)) {
      soundLinks.add(new URL(href, boardUrl).toString().replace(/\/+$/, ''));
    }
  });
  // data-href variants
  $('[data-href*="/sound"]').each((_, el) => {
    const href = ($(el).attr('data-href') || '').trim();
    if (/(\/sound(s)?\/\d+[-a-z0-9]+)/i.test(href)) {
      soundLinks.add(new URL(href, boardUrl).toString().replace(/\/+$/, ''));
    }
  });

  return Array.from(soundLinks).map((href) => ({ href }));
}

async function resolveSoundToMp3(soundPageUrl) {
  const html = await fetchText(soundPageUrl);
  const $ = cheerio.load(html);

  // 1) direct mp3 in DOM
  let mp3 =
    $('a[download][href$=".mp3"]').attr('href') ||
    $('a[href$=".mp3"]').attr('href') ||
    $('audio source[src$=".mp3"]').attr('src') ||
    $('audio[src$=".mp3"]').attr('src');

  // 2) OpenGraph
  if (!mp3) {
    const og = $('meta[property="og:audio"]').attr('content');
    if (og && /\.mp3($|\?)/i.test(og)) mp3 = og;
  }

  // 3) Script blobs
  if (!mp3) {
    $('script').each((_, s) => {
      const t = $(s).html() || '';
      const m = t.match(/https?:\/\/[^\s'"<>]+\.mp3[^'"<]*/i);
      if (m && !mp3) mp3 = m[0];
    });
  }

  if (mp3) {
    mp3 = new URL(mp3, soundPageUrl).toString();
    const title = ($('h1').first().text() || $('title').text() || '').trim() || 'sound';
    return { title, url: mp3 };
  }
  return null;
}

// === Persist board index + download =========================================
const writeBoardIndex = async (boardId, boardTitle, clips) => {
  const boardFilePath = path.join(SOUND_DATA_DIR, `${boardId}.json`);
  await ensureDir(SOUND_DATA_DIR);
  await fsPromises.writeFile(
    boardFilePath,
    JSON.stringify({
      id: boardId,
      title: boardTitle,
      source: '101soundboards',
      items: clips.map((clip, index) => ({
        id: `${boardId}-${index}`,
        title: clip.title,
        tags: clip.tags,
        duration: clip.duration,
        file: `${boardId}/${clip.filename}`,
      })),
    }, null, 2)
  );

  const indexFilePath = path.join(SOUND_DATA_DIR, 'index.json');
  let indexData = { boards: [] };
  try {
    const raw = await fsPromises.readFile(indexFilePath, 'utf8');
    indexData = JSON.parse(raw);
  } catch { /* create new */ }
  if (!Array.isArray(indexData.boards)) indexData.boards = [];
  if (!indexData.boards.includes(boardId)) indexData.boards.push(boardId);
  await fsPromises.writeFile(indexFilePath, `${JSON.stringify(indexData, null, 2)}\n`);
};

// === New: parallel downloads + resume/skip ==================================
async function downloadClips(boardId, clips, opts = {}) {
  const {
    concurrency = 4,
    delayMs = 0,
    resume = true, // skip existing files
  } = opts;

  const targetDir = path.join(SOUND_PUBLIC_DIR, boardId);
  await ensureDir(targetDir);

  let i = 0;
  const enriched = [];

  async function worker() {
    while (i < clips.length) {
      const idx = i++;
      const clip = clips[idx];

      // derive filename (same logic as before)
      const clipUrl = new URL(clip.url, 'https://www.101soundboards.com');
      const extensionMatch = clipUrl.pathname.match(/\.([a-z0-9]+)$/i);
      const extension = (extensionMatch ? extensionMatch[1] : 'mp3').toLowerCase();
      const safeSlug = normaliseString(clip.title).replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'clip';
      const filename = `${safeSlug}.${extension}`;
      const filePath = path.join(targetDir, filename);

      // skip if exists (resume)
      if (resume && fs.existsSync(filePath)) {
        console.log(`Skip (exists): ${filename}`);
        enriched.push({ ...clip, filename });
        if (delayMs) await sleep(delayMs);
        continue;
      }

      console.log(`Downloading ${clip.title} → ${filename}`);
      const data = await fetchBinary(clipUrl.toString());
      await fsPromises.writeFile(filePath, data);
      enriched.push({ ...clip, filename });

      if (delayMs) await sleep(delayMs);
    }
  }

  const workers = Array.from({ length: Math.max(1, Number(concurrency) || 1) }, () => worker());
  await Promise.all(workers);

  return enriched;
}

// === CLI args, board id/URL derivation ======================================
const parseArgs = () => {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--board' || arg === '-b') { result.board = args[i + 1]; i += 1; }
    else if (arg === '--id') { result.id = args[i + 1]; i += 1; }
    else if (arg === '--title') { result.title = args[i + 1]; i += 1; }
    else if (arg === '--concurrency') { result.concurrency = parseInt(args[i+1]||'4',10); i+=1; }
    else if (arg === '--delayMs') { result.delayMs = parseInt(args[i+1]||'0',10); i+=1; }
    else if (arg === '--resume') { result.resume = true; }
  }
  return result;
};

const deriveBoardId = (boardArg, explicitId) => {
  if (explicitId) return normaliseString(explicitId).replace(/[^a-z0-9_-]/gi, '-');
  if (!boardArg) throw new Error('Provide a board URL or slug with --board');
  const clean = normaliseString(boardArg);
  if (clean.startsWith('http://') || clean.startsWith('https://')) {
    const url = new URL(clean);
    const parts = url.pathname.split('/').filter(Boolean);
    const slug = parts.pop();
    if (!slug) throw new Error('Could not parse board slug from URL');
    return slug;
  }
  return clean;
};

// === Main ===================================================================
(async () => {
  try {
    const { board, id, title, concurrency, delayMs, resume } = parseArgs();
    const boardId = deriveBoardId(board, id);
    const boardUrl = board && board.startsWith('http')
      ? board
      : `https://www.101soundboards.com/boards/${boardId}`;

    console.log(`Fetching board ${boardUrl}`);

    // 1) Try legacy embedded JSON (fast path)
    let html = await fetchText(boardUrl);
    let state = parseNuxtState(html);
    let clips = state ? extractClips(state) : [];

    // 2) Fallback: scrape DOM for /sound(s)/ links → resolve each to MP3
    if (!clips.length) {
      const rough = extractClipsFallback(html, boardUrl);
      const resolved = [];
      for (const item of rough) {
        const got = await resolveSoundToMp3(item.href);
        if (got && got.url) {
          resolved.push({ title: got.title, url: got.url, duration: 0, tags: [] });
        }
      }
      clips = resolved;
    }

    if (!clips.length) {
      throw new Error('Could not locate board data in page payload');
    }

    const enriched = await downloadClips(boardId, clips, {
      concurrency: concurrency ?? 4,
      delayMs: delayMs ?? 0,
      resume: !!resume
    });

    // Derive a title from the page if not provided
    let boardTitle = title;
    if (!boardTitle) {
      const $ = cheerio.load(html);
      boardTitle = normaliseString($('h1').first().text() || $('title').text()) || boardId;
    }

    await writeBoardIndex(boardId, boardTitle, enriched);
    console.log(`Imported ${enriched.length} clips into board '${boardId}'.`);
  } catch (err) {
    console.error('[download-101-soundboard] Error:', err.message);
    process.exitCode = 1;
  }
})();
