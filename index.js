// ===== DIZYCHAT FUSION — SUPERNOVA LIVE (Render Edition) =====
require('dotenv').config();

// ---------------- Imports ----------------
const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');
const cheerio = require('cheerio');
const fs = require('fs');
const multer = require('multer');
const sanitizeHtml = require('sanitize-html');
const Message = require('./src/models/message');
const soundboardStore = require('./src/utils/soundboard');

const nodeFetchModulePromise = import('node-fetch');
const fetch = (...args) =>
  nodeFetchModulePromise.then(({ default: fetch }) => fetch(...args));

// ---------------- App Setup ----------------
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] }
});
const PORT = process.env.PORT || 10000;

// ---------------- Admin ----------------
const normaliseAdminUsername = (value) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const buildAdminCredentials = () => {
  const entries = new Map();

  const addCredential = (username, password) => {
    if (typeof username !== 'string' || typeof password !== 'string') return;
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();
    if (!trimmedUsername || !trimmedPassword) return;
    const key = normaliseAdminUsername(trimmedUsername);
    if (!key) return;
    entries.set(key, {
      username: trimmedUsername,
      password: trimmedPassword,
    });
  };

  // ADMIN_CREDENTIALS format: "username:password,OtherUser:otherPassword"
  const rawList = process.env.ADMIN_CREDENTIALS;
  if (typeof rawList === 'string' && rawList.trim()) {
    rawList
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((entry) => {
        const [rawUsername, ...rest] = entry.split(':');
        if (!rawUsername || rest.length === 0) return;
        const candidatePassword = rest.join(':');
        addCredential(rawUsername, candidatePassword);
      });
  }

  const envAdminUsername = process.env.ADMIN_USERNAME;
  const envAdminPassword = process.env.ADMIN_PASSWORD;
  if (envAdminUsername && envAdminPassword) {
    addCredential(envAdminUsername, envAdminPassword);
  }

  if (!entries.size && envAdminPassword) {
    addCredential(envAdminUsername || 'Dizygotic', envAdminPassword);
  }

  return entries;
};

const adminCredentials = buildAdminCredentials();

const resolveAdminCredential = (username, password) => {
  if (typeof password !== 'string' || !password.trim()) return null;
  const key = normaliseAdminUsername(username);
  if (!key) return null;
  const entry = adminCredentials.get(key);
  if (entry && entry.password === password.trim()) {
    return entry;
  }
  return null;
};

// ---------------- MongoDB ----------------
const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
  console.error("[Mongo] MONGO_URI missing");
  process.exit(1);
}
mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("[Mongo] Connected"))
  .catch(err => { console.error("[Mongo] Error:", err); process.exit(1); });

// ---------------- Static Files ----------------
app.use(express.static(path.join(__dirname, 'public')));

// ---------------- Version endpoint ----------------
const VERSION = "1.3";
const BUILD = "fusion-supernova";
app.get('/version', (req, res) => {
  res.json({ version: VERSION, build: BUILD, time: new Date().toISOString() });
});

// ---------------- File Uploads ----------------
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const fsPromises = fs.promises;

const parseHistoryChunkSize = () => {
  const rawValue = process.env.MESSAGE_HISTORY_CHUNK_SIZE;
  if (!rawValue) return 150;

  const numeric = Number.parseInt(String(rawValue).trim(), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) return 150;

  const minSize = 25;
  const maxSize = 500;
  return Math.min(Math.max(numeric, minSize), maxSize);
};

const HISTORY_CHUNK_SIZE = parseHistoryChunkSize();

const toPlainMessage = (doc) => (doc?.toJSON ? doc.toJSON() : doc);

const normaliseObjectId = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  try {
    if (mongoose.Types.ObjectId.isValid(value)) {
      return new mongoose.Types.ObjectId(value);
    }
  } catch (_err) {
    return null;
  }
  return null;
};

const fetchMessageHistoryChunk = async (roomName, { beforeId } = {}) => {
  if (!roomName) {
    return { messages: [], hasMore: false, cursor: null };
  }

  const query = { room: roomName };
  if (beforeId) {
    const cursorId = normaliseObjectId(beforeId);
    if (!cursorId) {
      return { messages: [], hasMore: false, cursor: null };
    }
    query._id = { $lt: cursorId };
  }

  const docs = await Message.find(query)
    .sort({ timestamp: -1, _id: -1 })
    .limit(HISTORY_CHUNK_SIZE + 1);

  const hasMore = docs.length > HISTORY_CHUNK_SIZE;
  const trimmed = hasMore ? docs.slice(0, HISTORY_CHUNK_SIZE) : docs;
  const oldestDoc = trimmed.length ? trimmed[trimmed.length - 1] : null;
  const messages = trimmed.slice().reverse().map(toPlainMessage);

  return {
    messages,
    hasMore,
    cursor: hasMore && oldestDoc ? String(oldestDoc._id) : null,
  };
};
app.use(
  "/uploads",
  express.static(path.resolve("public/uploads"), {
    maxAge: "30d",
    immutable: true,
  })
);
import multer from "multer";
import path from "path";
import crypto from "crypto";

