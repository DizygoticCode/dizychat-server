'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const cheerio = require('cheerio');
const crypto = require('crypto');
const { normalizeSoundboardAudio } = require('./audio-normalizer');

const DEFAULT_DATA_ROOT = path.join(__dirname, '..', '..', 'data', 'soundboards');
const DEFAULT_PUBLIC_ROOT = path.join(__dirname, '..', '..', 'public', 'soundboards');
const BOARD_HOSTS = new Set(['101soundboards.com', 'www.101soundboards.com']);
const MCP_SEARCH_URL = 'https://www.101soundboards.com/mcp/search';
const MCP_PROTOCOL_VERSION = '2025-06-18';
const MAX_CLIPS = 10_000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_AUDIO_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_FETCH_TIMEOUT_MS = 8_000;

const normalise = (value) => typeof value === 'string' ? value.trim() : '';

const normaliseFetchTimeoutMs = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_FETCH_TIMEOUT_MS;
  return Math.min(parsed, 60_000);
};

const withFetchTimeout = async (
  fetchImpl,
  url,
  options = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  consumeResponse,
) => {
  if (typeof consumeResponse !== 'function') throw new Error('consumeResponse is required');
  if (typeof AbortController !== 'function') {
    return consumeResponse(await fetchImpl(url, options));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), normaliseFetchTimeoutMs(timeoutMs));
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    return await consumeResponse(response);
  } catch (error) {
    if (controller.signal.aborted) {
      const timeoutError = new Error('101Soundboards request timed out.');
      timeoutError.code = 'UPSTREAM_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const readBoundedResponse = async (response, maxBytes, errorMessage) => {
  const declared = Number(response?.headers?.get?.('content-length') || 0);
  if (declared && maxBytes && declared > maxBytes) throw new Error(errorMessage);

  const body = response?.body;
  if (body && typeof body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    let total = 0;
    for await (const chunk of body) {
      const buffer = Buffer.from(chunk);
      total += buffer.length;
      if (maxBytes && total > maxBytes) throw new Error(errorMessage);
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, total);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (maxBytes && buffer.length > maxBytes) throw new Error(errorMessage);
  return buffer;
};

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

const parseSoundPageUrl = (raw) => {
  let parsed;
  try {
    parsed = new URL(normalise(raw));
  } catch {
    throw new Error('Choose a valid 101Soundboards sound.');
  }

  if (parsed.protocol !== 'https:' || !isAllowed101Host(parsed.hostname)) {
    throw new Error('Only HTTPS 101Soundboards sound URLs can be imported.');
  }

  if (!/^\/sounds\/\d+(?:[-a-z0-9_%]*)\/?$/i.test(parsed.pathname)) {
    throw new Error('Choose a 101Soundboards /sounds/... URL.');
  }

  parsed.protocol = 'https:';
  parsed.hostname = 'www.101soundboards.com';
  parsed.port = '';
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = parsed.pathname.replace(/\/$/, '');

  return { url: parsed.toString() };
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

const soundLabelFromUrl = (raw) => {
  try {
    const parsed = new URL(raw, 'https://www.101soundboards.com/');
    const match = parsed.pathname.match(/^\/sounds\/\d+(?:-([^/?#]+))?\/?$/i);
    const slug = match?.[1] || '';
    if (!slug) return '';
    return decodeURIComponent(slug)
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  } catch {
    return '';
  }
};

const cleanSoundLabel = (value, rawUrl = '') => {
  const cleaned = normalise(value)
    .replace(/your browser does not support the audio element\.?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || soundLabelFromUrl(rawUrl);
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
    if (!url || !/^\/sounds\/\d+(?:[-a-z0-9_%]*)\/?$/i.test(url.pathname)) return;
    url.search = '';
    url.hash = '';
    const href = url.toString().replace(/\/$/, '');
    if (!soundPages.has(href)) {
      soundPages.set(href, cleanSoundLabel(label, href));
    }
  };

  $('a[href*="/sounds/"]').each((_, el) => addSoundPage(
    $(el).attr('href'),
    $(el).attr('title')
      || $(el).attr('aria-label')
      || $(el).attr('data-title')
      || $(el).find('[data-title]').first().attr('data-title')
      || $(el).find('img[alt]').first().attr('alt')
      || $(el).text()
  ));
  $('[data-href*="/sounds/"]').each((_, el) => addSoundPage(
    $(el).attr('data-href'),
    $(el).attr('title')
      || $(el).attr('aria-label')
      || $(el).attr('data-title')
      || $(el).text()
  ));

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

const extractSearchBoards = (html, searchUrl, query = '') => {
  if (challengeDetected(html)) {
    const error = new Error('101Soundboards requires browser approval before live search can continue.');
    error.code = 'BROWSER_APPROVAL_REQUIRED';
    throw error;
  }

  const $ = cheerio.load(String(html || ''));
  const boards = new Map();
  const normaliseSearchText = (value) => normalise(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const searchNeedle = normaliseSearchText(query);
  const searchTerms = searchNeedle.split(' ').filter((term) => term.length >= 2);
  const promotionalBoards = new Set([
    'create-a-new-soundboard',
    'create-new-soundboard',
    'create-your-own-soundboard',
    'clone-my-voice',
    'clone-your-voice',
    'free-song-maker',
  ]);

  const isPromotionalBoard = (title, boardId) => {
    const slug = String(boardId || '').replace(/^\d+-/, '');
    if (promotionalBoards.has(slug)) return true;
    const label = normaliseSearchText(title);
    return promotionalBoards.has(label.replace(/\s+/g, '-'));
  };

  const relevanceScore = (title, boardId) => {
    if (!searchTerms.length) return 1;
    const haystack = normaliseSearchText(`${title} ${String(boardId || '').replace(/[-_]+/g, ' ')}`);
    if (!haystack) return 0;

    let score = haystack.includes(searchNeedle) ? 100 : 0;
    let matched = 0;
    searchTerms.forEach((term) => {
      if (haystack.includes(term)) matched += 1;
    });
    score += matched * 10;
    if (matched === searchTerms.length && matched > 0) score += 25;
    return score;
  };

  let order = 0;
  $('a[href*="/boards/"]').each((_, el) => {
    const rawHref = $(el).attr('href');
    const url = ensureAllowed101Url(rawHref, searchUrl);
    if (!url || !/^\/boards\/[^/]+\/?$/i.test(url.pathname)) return;

    let parsed;
    try {
      parsed = parseBoardUrl(url.toString());
    } catch {
      return;
    }

    const rawTitle = normalise(
      $(el).attr('title')
        || $(el).attr('aria-label')
        || $(el).find('img[alt]').first().attr('alt')
        || $(el).text()
    ).replace(/\s+/g, ' ');
    const fallbackTitle = parsed.boardId
      .replace(/^\d+-/, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
    const title = rawTitle || fallbackTitle;
    if (!title || isPromotionalBoard(title, parsed.boardId)) return;

    const score = relevanceScore(title, parsed.boardId);
    const candidate = {
      provider: '101soundboards',
      boardId: parsed.boardId,
      title: title.slice(0, 180),
      url: parsed.url,
    };
    const existing = boards.get(parsed.url);
    if (!existing || score > existing.score) {
      boards.set(parsed.url, { result: candidate, score, order: order++ });
    }
  });

  return Array.from(boards.values())
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((entry) => entry.result);
};

const parseMcpMessage = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    // Streamable HTTP can return Server-Sent Events instead of plain JSON.
  }

  const messages = [];
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
      .trim();
    if (!data || data === '[DONE]') continue;
    try {
      messages.push(JSON.parse(data));
    } catch {
      // Ignore non-JSON SSE keepalive/progress events.
    }
  }

  return messages.find((message) => message && (message.result !== undefined || message.error))
    || messages.at(-1)
    || null;
};

const extractMcpSearchBoards = (message, query = '') => {
  const boards = new Map();
  let order = 0;
  const normaliseSearchText = (value) => normalise(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const searchNeedle = normaliseSearchText(query);
  const searchTerms = searchNeedle.split(' ').filter((term) => term.length >= 2);
  const promotionalBoards = new Set([
    'create-a-new-soundboard',
    'create-new-soundboard',
    'create-your-own-soundboard',
    'clone-my-voice',
    'clone-your-voice',
    'free-song-maker',
  ]);

  const isPromotionalBoard = (title, boardId) => {
    const slug = String(boardId || '').replace(/^\d+-/, '');
    if (promotionalBoards.has(slug)) return true;
    const label = normaliseSearchText(title);
    return promotionalBoards.has(label.replace(/\s+/g, '-'));
  };

  const relevanceScore = (title, boardId) => {
    if (!searchTerms.length) return 1;
    const haystack = normaliseSearchText(
      String(title || '') + ' ' + String(boardId || '').replace(/[-_]+/g, ' ')
    );
    if (!haystack) return 0;
    let score = haystack.includes(searchNeedle) ? 100 : 0;
    let matched = 0;
    searchTerms.forEach((term) => {
      if (haystack.includes(term)) matched += 1;
    });
    score += matched * 10;
    if (matched === searchTerms.length && matched > 0) score += 25;
    return score;
  };

  const addBoard = (rawUrl, rawTitle = '') => {
    let parsed;
    try {
      const url = ensureAllowed101Url(rawUrl, MCP_SEARCH_URL);
      if (!url || !/^\/boards\/[^/]+\/?$/i.test(url.pathname)) return;
      parsed = parseBoardUrl(url.toString());
    } catch {
      return;
    }

    const fallbackTitle = parsed.boardId
      .replace(/^\d+-/, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
    const title = normalise(rawTitle).replace(/\s+/g, ' ') || fallbackTitle;
    if (!title || isPromotionalBoard(title, parsed.boardId)) return;

    const score = relevanceScore(title, parsed.boardId);
    const existing = boards.get(parsed.url);
    if (!existing || score > existing.score) {
      boards.set(parsed.url, {
        score,
        order: order++,
        result: {
          provider: '101soundboards',
          boardId: parsed.boardId,
          title: title.slice(0, 180),
          url: parsed.url,
        },
      });
    }
  };

  const visit = (value) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (typeof value === 'object') {
      const rawUrl = [
        value.url,
        value.href,
        value.boardUrl,
        value.board_url,
        value.link,
      ].find((candidate) => typeof candidate === 'string' && candidate.includes('/boards/'));
      const rawTitle = [
        value.title,
        value.name,
        value.boardTitle,
        value.board_title,
        value.label,
      ].find((candidate) => typeof candidate === 'string');
      if (rawUrl) addBoard(rawUrl, rawTitle || '');

      Object.values(value).forEach((child) => {
        if (child !== rawUrl && child !== rawTitle) visit(child);
      });
      return;
    }

    if (typeof value !== 'string') return;
    const text = value.trim();
    if (!text) return;

    if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
      try {
        visit(JSON.parse(text));
        return;
      } catch {
        // Fall through to URL discovery for human-readable MCP text.
      }
    }

    const boardUrlRegex = /(?:https:\/\/(?:www\.)?101soundboards\.com)?\/boards\/[a-z0-9_%.-]+/gi;
    let match;
    while ((match = boardUrlRegex.exec(text))) addBoard(match[0], '');
  };

  visit(message && message.result !== undefined ? message.result : message);

  return Array.from(boards.values())
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((entry) => entry.result);
};

const postMcpMessage = async (fetchImpl, payload, sessionId = '', timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) => {
  const headers = {
    'User-Agent': 'DizyChat Soundboard Importer/1.0',
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  return withFetchTimeout(fetchImpl, MCP_SEARCH_URL, {
    method: 'POST',
    redirect: 'manual',
    headers,
    body: JSON.stringify(payload),
  }, timeoutMs, async (response) => {
    if (!response || !response.ok) {
      const error = new Error(
        '101Soundboards MCP search failed with HTTP ' + String(response && response.status || 0) + '.'
      );
      error.code = response && (response.status === 403 || response.status === 429)
        ? 'BROWSER_APPROVAL_REQUIRED'
        : 'UPSTREAM_HTTP_ERROR';
      throw error;
    }

    const buffer = await readBoundedResponse(
      response,
      MAX_PAGE_BYTES,
      '101Soundboards MCP response exceeded the importer size limit.',
    );

    const message = parseMcpMessage(buffer.toString('utf8'));
    if (message && message.error) {
      const error = new Error(
        normalise(message.error && message.error.message) || '101Soundboards MCP search returned an error.'
      );
      error.code = 'UPSTREAM_MCP_ERROR';
      throw error;
    }

    return {
      message,
      sessionId: normalise(response.headers && response.headers.get && response.headers.get('mcp-session-id')) || sessionId,
    };
  });
};

const searchBoardsViaMcp = async (fetchImpl, { query, limit, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS }) => {
  const initialized = await postMcpMessage(fetchImpl, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'DizyChat',
        version: '1.0',
      },
    },
  }, '', timeoutMs);

  if (!initialized.message || !initialized.message.result) {
    const error = new Error('101Soundboards MCP search did not initialize correctly.');
    error.code = 'UPSTREAM_MCP_ERROR';
    throw error;
  }

  await postMcpMessage(fetchImpl, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  }, initialized.sessionId, timeoutMs);

  const searched = await postMcpMessage(fetchImpl, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'board-search-tool',
      arguments: {
        search_term: query,
        limit,
        only_tts: false,
        record_source: 'dizychat',
      },
    },
  }, initialized.sessionId, timeoutMs);

  return extractMcpSearchBoards(searched.message, query).slice(0, limit);
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

const fetchResponse = async (fetchImpl, rawUrl, { maxBytes, binary = false, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS } = {}) => {
  let url = ensureAllowed101Url(rawUrl, 'https://www.101soundboards.com/');
  if (!url) throw new Error('Blocked non-101Soundboards fetch target.');

  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const step = await withFetchTimeout(fetchImpl, url.toString(), {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': 'DizyChat Soundboard Importer/1.0',
        Accept: binary ? 'audio/*,application/octet-stream;q=0.8,*/*;q=0.1' : 'text/html,application/xhtml+xml',
      },
    }, timeoutMs, async (response) => {
      if (response?.status >= 300 && response?.status < 400) {
        return { redirect: true, location: response.headers?.get?.('location') || '' };
      }

      if (!response?.ok) {
        const error = new Error(`101Soundboards request failed with HTTP ${response?.status || 0}.`);
        error.code = response?.status === 403 || response?.status === 429 ? 'BROWSER_APPROVAL_REQUIRED' : 'UPSTREAM_HTTP_ERROR';
        throw error;
      }

      const finalUrl = ensureAllowed101Url(response.url || url.toString(), url.toString());
      if (!finalUrl) throw new Error('101Soundboards response escaped its allowed host boundary.');

      const buffer = await readBoundedResponse(
        response,
        maxBytes,
        '101Soundboards response exceeded the importer size limit.',
      );

      return {
        redirect: false,
        result: {
          buffer,
          url: finalUrl.toString(),
          contentType: normalise(response.headers?.get?.('content-type')),
        },
      };
    });

    if (!step.redirect) return step.result;

    const next = step.location ? ensureAllowed101Url(step.location, url.toString()) : null;
    if (!next) throw new Error('101Soundboards redirect was blocked by the importer host boundary.');
    if (redirects === 4) throw new Error('101Soundboards returned too many redirects.');
    url = next;
  }

  throw new Error('101Soundboards request did not complete.');
};

const createSoundboardImporter = ({
  fetchImpl,
  dataRoot = DEFAULT_DATA_ROOT,
  publicRoot = DEFAULT_PUBLIC_ROOT,
  normalizeAudioImpl = normalizeSoundboardAudio,
  fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
} = {}) => {
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');
  const safeFetchTimeoutMs = normaliseFetchTimeoutMs(fetchTimeoutMs);
  const fetch101Response = (rawUrl, options = {}) => fetchResponse(fetchImpl, rawUrl, {
    ...options,
    timeoutMs: safeFetchTimeoutMs,
  });

  const importBoard = async ({
    boardUrl,
    replaceExisting = false,
    onlySoundPageUrl = '',
    onProgress = () => {},
  } = {}) => {
    const parsedBoard = parseBoardUrl(boardUrl);
    const boardFile = path.join(dataRoot, `${parsedBoard.boardId}.json`);
    const indexFile = path.join(dataRoot, 'index.json');
    const targetDir = path.join(publicRoot, parsedBoard.boardId);

    await onProgress({ phase: 'board', message: 'Fetching board page…', current: 0, total: 0 });
    const boardResponse = await fetch101Response(parsedBoard.url, { maxBytes: MAX_PAGE_BYTES });
    const boardHtml = boardResponse.buffer.toString('utf8');
    const board = extractBoard(boardHtml, parsedBoard.url);

    if (onlySoundPageUrl) {
      const selected = parseSoundPageUrl(onlySoundPageUrl).url;
      board.clips = board.clips.filter((clip) => clip.soundPageUrl === selected);
      if (!board.clips.length) {
        const error = new Error('That sound is not part of the selected 101Soundboards board.');
        error.code = 'SOUNDBOARD_CLIP_NOT_FOUND';
        throw error;
      }
    }

    const existingBoard = await readJson(boardFile, null);
    const existingItems = Array.isArray(existingBoard?.items) ? existingBoard.items.slice() : [];
    const workingItems = existingItems.slice();
    const existingBySource = new Map();
    const existingByTitle = new Map();
    existingItems.forEach((item, index) => {
      const sourceKey = normalise(item?.sourceUrl);
      const titleKey = normalise(item?.title).toLowerCase();
      if (sourceKey && !existingBySource.has(sourceKey)) existingBySource.set(sourceKey, index);
      if (titleKey && !existingByTitle.has(titleKey)) existingByTitle.set(titleKey, index);
    });

    await fsp.mkdir(targetDir, { recursive: true });
    let imported = 0;
    let replaced = 0;
    let skipped = 0;
    let failed = 0;
    let totalBytes = 0;
    const obsoleteFiles = new Set();

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
      let existingIndex = existingBySource.has(clipRef.soundPageUrl)
        ? existingBySource.get(clipRef.soundPageUrl)
        : (clipLabelKey && existingByTitle.has(clipLabelKey)
          ? existingByTitle.get(clipLabelKey)
          : -1);
      let existingItem = existingIndex >= 0 ? workingItems[existingIndex] : null;

      if (existingItem && !replaceExisting) {
        skipped += 1;
        await onProgress({ ...progressBase, message: `Skipping existing clip ${index + 1}/${board.clips.length}.` });
        continue;
      }

      try {
        const soundPage = await fetch101Response(clipRef.soundPageUrl, { maxBytes: MAX_PAGE_BYTES });
        const clip = extractSound(soundPage.buffer.toString('utf8'), clipRef.soundPageUrl, clipRef.label);
        if (!clip) {
          failed += 1;
          await onProgress({ ...progressBase, message: `No downloadable audio found for clip ${index + 1}.` });
          continue;
        }

        if (!existingItem) {
          const resolvedTitleKey = normalise(clip.title).toLowerCase();
          if (resolvedTitleKey && existingByTitle.has(resolvedTitleKey)) {
            existingIndex = existingByTitle.get(resolvedTitleKey);
            existingItem = workingItems[existingIndex] || null;
            if (existingItem && !replaceExisting) {
              skipped += 1;
              await onProgress({ ...progressBase, message: `Skipping existing clip ${index + 1}/${board.clips.length}.` });
              continue;
            }
          }
        }

        const audio = await fetch101Response(clip.url, { maxBytes: MAX_AUDIO_BYTES, binary: true });
        totalBytes += audio.buffer.length;
        if (totalBytes > MAX_TOTAL_AUDIO_BYTES) {
          throw new Error('Board import exceeded the total audio size limit.');
        }

        const filenameBase = safeSlug(clip.title, `clip-${index + 1}`);
        const fingerprint = sha256(audio.buffer).slice(0, 10);
        const filename = `${filenameBase}-${fingerprint}.m4a`;
        const targetPath = path.join(targetDir, filename);

        if (!fs.existsSync(targetPath)) {
          await normalizeAudioImpl({
            sourceBuffer: audio.buffer,
            targetPath,
            sourceUrl: audio.url,
          });
        }

        const item = {
          id: existingItem?.id || `${parsedBoard.boardId}-${sha256(clip.soundPageUrl).slice(0, 16)}`,
          title: clip.title,
          tags: Array.isArray(clip.tags) && clip.tags.length ? clip.tags : (existingItem?.tags || []),
          duration: clip.duration || Number(existingItem?.duration || 0),
          file: `${parsedBoard.boardId}/${filename}`,
          sourceUrl: clip.soundPageUrl,
          normalized: true,
          normalization: {
            targetLufs: -16,
            truePeakDb: -1.5,
            sampleRate: 48000,
            codec: 'aac',
          },
        };

        if (existingItem) {
          const previousFile = normalise(existingItem.file);
          workingItems[existingIndex] = item;
          existingBySource.set(clip.soundPageUrl, existingIndex);
          existingByTitle.set(normalise(clip.title).toLowerCase(), existingIndex);
          if (previousFile && previousFile !== item.file) obsoleteFiles.add(previousFile);
          replaced += 1;
          await onProgress({ ...progressBase, message: `Rebuilt and normalized ${clip.title}.` });
        } else {
          const nextIndex = workingItems.length;
          workingItems.push(item);
          existingBySource.set(clip.soundPageUrl, nextIndex);
          existingByTitle.set(normalise(clip.title).toLowerCase(), nextIndex);
          imported += 1;
          await onProgress({ ...progressBase, message: `Imported and normalized ${clip.title}.` });
        }
      } catch (error) {
        if (error?.code === 'BROWSER_APPROVAL_REQUIRED') throw error;
        failed += 1;
        await onProgress({ ...progressBase, message: `Skipped one unavailable clip: ${error?.message || 'download failed'}` });
      }
    }

    const mergedItems = workingItems;
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

    const referencedFiles = new Set(mergedItems.map((item) => normalise(item?.file)).filter(Boolean));
    for (const staleFile of obsoleteFiles) {
      if (referencedFiles.has(staleFile)) continue;
      const prefix = `${parsedBoard.boardId}/`;
      if (!staleFile.startsWith(prefix)) continue;
      const relative = staleFile.slice(prefix.length);
      if (!relative || relative.includes('..') || relative.includes('\\') || relative.includes('/')) continue;
      try {
        await fsp.unlink(path.join(targetDir, relative));
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          console.warn('[Soundboard Import] Could not remove replaced audio file', {
            boardId: parsedBoard.boardId,
            file: relative,
            error: error?.message || error,
          });
        }
      }
    }

    await onProgress({
      phase: 'complete',
      current: board.clips.length,
      total: board.clips.length,
      message: `Import complete: ${imported} added, ${replaced} rebuilt, ${skipped} already present, ${failed} unavailable.`,
    });

    return {
      boardId: parsedBoard.boardId,
      boardTitle: nextBoard.title,
      discovered: board.discovered,
      processed: board.clips.length,
      imported,
      replaced,
      skipped,
      failed,
      totalItems: mergedItems.length,
      truncated: board.discovered > board.clips.length,
    };
  };

  const searchBoards = async ({ query, limit = 24 } = {}) => {
    const q = normalise(query).replace(/\s+/g, ' ').slice(0, 120);
    if (q.length < 3) return { provider: '101soundboards', query: q, results: [] };

    const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 24, 1), 50);
    try {
      const results = await searchBoardsViaMcp(fetchImpl, { query: q, limit: safeLimit, timeoutMs: safeFetchTimeoutMs });
      return { provider: '101soundboards', query: q, results };
    } catch (error) {
      if (error && error.code === 'BROWSER_APPROVAL_REQUIRED') throw error;
      console.warn('[Soundboard Search] Official 101Soundboards search unavailable; using HTML fallback', {
        error: error && error.message || error,
      });
    }

    const searchUrl = 'https://www.101soundboards.com/search/' + encodeURIComponent(q);
    const response = await fetch101Response(searchUrl, { maxBytes: MAX_PAGE_BYTES });
    const results = extractSearchBoards(response.buffer.toString('utf8'), response.url, q).slice(0, safeLimit);
    return { provider: '101soundboards', query: q, results };
  };

  const browseBoard = async ({ boardUrl, limit = 80 } = {}) => {
    const parsedBoard = parseBoardUrl(boardUrl);
    const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 80, 1), 200);
    const response = await fetch101Response(parsedBoard.url, { maxBytes: MAX_PAGE_BYTES });
    const board = extractBoard(response.buffer.toString('utf8'), parsedBoard.url);
    const clips = board.clips.slice(0, safeLimit).map((clip) => ({
      provider: '101soundboards',
      title: cleanSoundLabel(clip.label, clip.soundPageUrl) || 'Sound clip',
      soundPageUrl: clip.soundPageUrl,
    }));

    return {
      provider: '101soundboards',
      boardId: parsedBoard.boardId,
      title: board.title,
      url: parsedBoard.url,
      total: board.discovered,
      clips,
      truncated: board.discovered > clips.length,
    };
  };

  const resolveClip = async ({ soundPageUrl } = {}) => {
    const parsedSound = parseSoundPageUrl(soundPageUrl);
    const response = await fetch101Response(parsedSound.url, { maxBytes: MAX_PAGE_BYTES });
    const clip = extractSound(response.buffer.toString('utf8'), parsedSound.url);
    if (!clip) {
      const error = new Error('No playable audio was found for that 101Soundboards sound.');
      error.code = 'SOUNDBOARD_CLIP_UNAVAILABLE';
      throw error;
    }

    return {
      provider: '101soundboards',
      title: clip.title,
      soundPageUrl: clip.soundPageUrl,
      audioUrl: clip.url,
      duration: clip.duration,
    };
  };

  return { importBoard, searchBoards, browseBoard, resolveClip };
};

module.exports = {
  MAX_CLIPS,
  parseBoardUrl,
  parseSoundPageUrl,
  challengeDetected,
  extractBoard,
  extractSearchBoards,
  extractMcpSearchBoards,
  extractSound,
  createSoundboardImporter,
};
