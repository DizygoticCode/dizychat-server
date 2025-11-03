#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const https = require('https');
const { URL } = require('url');

const cheerio = require('cheerio');

const SOUND_DATA_DIR = path.join(__dirname, '..', 'data', 'soundboards');
const SOUND_PUBLIC_DIR = path.join(__dirname, '..', 'public', 'soundboards');

const USER_AGENT = 'Mozilla/5.0 (compatible; DizychAtSoundboardBot/1.0)';

const normaliseString = (value) =>
  typeof value === 'string' ? value.trim() : '';

const ensureDir = async (targetPath) => {
  await fsPromises.mkdir(targetPath, { recursive: true });
};

const fetchText = (url) => new Promise((resolve, reject) => {
  const requestUrl = typeof url === 'string' ? url : url.toString();
  https.get(requestUrl, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
    if (res.statusCode && res.statusCode >= 400) {
      reject(new Error(`Request failed with status ${res.statusCode}`));
      res.resume();
      return;
    }

    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  }).on('error', reject);
});

const fetchBinary = (url) => new Promise((resolve, reject) => {
  const requestUrl = typeof url === 'string' ? url : url.toString();
  https.get(requestUrl, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
    if (res.statusCode && res.statusCode >= 400) {
      reject(new Error(`Request failed with status ${res.statusCode}`));
      res.resume();
      return;
    }

    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
  }).on('error', reject);
});

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
      try {
        return JSON.parse(nuxtMatch[1]);
      } catch (err) {
        // continue trying other scripts
      }
    }
    const jsonMatch = script.match(/=\s*(\{\s*"data"[\s\S]+\})\s*;?$/s);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch (err) {
        // try next
      }
    }
  }
  return null;
};

const flatten = (input, results = []) => {
  if (!input) return results;
  if (Array.isArray(input)) {
    input.forEach((item) => flatten(item, results));
    return results;
  }
  if (typeof input === 'object') {
    results.push(input);
    Object.values(input).forEach((value) => flatten(value, results));
  }
  return results;
};

const extractClips = (state) => {
  const candidates = flatten(state);
  const clips = [];
  candidates.forEach((candidate) => {
    if (!candidate || typeof candidate !== 'object') return;
    const possibleUrl = normaliseString(
      candidate.url || candidate.soundUrl || candidate.downloadUrl || candidate.sound || candidate.audio,
    );
    if (!possibleUrl || !/\.(mp3|wav|ogg|m4a|aac)(?:\?|$)/i.test(possibleUrl)) return;
    const title = normaliseString(candidate.title || candidate.name || candidate.label || candidate.slug);
    const duration = Number(candidate.duration || candidate.length || candidate.time) || 0;
    const tagsRaw = candidate.tags || candidate.categories || candidate.keywords;
    const tags = Array.isArray(tagsRaw)
      ? tagsRaw.map((tag) => normaliseString(tag)).filter(Boolean)
      : normaliseString(tagsRaw).split(',').map((tag) => tag.trim()).filter(Boolean);
    clips.push({ url: possibleUrl, title: title || 'Sound Clip', duration, tags });
  });
  return clips;
};

const writeBoardIndex = async (boardId, boardTitle, clips) => {
  const boardFilePath = path.join(SOUND_DATA_DIR, `${boardId}.json`);
  await ensureDir(SOUND_DATA_DIR);
  await fsPromises.writeFile(boardFilePath, JSON.stringify({
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
  }, null, 2));

  const indexFilePath = path.join(SOUND_DATA_DIR, 'index.json');
  let indexData = { boards: [] };
  try {
    const raw = await fsPromises.readFile(indexFilePath, 'utf8');
    indexData = JSON.parse(raw);
  } catch (err) {
    // create new index
  }
  if (!Array.isArray(indexData.boards)) {
    indexData.boards = [];
  }
  if (!indexData.boards.includes(boardId)) {
    indexData.boards.push(boardId);
  }
  await fsPromises.writeFile(indexFilePath, `${JSON.stringify(indexData, null, 2)}\n`);
};

const downloadClips = async (boardId, clips) => {
  const targetDir = path.join(SOUND_PUBLIC_DIR, boardId);
  await ensureDir(targetDir);
  const enriched = [];
  for (const clip of clips) {
    const clipUrl = new URL(clip.url, 'https://www.101soundboards.com');
    const extensionMatch = clipUrl.pathname.match(/\.([a-z0-9]+)$/i);
    const extension = extensionMatch ? extensionMatch[1].toLowerCase() : 'mp3';
    const safeSlug = normaliseString(clip.title).replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'clip';
    const filename = `${safeSlug}.${extension}`;
    const filePath = path.join(targetDir, filename);
    console.log(`Downloading ${clip.title} → ${filename}`);
    const data = await fetchBinary(clipUrl.toString());
    await fsPromises.writeFile(filePath, data);
    enriched.push({ ...clip, filename });
  }
  return enriched;
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--board' || arg === '-b') {
      result.board = args[i + 1];
      i += 1;
    } else if (arg === '--id') {
      result.id = args[i + 1];
      i += 1;
    } else if (arg === '--title') {
      result.title = args[i + 1];
      i += 1;
    }
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

(async () => {
  try {
    const { board, id, title } = parseArgs();
    const boardId = deriveBoardId(board, id);
    const boardUrl = board && board.startsWith('http')
      ? board
      : `https://www.101soundboards.com/boards/${boardId}`;
    console.log(`Fetching board ${boardUrl}`);
    const html = await fetchText(boardUrl);
    const state = parseNuxtState(html);
    if (!state) {
      throw new Error('Could not locate board data in page payload');
    }
    const clips = extractClips(state);
    if (!clips.length) {
      throw new Error('No downloadable clips discovered in board data');
    }
    const enriched = await downloadClips(boardId, clips);
    const boardTitle = title || normaliseString(state?.data?.[0]?.board?.title || state?.data?.[0]?.soundboard?.title) || boardId;
    await writeBoardIndex(boardId, boardTitle, enriched);
    console.log(`Imported ${enriched.length} clips into board '${boardId}'.`);
  } catch (err) {
    console.error('[download-101-soundboard] Error:', err.message);
    process.exitCode = 1;
  }
})();