const uploadDir = path.resolve("public/uploads");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const id = crypto.randomBytes(8).toString("hex");
    const ext = path.extname(file.originalname || "");
    cb(null, `${id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    // allow common audio/images; adjust as needed
    const ok = /^(audio|image)\//.test(file.mimetype);
    cb(ok ? null : new Error("Unsupported file type"), ok);
  },
});

// Route
app.post("/api/upload", upload.single("file"), (req, res) => {
  // Public URL will be /uploads/<filename>
  res.json({ ok: true, filename: req.file.filename, url: `/uploads/${req.file.filename}` });
});

const METADEFENDER_API_KEY = process.env.METADEFENDER_API_KEY;
const METADEFENDER_BASE_URL =
  process.env.METADEFENDER_BASE_URL || 'https://api.metadefender.com/v4';
const PSYBIN_STATUS_URL =
  process.env.PSYBIN_STATUS_URL || 'https://www.psyb.in/radio/status-json.xsl';
const PSYBIN_STATUS_TIMEOUT_RAW = Number.parseInt(
  String(process.env.PSYBIN_STATUS_TIMEOUT_MS ?? '').trim(),
  10,
);
const PSYBIN_STATUS_TIMEOUT_MS = Number.isFinite(PSYBIN_STATUS_TIMEOUT_RAW)
  ? Math.min(Math.max(PSYBIN_STATUS_TIMEOUT_RAW, 1000), 20000)
  : 7000;
const normalisePsybinString = (value) => {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = normalisePsybinString(entry);
      if (candidate) return candidate;
    }
  }
  return '';
};

const pickFirstPsybinString = (...values) => {
  for (const value of values) {
    const candidate = normalisePsybinString(value);
    if (candidate) return candidate;
  }
  return '';
};

const extractPsybinNowPlaying = (source) => {
  if (!source || typeof source !== 'object') {
    return { combined: '', artist: '', title: '' };
  }

  const rawNowPlaying =
    source.now_playing ??
    source.nowplaying ??
    source['now-playing'] ??
    source.nowPlaying ??
    null;

  if (!rawNowPlaying) {
    return { combined: '', artist: '', title: '' };
  }

  if (typeof rawNowPlaying === 'string' || Array.isArray(rawNowPlaying)) {
    return {
      combined: pickFirstPsybinString(rawNowPlaying),
      artist: '',
      title: '',
    };
  }

  if (typeof rawNowPlaying !== 'object') {
    return { combined: '', artist: '', title: '' };
  }

  const song =
    rawNowPlaying.song && typeof rawNowPlaying.song === 'object'
      ? rawNowPlaying.song
      : null;
  const track =
    rawNowPlaying.track && typeof rawNowPlaying.track === 'object'
      ? rawNowPlaying.track
      : null;
  const current =
    rawNowPlaying.current && typeof rawNowPlaying.current === 'object'
      ? rawNowPlaying.current
      : null;
  const metadata =
    rawNowPlaying.metadata && typeof rawNowPlaying.metadata === 'object'
      ? rawNowPlaying.metadata
      : null;

  const combined = pickFirstPsybinString(
    rawNowPlaying.text,
    rawNowPlaying.value,
    rawNowPlaying.display,
    song?.text,
    song?.value,
    song?.display,
    song?.title && song?.artist
      ? `${normalisePsybinString(song.artist)} — ${normalisePsybinString(song.title)}`
      : '',
    track?.text,
    track?.value,
    track?.display,
    track?.title && track?.artist
      ? `${normalisePsybinString(track.artist)} — ${normalisePsybinString(track.title)}`
      : '',
    current?.text,
    current?.value,
    current?.display,
    metadata?.text,
    metadata?.value,
  );

  const artist = pickFirstPsybinString(
    rawNowPlaying.artist,
    rawNowPlaying.performer,
    rawNowPlaying.creator,
    song?.artist,
    song?.performer,
    song?.creator,
    track?.artist,
    track?.performer,
    track?.creator,
    current?.artist,
    current?.performer,
    current?.creator,
    metadata?.artist,
    metadata?.performer,
  );

  const title = pickFirstPsybinString(
    rawNowPlaying.title,
    rawNowPlaying.name,
    rawNowPlaying.track,
    song?.title,
    song?.name,
    song?.track,
    track?.title,
    track?.name,
    track?.track,
    current?.title,
    current?.name,
    current?.track,
    metadata?.title,
    metadata?.name,
  );

  return { combined, artist, title };
};

const splitPsybinArtistTitle = (value) => {
  const trimmed = normalisePsybinString(value);
  if (!trimmed) return null;

  const separators = [' - ', ' – ', ' — '];
  for (const separator of separators) {
    const index = trimmed.indexOf(separator);
    if (index > 0 && index < trimmed.length - separator.length) {
      const artist = trimmed.slice(0, index).trim();
      const title = trimmed.slice(index + separator.length).trim();
      if (artist && title) {
        return { artist, title };
      }
    }
  }

  return null;
};

const selectPsybinSource = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const { icestats } = payload;
  if (!icestats || typeof icestats !== 'object') return null;
  const { source } = icestats;
  if (!source) return null;

  const pickObject = (entry) => (entry && typeof entry === 'object' ? entry : null);

  if (Array.isArray(source)) {
    if (source.length === 1) return pickObject(source[0]);

    const byListenUrl = source.find((entry) => {
      const listenUrl = normalisePsybinString(entry?.listenurl);
      return listenUrl.includes('/radio');
    });
    if (byListenUrl) return pickObject(byListenUrl);

    const byName = source.find((entry) => {
      const serverName = normalisePsybinString(entry?.server_name).toLowerCase();
      return serverName.includes('psybin');
    });
    if (byName) return pickObject(byName);

    return source.map(pickObject).find(Boolean) || null;
  }

  return pickObject(source);
};

const mapPsybinNowPlaying = (payload) => {
  const source = selectPsybinSource(payload);
  if (!source) {
    return { title: '', artist: '', text: '' };
  }

  const nowPlaying = extractPsybinNowPlaying(source);

  let artist = pickFirstPsybinString(
    source.artist,
    source.icy_artist,
    source.stream_artist,
    source.source_artist,
    nowPlaying.artist,
  );
  let title = pickFirstPsybinString(
    source.title,
    source.stream_title,
    source.song,
    source.current_song,
    source.track,
    nowPlaying.title,
  );
  const combined = pickFirstPsybinString(
    nowPlaying.combined,
    source.now_playing,
    source.nowplaying,
    source.icy_title,
    source['now-playing'],
  );

  if ((!artist || !title) && combined) {
    const split = splitPsybinArtistTitle(combined);
    if (split) {
      if (!artist) artist = split.artist;
      if (!title) title = split.title;
    } else if (!title) {
      title = combined;
    }
  }

  if (!artist) {
    artist = nowPlaying.artist;
  }
  if (!title) {
    title = nowPlaying.title;
  }

  const serverName = pickFirstPsybinString(
    source.server_name,
    source.server_description,
    payload?.icestats?.server_name,
  );

  const parts = [];
  if (artist) parts.push(artist);
  if (title) parts.push(title);

  let text = parts.length ? parts.join(' — ') : '';
  if (!text) {
    text = combined || nowPlaying.combined || serverName || '';
  }

  return { title, artist, text };
};

app.get('/api/psybin/now-playing', async (req, res) => {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => {
        try {
          controller.abort();
        } catch (_err) {
          /* ignore */
        }
      }, PSYBIN_STATUS_TIMEOUT_MS)
    : null;

  try {
    const response = await fetch(PSYBIN_STATUS_URL, {
      method: 'GET',
      headers: {
        'user-agent': 'DizyChat/1.0 (+https://dizy.chat)',
        accept: 'application/json',
      },
      signal: controller?.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      if (err?.name === 'AbortError' || err?.code === 'ABORT_ERR') {
        throw err;
      }
      throw new Error(`Invalid Psybin metadata payload: ${err.message}`);
    }

    const metadata = mapPsybinNowPlaying(payload);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      title: metadata.title,
      artist: metadata.artist,
      text: metadata.text,
      fetchedAt: Date.now(),
    });
  } catch (err) {
    const message =
      err?.name === 'AbortError' || err?.code === 'ABORT_ERR'
        ? 'Psybin metadata request timed out'
        : err?.message;
    console.warn('[Psybin] Metadata proxy failed:', message);
    res.status(502).json({
      title: '',
      artist: '',
      text: '',
      fetchedAt: Date.now(),
      error:
        err?.name === 'AbortError' || err?.code === 'ABORT_ERR'
          ? 'TIMEOUT'
          : 'UNAVAILABLE',
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
});

const parsePositiveInteger = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const numeric = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(numeric) || numeric < min) return fallback;
  return Math.min(numeric, max);
};

const METADEFENDER_POLL_INTERVAL_MS = parsePositiveInteger(
  process.env.METADEFENDER_POLL_INTERVAL_MS,
  1500,
  { min: 250, max: 15000 },
);

const METADEFENDER_MAX_POLL_ATTEMPTS = parsePositiveInteger(
  process.env.METADEFENDER_MAX_POLL_ATTEMPTS,
  10,
  { min: 1, max: 40 },
);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readMetaDefenderJson = async (response) => {
  try {
    return await response.json();
  } catch (_err) {
    return null;
  }
};

const extractDetectionDetails = (scanResults = {}) => {
  const details = scanResults.scan_details;
  if (details && typeof details === 'object') {
    for (const detail of Object.values(details)) {
      if (detail && detail.threat_found && detail.threat_found !== 'Clean') {
        return detail.threat_found;
      }
    }
  }
  return scanResults.scan_all_result_a || 'Threat detected';
};

const scanFileWithMetaDefender = async (filePath) => {
  if (!METADEFENDER_API_KEY) {
    const error = new Error('MetaDefender API key not configured');
    error.code = 'SCANNER_NOT_CONFIGURED';
    throw error;
  }

  let uploadResponse;
  try {
    uploadResponse = await fetch(`${METADEFENDER_BASE_URL}/file`, {
      method: 'POST',
      headers: {
        apikey: METADEFENDER_API_KEY,
        filename: path.basename(filePath),
        'content-type': 'application/octet-stream',
      },
      body: fs.createReadStream(filePath),
    });
  } catch (err) {
    const networkError = new Error(`MetaDefender upload failed: ${err.message}`);
    networkError.code = 'SCANNER_UNAVAILABLE';
    throw networkError;
  }

  if (uploadResponse.status === 401 || uploadResponse.status === 403) {
    const authError = new Error('MetaDefender API key rejected');
    authError.code = 'SCANNER_NOT_CONFIGURED';
    throw authError;
  }

  if (!uploadResponse.ok) {
    const bodyText = await uploadResponse.text().catch(() => '');
    const error = new Error(
      bodyText
        ? `MetaDefender upload error (${uploadResponse.status}): ${bodyText}`
        : `MetaDefender upload error (${uploadResponse.status})`,
    );
    error.code = uploadResponse.status === 429 ? 'SCANNER_UNAVAILABLE' : 'SCANNER_ERROR';
    throw error;
  }

  const uploadPayload = await readMetaDefenderJson(uploadResponse);
  const dataId = uploadPayload?.data_id;
  if (!dataId) {
    const error = new Error('MetaDefender upload response missing data_id');
    error.code = 'SCANNER_ERROR';
    throw error;
  }

  let attempts = 0;
  while (attempts < METADEFENDER_MAX_POLL_ATTEMPTS) {
    if (attempts > 0) {
      await wait(METADEFENDER_POLL_INTERVAL_MS);
    }
    attempts += 1;

    let statusResponse;
    try {
      statusResponse = await fetch(`${METADEFENDER_BASE_URL}/file/${encodeURIComponent(dataId)}`, {
        method: 'GET',
        headers: { apikey: METADEFENDER_API_KEY },
      });
    } catch (err) {
      if (attempts < METADEFENDER_MAX_POLL_ATTEMPTS) {
        continue;
      }
      const networkError = new Error(`MetaDefender status check failed: ${err.message}`);
      networkError.code = 'SCANNER_UNAVAILABLE';
      throw networkError;
    }

    if (statusResponse.status === 429) {
      if (attempts >= METADEFENDER_MAX_POLL_ATTEMPTS) {
        const rateLimitError = new Error('MetaDefender rate limited status polling');
        rateLimitError.code = 'SCANNER_UNAVAILABLE';
        throw rateLimitError;
      }
      continue;
    }

    if (!statusResponse.ok) {
      if (statusResponse.status === 401 || statusResponse.status === 403) {
        const authError = new Error('MetaDefender API key rejected during status check');
        authError.code = 'SCANNER_NOT_CONFIGURED';
        throw authError;
      }

      const bodyText = await statusResponse.text().catch(() => '');
      const error = new Error(
        bodyText
          ? `MetaDefender status error (${statusResponse.status}): ${bodyText}`
          : `MetaDefender status error (${statusResponse.status})`,
      );
      error.code = 'SCANNER_ERROR';
      throw error;
    }

    const statusPayload = await readMetaDefenderJson(statusResponse);
    const scanResults = statusPayload?.scan_results;
    if (!scanResults) {
      continue;
    }

    const progress = Number.parseInt(scanResults.progress_percentage, 10);
    if (Number.isFinite(progress) && progress < 100) {
      continue;
    }

    const overallResult = (scanResults.scan_all_result_a || '').toLowerCase();
    if (overallResult === 'no threat detected') {
      return { clean: true };
    }

    const details = extractDetectionDetails(scanResults);
    return { clean: false, details };
  }

  const timeoutError = new Error('MetaDefender scan timed out');
  timeoutError.code = 'SCANNER_TIMEOUT';
  throw timeoutError;
};

const removeFileSilently = async (filePath) => {
  try {
    await fsPromises.unlink(filePath);
  } catch (_err) {
    // Ignore unlink errors to avoid masking the original failure.
  }
};

const resolveUploadPathFromUrl = (fileUrl) => {
  if (typeof fileUrl !== 'string') return null;
  const trimmed = fileUrl.trim();
  if (!trimmed) return null;

  let candidatePath = trimmed;
  try {
    const parsed = new URL(trimmed, 'http://dizychat.local');
    if (parsed.origin !== 'http://dizychat.local') {
      candidatePath = parsed.pathname || '';
    } else {
      candidatePath = parsed.href.replace(parsed.origin, '') || '';
    }
  } catch (_err) {
    // Ignore URL parse errors and fall back to raw path handling.
  }

  if (!candidatePath) return null;

  const normalised = path.posix.normalize(candidatePath);
  if (!normalised.startsWith('/uploads/')) return null;

  const relativePath = normalised.replace(/^\/+/, '');
  const absolutePath = path.join(__dirname, 'public', relativePath);
  if (!absolutePath.startsWith(uploadDir)) return null;

  return absolutePath;
};

const removeUploadedFileByUrl = async (fileUrl) => {
  const targetPath = resolveUploadPathFromUrl(fileUrl);
  if (!targetPath) return false;

  try {
    await fsPromises.unlink(targetPath);
    console.log(`[Upload] Removed file ${path.basename(targetPath)}`);
    return true;
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      console.error('[Upload] Failed to remove file:', err);
    }
    return false;
  }
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + unique + path.extname(file.originalname));
  }
});

const parseUploadLimitMb = () => {
  const rawValue = process.env.MAX_UPLOAD_SIZE_MB;
  if (!rawValue) return 1024; // default 1 GB

  const normalized = String(rawValue).trim().toLowerCase();
  if (!normalized) return 1024;

  if (["unlimited", "infinite", "infinity", "no-limit", "none"].includes(normalized)) {
    return null; // no explicit limit
  }

  const match = normalized.match(/^(\d+(?:\.\d+)?)(kb|mb|gb)?$/);
  if (!match) {
    const numeric = Number(normalized);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.max(numeric, 10);
    }
    return 1024;
  }

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return 1024;

  const unit = match[2] || 'mb';
  const unitMultiplier = {
    kb: 1 / 1024,
    mb: 1,
    gb: 1024,
  };
  const multiplier = unitMultiplier[unit] ?? 1;
  const result = value * multiplier;

  if (!Number.isFinite(result) || result <= 0) return 1024;

  return Math.max(result, 10);
};

const MAX_UPLOAD_SIZE_MB = parseUploadLimitMb();
const formatUploadLimit = (mb) => {
  if (!Number.isFinite(mb)) return '';
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${parseFloat(gb.toFixed(2))}GB`;
  }
  return `${parseFloat(mb.toFixed(2))}MB`;
};

