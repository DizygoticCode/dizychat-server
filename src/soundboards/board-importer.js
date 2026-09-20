'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const cheerio = require('cheerio');
const crypto = require('crypto');

const DEFAULT_DATA_ROOT = path.join(__dirname, '..', '..', 'data', 'soundboards');
const DEFAULT_PUBLIC_ROOT = path.join(__dirname, '..', '..', 'public', 'soundboards');
const BOARD_HOSTS = new Set(['101soundboards.com', 'www.101soundboards.com']);
const MAX_CLIPS = 500;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_AUDIO_BYTES = 256 * 1024 * 1024;

const normalise = (value) => typeof value === 'string' ? value.trim() : '';

const isAllowed101Host = (hostname) => {
  const host = normalise(hostname).toLowerCase().replace(/\.$/, '');
  return BOARD_HOSTS.has(host) || host.endsWith('.101soundboards.com');
};

const parseBoardUrl = (raw) => {
  let parsed;
  try {
    parsed = new URL(normalise(raw));
  } catch {
    throw new Error('Paste a valid 101Soundboards board URL.');
  }

  if (parsed.protocol !== 'https:' || !isAllowed101Host(parsed.hostname)) {
    throw new Error('Only HTTPS 101Soundboards board URLs can be imported.');
  }

  const match = parsed.pathname.match(/^\/boards\/([^/?#]+)\/?$/i);
  if (!match) throw new Error('Paste a 101Soundboards /boards/... URL.');

  const boardId = decodeURIComponent(match[1])
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
  if (!boardId) throw new Error('Could not derive a safe board ID from that URL.');

  parsed.protocol = 'https:';
  parsed.hostname = 'www.101soundboards.com';
  parsed.port = '';
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = `/boards/${boardId}`;

  return { url: parsed.toString(), boardId };
};

const challengeDetected = (html) => {
  const text = String(html || '').toLowerCase();
  return [
    'hcaptcha',
    'g-recaptcha',
    'cf-chl-',
    'verify you are human',
    'checking your browser',
    'attention required',
  ].some((needle) => text.includes(needle));
};

const ensureAllowed101Url = (raw, baseUrl) => {
  let parsed;
  try {
    parsed = new URL(raw, baseUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !isAllowed101Host(parsed.hostname)) return null;
  parsed.username = '';
  parsed.password = '';
  parsed.hash = '';
  return parsed;
};

const extractBoard = (html, boardUrl) => {
  if (challengeDetected(html)) {
    const error = new Error('101Soundboards requires browser approval before this board can be imported.');
    error.code = 'BROWSER_APPROVAL_REQUIRED';
    throw error;
  }

  const $ = cheerio.load(String(html || ''));
  const title = normalise($('h1').first().text() || $('title').first().text()) || 'Imported Soundboard';
  const soundPages = new Map();

  const addSoundPage = (raw, label = '') => {
    const url = ensureAllowed101Url(raw, boardUrl);
    if (!url || !/^\/sounds\/[^/]+\/?$/i.test(url.pathname)) return;
    url.search = '';
    url.hash = '';
    const href = url.toString().replace(/\/$/, '');
    if (!soundPages.has(href)) {
      soundPages.set(href, normalise(label));
    }
  };

  $('a[href*="/sounds/"]').each((_, el) => addSoundPage($(el).attr('href'), $(el).text()));
  $('[data-href*="/sounds/"]').each((_, el) => addSoundPage($(el).attr('data-href'), $(el).text()));

  $('script').each((_, el) => {
    const source = $(el).html() || '';
    const regex = /(?:https:\/\/www\.101soundboards\.com)?(\/sounds\/[0-9]+[-a-z0-9_%]+)\b/gi;
    let match;
    while ((match = regex.exec(source))) addSoundPage(match[1], '');
  });

  const clips = Array.from(soundPages, ([url, label]) => ({ soundPageUrl: url, label }));
  if (!clips.length) {
    const error = new Error('No sound links were found on that board. It may require browser approval or the site layout may have changed.');
    error.code = 'NO_SOUND_LINKS';
    throw error;
  }

  return { title, clips: clips.slice(0, MAX_CLIPS), discovered: clips.length };
};

const cleanScriptUrl = (value) => normalise(value)
  .replace(/\\u002F/gi, '/')
  .replace(/\\\//g, '/')
  .replace(/&amp;/g, '&');

const extensionFor = (url, contentType = '') => {
  const pathname = (() => {
    try { return new URL(url).pathname; } catch { return ''; }
  })();
  const ext = (pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1] || '').toLowerCase();
  if (['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac'].includes(ext)) return ext;
  const type = String(contentType || '').toLowerCase();
  if (type.includes('wav')) return 'wav';
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('flac')) return 'flac';
  if (type.includes('mp4') || type.includes('m4a')) return 'm4a';
  if (type.includes('aac')) return 'aac';
  return 'mp3';
};

const extractSound = (html, soundPageUrl, fallbackLabel = '') => {
  if (challengeDetected(html)) {
    const error = new Error('101Soundboards requires browser approval before this sound can be imported.');
    error.code = 'BROWSER_APPROVAL_REQUIRED';
    throw error;
  }

  const $ = cheerio.load(String(html || ''));
  const candidates = [
    $('audio source[src]').first().attr('src'),
    $('audio[src]').first().attr('src'),
    $('a[download][href]').first().attr('href'),
    $('meta[property="og:audio"]').first().attr('content'),
    $('meta[property="og:audio:url"]').first().attr('content'),
    $('meta[name="twitter:player:stream"]').first().attr('content'),
  ].filter(Boolean);

  $('script').each((_, el) => {
    const source = cleanScriptUrl($(el).html() || '');
    const regex = /https:\/\/[^\s"'<>]+\.(?:mp3|wav|ogg|oga|m4a|aac|flac)(?:\?[^\s"'<>]*)?/gi;
    let match;
    while ((match = regex.exec(source))) candidates.push(match[0]);
  });

  let mediaUrl = null;
  for (const candidate of candidates) {
    const parsed = ensureAllowed101Url(cleanScriptUrl(candidate), soundPageUrl);
    if (!parsed) continue;
    mediaUrl = parsed.toString();
    break;
  }
  if (!mediaUrl) return null;

  const title = normalise(
    $('h1').first().text()
      || $('meta[property="og:title"]').first().attr('content')
      || fallbackLabel
  ) || 'Sound Clip';

  const durationText = normalise($('body').text()).match(/Length\s+(\d+(?:\.\d+)?)\s+seconds?/i)?.[1];
  return {
    title: title.slice(0, 180),
    url: mediaUrl,
    duration: Number(durationText || 0) || 0,
    tags: [],
    soundPageUrl,
  };
};

const safeSlug = (value, fallback = 'sound') => {
  const clean = normalise(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96);
  return clean || fallback;
};

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const atomicWriteJson = async (filePath, value) => {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fsp.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fsp.rename(temp, filePath);
};

const readJson = async (filePath, fallback) => {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
};

const fetchResponse = async (fetchImpl, rawUrl, { maxBytes, binary = false } = {}) => {
  let url = ensureAllowed101Url(rawUrl, 'https://www.101soundboards.com/');
  if (!url) throw new Error('Blocked non-101Soundboards fetch target.');

  let response;
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    response = await fetchImpl(url.toString(), {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': 'DizyChat Soundboard Importer/1.0',
        Accept: binary ? 'audio/*,application/octet-stream;q=0.8,*/*;q=0.1' : 'text/html,application/xhtml+xml',
      },
    });

    if (response?.status >= 300 && response?.status < 400) {
      const location = response.headers?.get?.('location');
      const next = location ? ensureAllowed101Url(location, url.toString()) : null;
      if (!next) throw new Error('101Soundboards redirect was blocked by the importer host boundary.');
      if (redirects === 4) throw new Error('101Soundboards returned too many redirects.');
      url = next;
      continue;
    }
    break;
  }

  if (!response?.ok) {
    const error = new Error(`101Soundboards request failed with HTTP ${response?.status || 0}.`);
    error.code = response?.status === 403 || response?.status === 429 ? 'BROWSER_APPROVAL_REQUIRED' : 'UPSTREAM_HTTP_ERROR';
    throw error;
  }

  const finalUrl = ensureAllowed101Url(response.url || url.toString(), url.toString());
  if (!finalUrl) throw new Error('101Soundboards response escaped its allowed host boundary.');

  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (declared && maxBytes && declared > maxBytes) throw new Error('101Soundboards response exceeded the importer size limit.');

  const buffer = Buffer.from(await response.arrayBuffer());
  if (maxBytes && buffer.length > maxBytes) throw new Error('101Soundboards response exceeded the importer size limit.');

  return {
    buffer,
    url: finalUrl.toString(),
    contentType: normalise(response.headers?.get?.('content-type')),
  };
};

const createSoundboardImporter = ({
  fetchImpl,
  dataRoot = DEFAULT_DATA_ROOT,
  publicRoot = DEFAULT_PUBLIC_ROOT,
} = {}) => {
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');

  const importBoard = async ({ boardUrl, onProgress = () => {} } = {}) => {
    const parsedBoard = parseBoardUrl(boardUrl);
    const boardFile = path.join(dataRoot, `${parsedBoard.boardId}.json`);
    const indexFile = path.join(dataRoot, 'index.json');
    const targetDir = path.join(publicRoot, parsedBoard.boardId);

    await onProgress({ phase: 'board', message: 'Fetching board page…', current: 0, total: 0 });
    const boardResponse = await fetchResponse(fetchImpl, parsedBoard.url, { maxBytes: MAX_PAGE_BYTES });
    const boardHtml = boardResponse.buffer.toString('utf8');
    const board = extractBoard(boardHtml, parsedBoard.url);

    const existingBoard = await readJson(boardFile, null);
    const existingItems = Array.isArray(existingBoard?.items) ? existingBoard.items.slice() : [];
    const existingKeys = new Set(existingItems.map((item) => normalise(item?.sourceUrl)).filter(Boolean));
    const existingTitles = new Set(
      existingItems.map((item) => normalise(item?.title).toLowerCase()).filter(Boolean)
    );

    await fsp.mkdir(targetDir, { recursive: true });
    let imported = 0;
    let skipped = 0;
    let failed = 0;
    let totalBytes = 0;
    const addedItems = [];

    await onProgress({
      phase: 'sounds',
      message: `Found ${board.clips.length} sound page(s).`,
      current: 0,
      total: board.clips.length,
    });

    for (let index = 0; index < board.clips.length; index += 1) {
      const clipRef = board.clips[index];
      const progressBase = {
        phase: 'sounds',
        current: index + 1,
        total: board.clips.length,
      };

      const clipLabelKey = normalise(clipRef.label).toLowerCase();
      if (existingKeys.has(clipRef.soundPageUrl) || (clipLabelKey && existingTitles.has(clipLabelKey))) {
        skipped += 1;
        await onProgress({ ...progressBase, message: `Skipping existing clip ${index + 1}/${board.clips.length}.` });
        continue;
      }

      try {
        const soundPage = await fetchResponse(fetchImpl, clipRef.soundPageUrl, { maxBytes: MAX_PAGE_BYTES });
        const clip = extractSound(soundPage.buffer.toString('utf8'), clipRef.soundPageUrl, clipRef.label);
        if (!clip) {
          failed += 1;
          await onProgress({ ...progressBase, message: `No downloadable audio found for clip ${index + 1}.` });
          continue;
        }

        const audio = await fetchResponse(fetchImpl, clip.url, { maxBytes: MAX_AUDIO_BYTES, binary: true });
        totalBytes += audio.buffer.length;
        if (totalBytes > MAX_TOTAL_AUDIO_BYTES) {
          throw new Error('Board import exceeded the total audio size limit.');
        }

        const extension = extensionFor(audio.url, audio.contentType);
        const filenameBase = safeSlug(clip.title, `clip-${index + 1}`);
        let filename = `${filenameBase}.${extension}`;
        let targetPath = path.join(targetDir, filename);

        if (fs.existsSync(targetPath)) {
          const fingerprint = sha256(clip.soundPageUrl).slice(0, 8);
          filename = `${filenameBase}-${fingerprint}.${extension}`;
          targetPath = path.join(targetDir, filename);
        }

        if (!fs.existsSync(targetPath)) {
          await fsp.writeFile(targetPath, audio.buffer, { flag: 'wx' });
        }

        const item = {
          id: `${parsedBoard.boardId}-${sha256(clip.soundPageUrl).slice(0, 16)}`,
          title: clip.title,
          tags: clip.tags,
          duration: clip.duration,
          file: `${parsedBoard.boardId}/${filename}`,
          sourceUrl: clip.soundPageUrl,
        };
        addedItems.push(item);
        existingKeys.add(clip.soundPageUrl);
        existingTitles.add(normalise(clip.title).toLowerCase());
        imported += 1;
        await onProgress({ ...progressBase, message: `Imported ${clip.title}.` });
      } catch (error) {
        if (error?.code === 'BROWSER_APPROVAL_REQUIRED') throw error;
        failed += 1;
        await onProgress({ ...progressBase, message: `Skipped one unavailable clip: ${error?.message || 'download failed'}` });
      }
    }

    const mergedItems = [...existingItems, ...addedItems];
    const nextBoard = {
      ...(existingBoard && typeof existingBoard === 'object' ? existingBoard : {}),
      id: parsedBoard.boardId,
      title: normalise(existingBoard?.title) || board.title || parsedBoard.boardId,
      source: '101soundboards',
      sourceUrl: parsedBoard.url,
      items: mergedItems,
    };

    await atomicWriteJson(boardFile, nextBoard);

    const index = await readJson(indexFile, { boards: [] });
    const boards = Array.isArray(index?.boards) ? index.boards.map(normalise).filter(Boolean) : [];
    if (!boards.includes(parsedBoard.boardId)) boards.push(parsedBoard.boardId);
    await atomicWriteJson(indexFile, { ...index, boards });

    await onProgress({
      phase: 'complete',
      current: board.clips.length,
      total: board.clips.length,
      message: `Import complete: ${imported} added, ${skipped} already present, ${failed} unavailable.`,
    });

    return {
      boardId: parsedBoard.boardId,
      boardTitle: nextBoard.title,
      discovered: board.discovered,
      processed: board.clips.length,
      imported,
      skipped,
      failed,
      totalItems: mergedItems.length,
      truncated: board.discovered > board.clips.length,
    };
  };

  return { importBoard };
};

module.exports = {
  MAX_CLIPS,
  parseBoardUrl,
  challengeDetected,
  extractBoard,
  extractSound,
  createSoundboardImporter,
};