const MAX_UPLOAD_SIZE_BYTES =
  MAX_UPLOAD_SIZE_MB === null ? null : Math.ceil(MAX_UPLOAD_SIZE_MB * 1024 * 1024);
const uploadLimits = {};
if (typeof MAX_UPLOAD_SIZE_BYTES === 'number' && Number.isFinite(MAX_UPLOAD_SIZE_BYTES)) {
  uploadLimits.fileSize = MAX_UPLOAD_SIZE_BYTES;
}
const UPLOAD_LIMIT_LABEL = MAX_UPLOAD_SIZE_MB === null
  ? 'unlimited'
  : formatUploadLimit(MAX_UPLOAD_SIZE_MB);

console.log(`[Upload] File size limit: ${UPLOAD_LIMIT_LABEL}`);

const upload = multer({
  storage,
  limits: Object.keys(uploadLimits).length ? uploadLimits : undefined,
  fileFilter: (_req, _file, cb) => cb(null, true), // accept any file type (mp3, archives, etc.)
});

const uploadSingleMiddleware = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();

    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: MAX_UPLOAD_SIZE_MB === null
          ? 'File too large for the current configuration.'
          : `File too large. Maximum upload size is ${UPLOAD_LIMIT_LABEL}.`,
      });
    }

    console.error('[Upload] Error:', err);
    return res.status(400).json({ error: err.message || 'Upload failed' });
  });
};

app.post('/upload', uploadSingleMiddleware, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const filePath = path.join(uploadDir, req.file.filename);

  try {
    const scanResult = await scanFileWithMetaDefender(filePath);
    if (!scanResult.clean) {
      await removeFileSilently(filePath);
      return res.status(400).json({
        error: 'File failed antivirus scan',
        details: scanResult.details,
      });
    }
  } catch (err) {
    await removeFileSilently(filePath);

    if (err && ['SCANNER_NOT_CONFIGURED', 'SCANNER_UNAVAILABLE'].includes(err.code)) {
      console.error('[Upload] Antivirus scanner unavailable:', err);
      return res.status(500).json({ error: 'Antivirus scanner unavailable' });
    }

    if (err && err.code === 'SCANNER_TIMEOUT') {
      console.error('[Upload] Antivirus scan timed out:', err);
      return res.status(504).json({ error: 'Antivirus scan timed out' });
    }

    console.error('[Upload] Antivirus scan error:', err);
    return res.status(500).json({ error: 'Antivirus scan failed' });
  }

  res.json({
    url: `/uploads/${req.file.filename}`,
    name: req.file.originalname,
    type: req.file.mimetype,
    size: req.file.size
  });
});

// ---------------- Link Preview ----------------
app.get('/link-preview', async (req, res) => {
  let { url } = req.query;
  if (!url) return res.status(400).json({ error: 'No URL provided' });
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;

  try {
    const response = await fetch(url, {
      timeout: 5000,
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    const contentType = response.headers.get('content-type') || '';
    if (!/text\/html/i.test(contentType)) {
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.json({ title: '', image: '', description: '', siteName: '', icon: '' });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const pick = (...candidates) => {
      for (const candidate of candidates) {
        if (!candidate) continue;
        const value = typeof candidate === 'function' ? candidate() : candidate;
        if (value) return value;
      }
      return '';
    };

    let title = pick(
      () => $('meta[property="og:title"]').attr('content'),
      () => $('meta[name="twitter:title"]').attr('content'),
      () => $('title').text(),
    );

    let description = pick(
      () => $('meta[property="og:description"]').attr('content'),
      () => $('meta[name="description"]').attr('content'),
      () => $('meta[name="twitter:description"]').attr('content'),
    );

    let imageRaw = pick(
      () => $('meta[property="og:image:secure_url"]').attr('content'),
      () => $('meta[property="og:image"]').attr('content'),
      () => $('meta[name="twitter:image"]').attr('content'),
      () => $('meta[name="twitter:image:src"]').attr('content'),
      () => $('link[rel="image_src"]').attr('href'),
    );

    const iconRaw = pick(
      () => $('link[rel="icon"]').attr('href'),
      () => $('link[rel="shortcut icon"]').attr('href'),
      () => $('link[rel="apple-touch-icon"]').attr('href'),
    );

    let siteName = pick(
      () => $('meta[property="og:site_name"]').attr('content'),
      () => $('meta[name="application-name"]').attr('content'),
      () => new URL(url).hostname,
    );

    const resolveAsset = (asset) => {
      if (!asset) return '';
      try {
        return new URL(asset, url).href;
      } catch {
        return '';
      }
    };

    const ensureString = (value) => {
      if (!value) return '';
      if (Array.isArray(value)) return ensureString(value[0]);
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      return '';
    };

    const first = (value) => (Array.isArray(value) ? value[0] : value);

    const extractImage = (value) => {
      if (!value) return '';
      if (typeof value === 'string') return value;
      if (Array.isArray(value)) return extractImage(value[0]);
      if (typeof value === 'object') {
        return extractImage(value.url || value.contentUrl || value.secure_url || value.thumbnailUrl || value['@id']);
      }
      return '';
    };

    const host = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return '';
      }
    })();

    const refineFromJsonLd = () => {
      const scripts = $('script[type="application/ld+json"]');
      const candidates = [];
      scripts.each((_, el) => {
        try {
          const raw = $(el).contents().text();
          if (!raw) return;
          const parsed = JSON.parse(raw);
          const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
          while (queue.length) {
            const item = queue.shift();
            if (!item || typeof item !== 'object') continue;
            if (Array.isArray(item)) {
              queue.push(...item);
              continue;
            }
            const type = item['@type'];
            if (typeof type === 'string' && /VideoObject|NewsArticle|Article|CreativeWork/i.test(type)) {
              candidates.push(item);
            }
            for (const value of Object.values(item)) {
              if (value && typeof value === 'object') queue.push(value);
            }
          }
        } catch {
          /* ignore malformed JSON-LD */
        }
      });

      if (!candidates.length) return;

      const preferVideo = candidates.find((item) => {
        const type = item['@type'];
        return typeof type === 'string' && /VideoObject/i.test(type);
      });

      const chosen = preferVideo || candidates[0];

      const candidateTitle = ensureString(chosen.name || chosen.headline || chosen.title);
      const candidateDescription = ensureString(chosen.description);
      const candidateImage = ensureString(extractImage(chosen.thumbnailUrl || chosen.image));
      const publisher = first(chosen.publisher);
      const candidateSite = ensureString(
        (publisher && (publisher.name || (publisher['@type'] === 'Organization' && publisher.title)))
        || chosen.source
        || first(chosen.isPartOf)?.name
        || chosen.provider_name
      );

      if (candidateTitle) title = candidateTitle;
      if (candidateDescription) description = candidateDescription;
      if (candidateImage) imageRaw = candidateImage;
      if (candidateSite) siteName = candidateSite;
    };

    refineFromJsonLd();

    const clean = (value) => ensureString(value).trim();

    const responsePayload = {
      title: clean(title),
      description: clean(description),
      image: resolveAsset(clean(imageRaw)),
      icon: resolveAsset(clean(iconRaw)),
      siteName: clean(siteName) || host,
    };

    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(responsePayload);
  } catch (err) {
    console.error('[Link Preview] Error:', err.message);
    res.json({ title: '', image: '', description: '', siteName: '', icon: '' });
  }
});

app.get('/tenor-proxy', async (req, res) => {
  const { url } = req.query;
  if (!url || !/^https?:\/\/(?:www\.)?tenor\.com\//i.test(url)) {
    return res.status(400).json({ gif: '', tinyGif: '' });
  }

  try {
    const response = await fetch(`https://tenor.com/oembed?url=${encodeURIComponent(url)}`);
    const data = await response.json();
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      gif: data?.url || '',
      tinyGif: data?.thumbnail_url || ''
    });
  } catch (err) {
    console.error('[Tenor] Error:', err.message);
    res.json({ gif: '', tinyGif: '' });
  }
});

app.get('/soundboard-clips', (req, res) => {
  try {
    const { q, board } = req.query;
    const { hits, total } = soundboardStore.searchClips({
      query: typeof q === 'string' ? q : '',
      boardId: typeof board === 'string' ? board : '',
    });

    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({
      hits,
      total,
      totalHits: total,
    });
  } catch (err) {
    console.error('[Soundboard] Error:', err.message);
    res.status(500).json({ hits: [], total: 0, totalHits: 0 });
  }
});


// ---------------- Socket.IO ----------------
const typingUsersByRoom = new Map();
const roomPasswords = new Map();
const roomMembers = new Map();
const roomPresence = new Map();
const roomUserHistory = new Map();
const roomBans = new Map();
const roomBlocks = new Map();
const roomMutes = new Map();

const PERSISTENT_ROOMS = [
  'General Chat',
  'InfoWars Chat',
  'Drum & Bass Chat',
  'Psybin Radio',
];
const PERSISTENT_ROOM_SET = new Set(PERSISTENT_ROOMS);

PERSISTENT_ROOMS.forEach((roomName) => {
  if (!roomMembers.has(roomName)) {
    roomMembers.set(roomName, new Set());
  }
  roomPasswords.set(roomName, '');
});

const canonicalUsername = (username) => {
  if (typeof username !== 'string') return '';
  return username.trim().toLowerCase();
};

const normaliseRoomName = (room) => {
  if (typeof room !== 'string') return '';
  return room.trim().slice(0, 80);
};

const broadcastTypingUsers = (room) => {
  if (!room) return;
  const roomUsers = typingUsersByRoom.get(room);
  const payload = roomUsers ? Array.from(roomUsers.values()) : [];
  io.to(room).emit('typing', payload);
};

const registerTypingUser = (socket, username) => {
  const room = normaliseRoomName(socket.currentRoom);
  if (!room || !username) return;
  if (!typingUsersByRoom.has(room)) {
    typingUsersByRoom.set(room, new Map());
  }
  const roomUsers = typingUsersByRoom.get(room);
  roomUsers.set(socket.id, username);
  broadcastTypingUsers(room);
};

const clearTypingUser = (socket, targetRoom) => {
  const room = normaliseRoomName(targetRoom || socket.currentRoom);
  if (!room) return;
  const roomUsers = typingUsersByRoom.get(room);
  if (!roomUsers) return;
  roomUsers.delete(socket.id);
  if (!roomUsers.size) {
    typingUsersByRoom.delete(room);
  }
  broadcastTypingUsers(room);
};

const normaliseUsername = (username, fallback) => {
  if (typeof username !== 'string') return fallback;
  const trimmed = username.trim();
  return trimmed ? trimmed.slice(0, 60) : fallback;
};

const normalisePassword = (password) => {
  if (typeof password !== 'string') return '';
  return password.trim().slice(0, 120);
};

const ensureSet = (map, key) => {
  if (!map.has(key)) map.set(key, new Set());
  return map.get(key);
};

const ensureMap = (map, key) => {
  if (!map.has(key)) map.set(key, new Map());
  return map.get(key);
};

const isUserBlocked = (room, username) => {
  const canonical = canonicalUsername(username);
  const blocked = roomBlocks.get(room);
  return blocked ? blocked.has(canonical) : false;
};

const getMuteExpiry = (room, username) => {
  const canonical = canonicalUsername(username);
  const muteMap = roomMutes.get(room);
  if (!muteMap) return 0;
  const until = muteMap.get(canonical);
  if (!until) return 0;
  if (until <= Date.now()) {
    muteMap.delete(canonical);
    return 0;
  }
  return until;
};

const emitRoomUsers = (room) => {
  const presence = roomPresence.get(room);
  const users = presence
    ? Array.from(presence.values()).map(({ id, username, isAdmin }) => ({
        id,
        username,
        isAdmin: Boolean(isAdmin),
        mutedUntil: getMuteExpiry(room, username) || 0,
        isBlocked: isUserBlocked(room, username),
      }))
    : [];

  users.sort((a, b) => {
    if (a.isAdmin && !b.isAdmin) return -1;
    if (!a.isAdmin && b.isAdmin) return 1;
    return a.username.localeCompare(b.username);
  });

  io.to(room).emit('room users', { room, users });
};

const registerSocketInRoom = (socket, room) => {
  const targetRoom = normaliseRoomName(room);
  if (!targetRoom) return;
  const presence = ensureMap(roomPresence, targetRoom);
  presence.set(socket.id, {
    id: socket.id,
    username: socket.username,
    isAdmin: socket.isAdmin,
  });
  emitRoomUsers(targetRoom);
};

const refreshSocketPresence = (socket) => {
  const room = normaliseRoomName(socket.currentRoom);
  if (!room) return;
  const presence = roomPresence.get(room);
  if (!presence || !presence.has(socket.id)) return;
  presence.set(socket.id, {
    id: socket.id,
    username: socket.username,
    isAdmin: socket.isAdmin,
  });
  emitRoomUsers(room);
};

const getSocketsForUser = (room, canonicalTarget) => {
  const matches = [];
  for (const [, s] of io.of('/').sockets) {
    if (s.currentRoom === room && canonicalUsername(s.username) === canonicalTarget) {
      matches.push(s);
    }
  }
  return matches;
};

const setUserMute = (room, canonicalTarget, durationMs) => {
  const muteMap = ensureMap(roomMutes, room);
  const until = Date.now() + durationMs;
  muteMap.set(canonicalTarget, until);
  return until;
};

const clearUserMute = (room, canonicalTarget) => {
  const muteMap = roomMutes.get(room);
  if (!muteMap) return false;
  return muteMap.delete(canonicalTarget);
};

const addUserBlock = (room, canonicalTarget) => {
  const blocked = ensureSet(roomBlocks, room);
  const existed = blocked.has(canonicalTarget);
  blocked.add(canonicalTarget);
  return !existed;
};

const removeUserBlock = (room, canonicalTarget) => {
  const blocked = roomBlocks.get(room);
  if (!blocked) return false;
  return blocked.delete(canonicalTarget);
};

const addUserBan = (room, canonicalTarget) => {
  const bans = ensureSet(roomBans, room);
  const existed = bans.has(canonicalTarget);
  bans.add(canonicalTarget);
  return !existed;
};

const getPublicRoomsSnapshot = () => {
  const rooms = new Map();

  PERSISTENT_ROOMS.forEach((room) => {
    const members = roomMembers.get(room);
    rooms.set(room, {
      name: room,
      occupants: members ? members.size : 0,
      requiresPassword: Boolean(roomPasswords.get(room)),
    });
  });

  for (const [room, members] of roomMembers.entries()) {
    if (rooms.has(room)) {
      const entry = rooms.get(room);
      entry.occupants = members ? members.size : 0;
      entry.requiresPassword = Boolean(roomPasswords.get(room));
      continue;
    }

    if (!members || !members.size) continue;

    rooms.set(room, {
      name: room,
      occupants: members.size,
      requiresPassword: Boolean(roomPasswords.get(room)),
    });
  }

  return Array.from(rooms.values()).sort((a, b) => {
    if (b.occupants !== a.occupants) return b.occupants - a.occupants;
    return a.name.localeCompare(b.name);
  });
};

const emitRoomListUpdate = () => {
  io.emit('room list', getPublicRoomsSnapshot());
};

const removeSocketFromRoom = (socket, targetRoom) => {
  const room = normaliseRoomName(targetRoom || socket.currentRoom);
  if (!room) return;

  const members = roomMembers.get(room);
  if (members) {
    members.delete(socket.id);
    if (!members.size && !PERSISTENT_ROOM_SET.has(room)) {
      roomMembers.delete(room);
    }
  }

  const presence = roomPresence.get(room);
  if (presence) {
    presence.delete(socket.id);
    if (!presence.size) {
      roomPresence.delete(room);
    }
  }

  clearTypingUser(socket, room);
  socket.leave(room);
  if (socket.currentRoom === room) {
    socket.currentRoom = null;
  }

  emitRoomUsers(room);
};

const sendJoinError = (socket, message) => {
  socket.emit('join error', message);
  socket.emit('join room error', message);
};
const RATE_LIMIT_WINDOW = 2000;
const MAX_MESSAGES_PER_WINDOW = 3;
const MAX_TYPING_EVENTS_PER_WINDOW = 5;

const messageTimestamps = new Map();
const typingTimestamps = new Map();

function canSendMessage(socketId) {
  const now = Date.now();
  if (!messageTimestamps.has(socketId)) messageTimestamps.set(socketId, []);
  const ts = messageTimestamps.get(socketId);
  while(ts.length && now - ts[0] > RATE_LIMIT_WINDOW) ts.shift();
  if (ts.length >= MAX_MESSAGES_PER_WINDOW) return false;
  ts.push(now);
  return true;
}

function canSendTyping(socketId) {
  const now = Date.now();
  if (!typingTimestamps.has(socketId)) typingTimestamps.set(socketId, []);
  const ts = typingTimestamps.get(socketId);
  while(ts.length && now - ts[0] > RATE_LIMIT_WINDOW) ts.shift();
  if (ts.length >= MAX_TYPING_EVENTS_PER_WINDOW) return false;
  ts.push(now);
  return true;
}

function requireAdmin(socket){
  if (!socket.isAdmin) {
    socket.emit('toast', { type: 'warn', text: '🚫 Admin only command.' });
    return false;
  }
  return true;
}

io.on('connection', socket => {
  console.log('[Socket] Connected', socket.id);
  socket.isAdmin = false;
  socket.emit('room list', getPublicRoomsSnapshot());

  socket.on('join room', async ({ room, username, password }) => {
    const roomName = normaliseRoomName(room);
    if (!roomName) {
      sendJoinError(socket, 'Room name is required');
      return;
    }

    const providedPassword = normalisePassword(password);
    const storedPassword = roomPasswords.get(roomName);
    if (storedPassword !== undefined && storedPassword !== providedPassword) {
      sendJoinError(socket, 'Incorrect room password');
      return;
    }

    if (storedPassword === undefined) {
      roomPasswords.set(roomName, providedPassword);
    }

    const previousRoom = socket.currentRoom;
    if (previousRoom && previousRoom !== roomName) {
      removeSocketFromRoom(socket, previousRoom);
      emitRoomListUpdate();
    }

    // Track user identity & room
    const fallbackUser = `Guest-${socket.id.slice(0, 4)}`;
    socket.username = normaliseUsername(username, fallbackUser);
    const canonicalUser = canonicalUsername(socket.username);
    const bannedSet = roomBans.get(roomName);
    if (bannedSet && bannedSet.has(canonicalUser)) {
      sendJoinError(socket, 'You are banned from this room.');
      socket.currentRoom = null;
      return;
    }

    socket.currentRoom = roomName;

    if (!roomMembers.has(roomName)) {
      roomMembers.set(roomName, new Set());
    }
    roomMembers.get(roomName).add(socket.id);

    socket.join(roomName);
    registerSocketInRoom(socket, roomName);
    console.log(`User joined room: ${roomName} as ${socket.username}`);

    // Emit successful room join
    socket.emit('join room success');  // Added this line!
    emitRoomListUpdate();

    // Load history and pinned messages
    try {
      const historyChunk = await fetchMessageHistoryChunk(roomName);
      console.log(
        `[History] Loaded ${historyChunk.messages.length} messages from ${roomName}` +
        (historyChunk.hasMore ? ' (more available)' : '')
      );
      socket.emit('load messages', historyChunk);     // new clients
      socket.emit('previous messages', historyChunk.messages); // legacy clients
    } catch (err) {
      console.error("Error fetching history:", err);
    }

    // Send pinned messages
    try {
      const pinned = await Message.find({ room: roomName, pinned: true, deleted: { $ne: true } }).sort({ timestamp: -1 }).limit(50);
      socket.emit('pinned messages', pinned);
    } catch (err) { console.error("[Pinned] Error:", err); }
  });

  socket.on('request older messages', async ({ room, cursor } = {}) => {
    try {
      const roomName = normaliseRoomName(room) || socket.currentRoom;
      if (!roomName || socket.currentRoom !== roomName) return;

      if (!cursor) {
        socket.emit('older messages', { messages: [], hasMore: false, cursor: null });
        return;
      }

      const historyChunk = await fetchMessageHistoryChunk(roomName, { beforeId: cursor });
      socket.emit('older messages', historyChunk);
    } catch (err) {
      console.error('[History] Failed to load older messages:', err);
      socket.emit('older messages', { messages: [], hasMore: false, cursor: null });
    }
  });

  socket.on('leave room', ({ room } = {}) => {
    const target = normaliseRoomName(room) || socket.currentRoom;
    if (!target) return;
    removeSocketFromRoom(socket, target);
    emitRoomListUpdate();
  });

  socket.on('request rooms', () => {
    socket.emit('room list', getPublicRoomsSnapshot());
  });


  // ----- Admin Auth (post-join) -----
  socket.on('admin auth', ({ room, username, adminPassword }) => {
    try {
      const candidateUser = username || socket.username;
      const resolvedAdmin = resolveAdminCredential(candidateUser, adminPassword);
      if (resolvedAdmin) {
        socket.isAdmin = true;
        socket.emit('admin status', { isAdmin: true });
        console.log('[Admin] Authenticated', resolvedAdmin.username);
      } else {
        socket.isAdmin = false;
        socket.emit('admin status', { isAdmin: false });
      }
      refreshSocketPresence(socket);
    } catch(e){ console.log('[admin auth error]', e); }
  });

  // ----- Chat message -----
  socket.on('chat message', async (msgDataRaw = {}) => {
    const roomName = normaliseRoomName(msgDataRaw.room) || socket.currentRoom;
    if (!roomName || socket.currentRoom !== roomName) return;

    if (isUserBlocked(roomName, socket.username)) {
      socket.emit('moderation notice', { type: 'blocked', room: roomName, reason: 'send' });
      return;
    }

    const muteUntil = getMuteExpiry(roomName, socket.username);
    if (muteUntil) {
      socket.emit('moderation notice', { type: 'muted', room: roomName, until: muteUntil, reason: 'send' });
      return;
    }

    if (!canSendMessage(socket.id)) return;

    const msgData = { ...msgDataRaw, room: roomName, user: socket.username };
    try {
      if (msgData.text?.length > 1000) msgData.text = msgData.text.substring(0,1000);
      if (msgData.text) msgData.text = sanitizeHtml(msgData.text, { allowedTags: [], allowedAttributes: {} });

      if (msgData.fileUrl) {
        const fileUrl = String(msgData.fileUrl).trim();
        if (/^(https?:\/\/|\/)/i.test(fileUrl)) {
          msgData.fileUrl = fileUrl;
        } else {
          delete msgData.fileUrl;
        }
      }
      if (msgData.fileType) {
        msgData.fileType = String(msgData.fileType).trim().slice(0, 100);
      }
      if (msgData.fileName) {
        msgData.fileName = sanitizeHtml(String(msgData.fileName), { allowedTags: [], allowedAttributes: {} }).slice(0, 120);
      }

      let replyToDocId = null;
      let replySnapshot = null;
      if (msgData.replyTo) {
        const replyId = String(msgData.replyTo).trim();
        if (mongoose.Types.ObjectId.isValid(replyId)) {
          try {
            const repliedMessage = await Message.findById(replyId).lean();
            if (repliedMessage && repliedMessage.room === roomName) {
              replyToDocId = repliedMessage._id;
              const safeText = sanitizeHtml(String(repliedMessage.text || ""), { allowedTags: [], allowedAttributes: {} });
              const safeName = sanitizeHtml(String(repliedMessage.fileName || ""), { allowedTags: [], allowedAttributes: {} });
              replySnapshot = {
                id: String(repliedMessage._id),
                user: repliedMessage.user || "Anon",
                text: safeText.slice(0, 240),
                fileUrl: repliedMessage.fileUrl || "",
                fileType: repliedMessage.fileType || "",
                fileName: safeName.slice(0, 120),
                deleted: Boolean(repliedMessage.deleted),
              };
            }
          } catch (err) {
            console.warn('[Message] Failed to load reply target', err);
          }
        }
      }

      if (!replyToDocId) {
        msgData.replyTo = undefined;
        msgData.replyToSnapshot = undefined;
      } else {
        msgData.replyTo = replyToDocId;
        msgData.replyToSnapshot = replySnapshot;
      }

      const newMsg = new Message({
        ...msgData,
        timestamp: msgData.timestamp ? new Date(msgData.timestamp) : new Date(),
        reactions: msgData.reactions || [],
        pinned: msgData.pinned || false,
        starredBy: msgData.starredBy || []
      });
      await newMsg.save();
      io.to(roomName).emit('chat message', newMsg);
      try {
        if (newMsg.status !== 'delivered') {
          await Message.findByIdAndUpdate(newMsg._id, { status: 'delivered' });
          newMsg.status = 'delivered';
        }
      } catch (err) {
        console.error('[Message] Failed to update delivery status:', err);
      }
      io.to(roomName).emit('message status', { id: newMsg._id, status: 'delivered' });
    } catch(err){ console.error("[Message] Error:", err); }
  });

  socket.on('message read', async ({ room, id }) => {
    try {
      const targetRoom = normaliseRoomName(room) || socket.currentRoom;
      if (!targetRoom || !id) return;
      const msg = await Message.findById(id);
      if (!msg) return;
      if (msg.room !== targetRoom) return;
      if (msg.deleted) return;
      const reader = socket.username || '';
      if (msg.user === reader) return;
      if (msg.status === 'read') return;
      msg.status = 'read';
      await msg.save();
      io.to(targetRoom).emit('message status', { id: msg._id, status: 'read' });
    } catch (err) {
      console.error('[Message] Read receipt error:', err);
    }
  });

  // ----- Edit / Delete / Pin / Star / React -----
  socket.on('edit message', async ({ room, id, text }) => {
    try {
      const sanitized = sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} });
      const msg = await Message.findByIdAndUpdate(id, { text: sanitized }, { new: true });
      if (msg) io.to(room).emit('edit message', { id, text: msg.text });
    } catch(err){ console.error("[Edit] Error:", err); }
  });

  socket.on('delete message', async ({ room, id, scope }) => {
    try {
      const targetRoom = room || socket.currentRoom;
      if (!targetRoom || !id) return;

      if (scope === 'me') {
        socket.emit('delete message local', { id });
        return;
      }

      const msg = await Message.findById(id);
      if (!msg) return;
      if (targetRoom && msg.room !== targetRoom) return;

      const username = socket.username || '';
      const isOwner = msg.user === username;

      if (!socket.isAdmin && !isOwner) {
        socket.emit('toast', { type: 'warn', text: 'You can only delete your own messages.' });
        return;
      }

      const originalFileUrl = msg.fileUrl;

      msg.deleted = true;
      msg.deletedAt = new Date();
      msg.deletedBy = username;
      msg.text = '';
      msg.fileUrl = '';
      msg.fileType = '';
      msg.fileName = '';
      msg.reactions = [];
      msg.starredBy = [];
      msg.pinned = false;
      msg.pinnedBy = '';
      await msg.save();

      if (originalFileUrl) {
        await removeUploadedFileByUrl(originalFileUrl);
      }

      const payload = msg.toJSON ? msg.toJSON() : msg;
      io.to(targetRoom).emit('delete message', { id: payload._id || payload.id, deleted: true, deletedBy: username });
    } catch(err){ console.error("[Delete] Error:", err); }
  });

  socket.on('pin message', async ({ room, id }) => {
    try {
      const targetRoom = room || socket.currentRoom;
      if (!targetRoom || !id) return;

      const msg = await Message.findById(id);
      if (!msg || msg.deleted) return;
      if (targetRoom && msg.room !== targetRoom) return;

      msg.pinned = true;
      msg.pinnedBy = socket.username || '';
      await msg.save();

      const payload = msg.toJSON ? msg.toJSON() : msg;
      io.to(targetRoom).emit('message pinned', payload);
    } catch(err){ console.error("[Pin] Error:", err); }
  });

  socket.on('unpin message', async ({ room, id }) => {
    try {
      const targetRoom = room || socket.currentRoom;
      if (!targetRoom || !id) return;

      const msg = await Message.findById(id);
      if (!msg) return;
      if (targetRoom && msg.room !== targetRoom) return;

      const username = socket.username || '';
      const isOwner = msg.pinnedBy && msg.pinnedBy === username;
      if (!socket.isAdmin && !isOwner) {
        socket.emit('toast', { type: 'warn', text: 'Only admins can remove this pin.' });
        return;
      }

      msg.pinned = false;
      msg.pinnedBy = '';
      await msg.save();

      const payload = msg.toJSON ? msg.toJSON() : msg;
      io.to(targetRoom).emit('message unpinned', payload);
    } catch(err){ console.error("[Unpin] Error:", err); }
  });

  socket.on('get pinned', async ({ room }) => {
    try {
      const pinned = await Message.find({ room, pinned: true, deleted: { $ne: true } }).sort({ timestamp: -1 }).limit(50);
      socket.emit('pinned messages', pinned);
    } catch(err){ console.error("[Pinned fetch] Error:", err); }
  });

  socket.on('star message', async ({ room, id, user }) => {
    try {
      const msg = await Message.findById(id);
      if (!msg || msg.deleted) return;
      if (room && msg.room !== room) return;
      const targetRoom = room || msg.room;
      if (!targetRoom) return;
      if (!msg.starredBy.includes(user)) msg.starredBy.push(user);
      await msg.save();
      io.to(targetRoom).emit('message starred', { id, starredBy: msg.starredBy });
    } catch(err){ console.error("[Star] Error:", err); }
  });

  socket.on('unstar message', async ({ room, id, user }) => {
    try {
      const msg = await Message.findById(id);
      if (!msg || msg.deleted) return;
      if (room && msg.room !== room) return;
      const targetRoom = room || msg.room;
      if (!targetRoom) return;
      msg.starredBy = msg.starredBy.filter(u => u !== user);
      await msg.save();
      io.to(targetRoom).emit('message unstarred', { id, starredBy: msg.starredBy });
    } catch(err){ console.error("[Unstar] Error:", err); }
  });

  socket.on('react message', async ({ room, id, reaction, username }) => {
    try {
      const msg = await Message.findById(id);
      if (!msg || msg.deleted) return;
      if (room && msg.room !== room) return;
      const targetRoom = room || msg.room;
      if (!targetRoom) return;

      const user = typeof username === 'string' ? username.trim() : '';
      if (!user) return;

      const normalizedReaction = typeof reaction === 'string' ? reaction.trim().slice(0, 128) : '';
      const existingIndex = msg.reactions.findIndex((r) => r.user === user);

      if (!normalizedReaction) {
        if (existingIndex >= 0) {
          msg.reactions.splice(existingIndex, 1);
        }
      } else if (existingIndex >= 0) {
        msg.reactions[existingIndex].emoji = normalizedReaction;
      } else {
        msg.reactions.push({ user, emoji: normalizedReaction });
      }

      await msg.save();
      io.to(targetRoom).emit('update reactions', { id, reactions: msg.reactions });
    } catch(err){ console.error("[React] Error:", err); }
  });

  socket.on('search messages', async ({ room, query = '', filter = 'all', limit = 50 } = {}) => {
    try {
      const targetRoom = normaliseRoomName(room) || socket.currentRoom;
      if (!targetRoom) return;

      const conditions = { room: targetRoom, deleted: { $ne: true } };

      if (filter === 'pinned') {
        conditions.pinned = true;
      } else if (filter === 'starred') {
        const username = socket.username || '';
        if (username) conditions.starredBy = username;
        else conditions.starredBy = { $exists: true, $not: { $size: 0 } };
      }

      const limitCount = Math.max(1, Math.min(Number(limit) || 50, 100));
      let results;
      if (query && query.trim()) {
        const searchQuery = query.trim();
        results = await Message.find({ ...conditions, $text: { $search: searchQuery } })
          .sort({ timestamp: -1 })
          .limit(limitCount);
      } else {
        results = await Message.find(conditions)
          .sort({ timestamp: -1 })
          .limit(limitCount);
      }

      const payload = results.map(m => (m.toJSON ? m.toJSON() : m));
      socket.emit('search results', { room: targetRoom, query, filter, results: payload });
    } catch(err){
      console.error('[Search] Error:', err);
      socket.emit('search results', { room: room || socket.currentRoom, query, filter, results: [] });
    }
  });

  // ----- Typing Indicator -----
  socket.on('typing', username => {
    if (!canSendTyping(socket.id)) return;
    const safeName = typeof username === 'string' ? username.trim().slice(0, 64) : '';
    if (!safeName) return;
    registerTypingUser(socket, safeName);
  });

  socket.on('stop typing', () => {
    clearTypingUser(socket);
  });

  // ----- Announcement & Moderation -----
  socket.on('announce', ({ room, text }) => {
    if (!requireAdmin(socket)) return;
    const clean = sanitizeHtml(text || '', { allowedTags: [], allowedAttributes: {} });
    io.to(room).emit('announcement', { text: clean, at: new Date().toISOString(), by: socket.username || 'Admin' });
    console.log('[Announce]', room, 'broadcast by', socket.username || 'Admin');
  });

  socket.on('moderate', ({ room, cmd, target }) => {
    if (!requireAdmin(socket)) return;
    if (!room) return;

    if (cmd === 'ban' && target) {
      const canonicalTarget = canonicalUsername(target);
      addUserBan(room, canonicalTarget);
      const sockets = getSocketsForUser(room, canonicalTarget);
      sockets.forEach((s) => {
        s.emit('moderation notice', { type: 'banned', room });
        s.emit('join error', 'You were banned from the room.');
        removeSocketFromRoom(s, room);
      });
      emitRoomListUpdate();
      emitRoomUsers(room);
      io.to(room).emit('user moderation', {
        room,
        action: 'ban',
        target,
        performedBy: socket.username || 'Admin',
      });
      io.to(room).emit('toast', { type: 'warn', text: `${target} was banned.` });
      console.log('[Moderate] ban', target, 'in', room);
    }
    if (cmd === 'kick' && target) {
      for (const [id, s] of io.of('/').sockets) {
        if (s.currentRoom === room && s.username === target) {
          removeSocketFromRoom(s, room);
          emitRoomListUpdate();
          io.to(room).emit('toast', { type: 'warn', text: `${target} was kicked.` });
          s.emit('join error', 'You were kicked from the room.');
          console.log('[Moderate] kick', target, 'from', room);
        }
      }
    }
  });

  socket.on('moderate user', ({ room, target, action, duration }) => {
    const targetRoom = normaliseRoomName(room) || socket.currentRoom;
    if (!targetRoom || !target) return;
    if (!socket.currentRoom || socket.currentRoom !== targetRoom) return;

    const cleanedTarget = normaliseUsername(target, '').trim();
    if (!cleanedTarget) return;
    const canonicalTarget = canonicalUsername(cleanedTarget);

    const presence = roomPresence.get(targetRoom);
    const targetInfo = presence
      ? Array.from(presence.values()).find((entry) => canonicalUsername(entry.username) === canonicalTarget)
      : null;

    if (!targetInfo) {
      socket.emit('toast', { type: 'warn', text: 'That user is no longer online.' });
      return;
    }

    if (canonicalTarget === canonicalUsername(socket.username)) {
      socket.emit('toast', { type: 'warn', text: 'You cannot perform that action on yourself.' });
      return;
    }

    const isTargetAdmin = Boolean(targetInfo.isAdmin);

    if (!socket.isAdmin) {
      socket.emit('toast', { type: 'warn', text: 'Only admins can perform that action.' });
      return;
    }

    if (isTargetAdmin) {
      socket.emit('toast', { type: 'warn', text: 'You cannot perform that action on an admin.' });
      return;
    }

    const targets = getSocketsForUser(targetRoom, canonicalTarget);
    if (!targets.length) {
      socket.emit('toast', { type: 'warn', text: 'That user is no longer online.' });
      return;
    }

    const describeDuration = (seconds) => {
      if (!seconds) return 'a moment';
      if (seconds < 60) {
        const s = Math.max(1, Math.round(seconds));
        return s === 1 ? '1 second' : `${s} seconds`;
      }
      if (seconds < 3600) {
        const m = Math.round(seconds / 60);
        return m === 1 ? '1 minute' : `${m} minutes`;
      }
      const h = Math.round(seconds / 3600);
      return h === 1 ? '1 hour' : `${h} hours`;
    };

    const performer = socket.username || 'Admin';
    const broadcast = (payload) => {
      io.to(targetRoom).emit('user moderation', { room: targetRoom, ...payload });
    };
    const notifyTargets = (payload) => {
      targets.forEach((s) => s.emit('moderation notice', { room: targetRoom, ...payload }));
    };

    if (action === 'mute') {
      const maxSeconds = socket.isAdmin ? 86400 : 3600;
      const requested = Number(duration) || 60;
      const seconds = Math.max(30, Math.min(requested, maxSeconds));
      const until = setUserMute(targetRoom, canonicalTarget, seconds * 1000);
      notifyTargets({ type: 'muted', until });
      broadcast({ action: 'mute', target: cleanedTarget, performedBy: performer, duration: seconds, until });
      emitRoomUsers(targetRoom);
      socket.emit('toast', {
        type: 'success',
        text: `Muted ${cleanedTarget} for ${describeDuration(seconds)}.`,
      });
      return;
    }

    if (action === 'unmute') {
      const removed = clearUserMute(targetRoom, canonicalTarget);
      if (!removed) {
        socket.emit('toast', { type: 'info', text: `${cleanedTarget} is not muted.` });
        emitRoomUsers(targetRoom);
        return;
      }
      notifyTargets({ type: 'unmuted' });
      broadcast({ action: 'unmute', target: cleanedTarget, performedBy: performer });
      emitRoomUsers(targetRoom);
      socket.emit('toast', { type: 'success', text: `Unmuted ${cleanedTarget}.` });
      return;
    }

    if (action === 'block') {
      if (!socket.isAdmin) {
        socket.emit('toast', { type: 'warn', text: 'Only admins can block users.' });
        return;
      }
      const added = addUserBlock(targetRoom, canonicalTarget);
      if (!added) {
        socket.emit('toast', { type: 'info', text: `${cleanedTarget} is already blocked.` });
        emitRoomUsers(targetRoom);
        return;
      }
      notifyTargets({ type: 'blocked' });
      broadcast({ action: 'block', target: cleanedTarget, performedBy: performer });
      emitRoomUsers(targetRoom);
      socket.emit('toast', { type: 'success', text: `Blocked ${cleanedTarget}.` });
      return;
    }

    if (action === 'unblock') {
      if (!socket.isAdmin) {
        socket.emit('toast', { type: 'warn', text: 'Only admins can unblock users.' });
        return;
      }
      const removed = removeUserBlock(targetRoom, canonicalTarget);
      if (!removed) {
        socket.emit('toast', { type: 'info', text: `${cleanedTarget} was not blocked.` });
        emitRoomUsers(targetRoom);
        return;
      }
      notifyTargets({ type: 'unblocked' });
      broadcast({ action: 'unblock', target: cleanedTarget, performedBy: performer });
      emitRoomUsers(targetRoom);
      socket.emit('toast', { type: 'success', text: `Unblocked ${cleanedTarget}.` });
      return;
    }

    if (action === 'ban') {
      if (!socket.isAdmin) {
        socket.emit('toast', { type: 'warn', text: 'Only admins can ban users.' });
        return;
      }
      addUserBan(targetRoom, canonicalTarget);
      notifyTargets({ type: 'banned' });
      targets.forEach((s) => {
        s.emit('join error', 'You were banned from the room.');
        removeSocketFromRoom(s, targetRoom);
      });
      emitRoomListUpdate();
      emitRoomUsers(targetRoom);
      broadcast({ action: 'ban', target: cleanedTarget, performedBy: performer });
      socket.emit('toast', { type: 'success', text: `Banned ${cleanedTarget}.` });
      return;
    }

    socket.emit('toast', { type: 'warn', text: 'Unknown moderation action.' });
  });

  // ----- Disconnect -----
  socket.on('disconnect', () => {
    console.log('[Socket] Disconnected', socket.id);
    const lastRoom = socket.currentRoom;
    if (lastRoom) {
      removeSocketFromRoom(socket, lastRoom);
      emitRoomListUpdate();
    }
    clearTypingUser(socket, lastRoom);
  });
});

// ---------------- Start Server ----------------
server.listen(PORT, () => {
  console.log("🎛️ DizyChat Fusion — Supernova Live 💜");
  console.log(`Version ${VERSION} (${BUILD})`);
  console.log(`Booted on ${new Date().toLocaleString()}`);
  console.log(`[Server] Listening on ${PORT}`);
});

// ---------------- Catch-all Route ----------------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
