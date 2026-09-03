// ===== DIZYCHAT FUSION — SUPERNOVA LIVE (Self-Hosted Edition) =====
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
const crypto = require('crypto');
const Message = require('./src/models/message');
const User = require('./src/models/user');
const Room = require('./src/models/room');
const { createAccountService } = require('./src/auth/account-service');
const { readLegacyAdminCredentials } = require('./src/auth/legacy-admin-credentials');
const { createSessionStore } = require('./src/auth/session-store');
const { requireModerator, requireOwner } = require('./src/auth/authorization');
const { createRoomPasswordService } = require('./src/rooms/room-password-service');
const soundboardStore = require('./src/utils/soundboard');

const nodeFetchModulePromise = import('node-fetch');
const fetch = (...args) =>
  nodeFetchModulePromise.then(({ default: fetch }) => fetch(...args));

const parseSocketCorsOrigins = () => {
  const raw =
    process.env.SOCKET_IO_CORS_ORIGINS ||
    process.env.SOCKET_IO_CORS_ORIGIN ||
    process.env.CORS_ORIGINS ||
    process.env.CORS_ORIGIN ||
    '';

  if (!raw.trim()) {
    console.warn('[Socket.IO] CORS origin allowlist not configured; defaulting to "*" (not recommended for public deployments).');
    return '*';
  }

  const origins = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (!origins.length) {
    console.warn('[Socket.IO] CORS origin allowlist was empty after parsing; defaulting to "*" (not recommended for public deployments).');
    return '*';
  }

  return origins;
};

// ---------------- App Setup ----------------
const app = express();
const server = http.createServer(app);
const SOCKET_IO_CORS_ORIGIN = parseSocketCorsOrigins();
const ALLOWED_SOCKET_IO_ORIGINS = Array.isArray(SOCKET_IO_CORS_ORIGIN)
  ? new Set(SOCKET_IO_CORS_ORIGIN)
  : null;
const io = new Server(server, {
  cors: { origin: SOCKET_IO_CORS_ORIGIN, methods: ["GET", "POST"] }
});
const PORT = process.env.PORT || 10000;
const TRUSTED_SCRIPT_SOURCES = [
  "'self'",
  "'unsafe-inline'",
  "https://cdn.socket.io",
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
  "https://rumble.com",
  "https://w.soundcloud.com",
  "https://w2g.tv",
  "https://*.w2g.tv",
];
const TRUSTED_FRAME_SOURCES = [
  "'self'",
  "https://www.youtube.com",
  "https://www.youtube-nocookie.com",
  "https://open.spotify.com",
  "https://w.soundcloud.com",
  "https://rumble.com",
  "https://*.rumble.com",
  "https://w2g.tv",
  "https://*.w2g.tv",
];
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src ${TRUSTED_SCRIPT_SOURCES.join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss: https:",
  "media-src 'self' blob: https:",
  `frame-src ${TRUSTED_FRAME_SOURCES.join(' ')}`,
  `child-src ${TRUSTED_FRAME_SOURCES.join(' ')}`,
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

const logSecurityEvent = (eventName, details = {}, level = 'warn') => {
  const logger = typeof console[level] === 'function' ? console[level] : console.warn;
  logger(`[Security] ${eventName}`, {
    ...details,
    at: new Date().toISOString(),
  });
};

// ---------------- Admin ----------------
const normaliseAdminUsername = (value) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const parseAdminSessionTtlMs = () => {
  const raw = process.env.ADMIN_SESSION_TTL_MINUTES;
  if (!raw) return 30 * 60 * 1000;

  const numeric = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) return 30 * 60 * 1000;

  const minMinutes = 5;
  const maxMinutes = 8 * 60;
  const safeMinutes = Math.min(Math.max(numeric, minMinutes), maxMinutes);
  return safeMinutes * 60 * 1000;
};

const ADMIN_SESSION_TTL_MS = parseAdminSessionTtlMs();
const parsePositiveIntegerEnv = (name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
};

const ADMIN_AUTH_WINDOW_MS = parsePositiveIntegerEnv('ADMIN_AUTH_WINDOW_MS', 10 * 60 * 1000, { min: 1000, max: 24 * 60 * 60 * 1000 });
const ADMIN_AUTH_MAX_FAILURES = parsePositiveIntegerEnv('ADMIN_AUTH_MAX_FAILURES', 5, { min: 2, max: 20 });
const ADMIN_AUTH_LOCK_MS = parsePositiveIntegerEnv('ADMIN_AUTH_LOCK_MS', 15 * 60 * 1000, { min: 5000, max: 24 * 60 * 60 * 1000 });
const ADMIN_AUTH_MIN_RETRY_DELAY_MS = 750;
const ADMIN_AUTH_MAX_RETRY_DELAY_MS = 5000;
const LIVEKIT_URL_ENV_NAMES = [
  'LIVEKIT_URL',
  'LIVE_KIT_URL',
  'LIVEKIT_WS_URL',
  'LIVEKIT_SERVER_URL',
];
const LIVEKIT_API_KEY_ENV_NAMES = [
  'LIVEKIT_API_KEY',
  'LIVE_KIT_API_KEY',
  'LIVEKIT_KEY',
];
const LIVEKIT_API_SECRET_ENV_NAMES = [
  'LIVEKIT_API_SECRET',
  'LIVE_KIT_API_SECRET',
  'LIVEKIT_SECRET',
];
const readFirstConfiguredEnv = (names) => {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return { name, value };
  }
  return { name: '', value: '' };
};
const LIVEKIT_URL_ENV = readFirstConfiguredEnv(LIVEKIT_URL_ENV_NAMES);
const LIVEKIT_API_KEY_ENV = readFirstConfiguredEnv(LIVEKIT_API_KEY_ENV_NAMES);
const LIVEKIT_API_SECRET_ENV = readFirstConfiguredEnv(LIVEKIT_API_SECRET_ENV_NAMES);
const LIVEKIT_URL_RAW = LIVEKIT_URL_ENV.value;
const normalizeLivekitUrl = (rawUrl) => {
  if (!rawUrl) return '';
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'https:') parsed.protocol = 'wss:';
    if (parsed.protocol === 'http:') parsed.protocol = 'ws:';
    if (!['ws:', 'wss:'].includes(parsed.protocol)) return '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch (_err) {
    return '';
  }
};
const LIVEKIT_URL = normalizeLivekitUrl(LIVEKIT_URL_RAW);
const LIVEKIT_API_KEY = LIVEKIT_API_KEY_ENV.value;
const LIVEKIT_API_SECRET = LIVEKIT_API_SECRET_ENV.value;
const hasLivekitCredentials = () => Boolean(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET);
const parseVoiceCallsEnabled = () => {
  const raw = String(process.env.ENABLE_VOICE_CALLS || '').trim().toLowerCase();
  if (['false', '0', 'no', 'off', 'disabled'].includes(raw)) return false;
  if (['true', '1', 'yes', 'on', 'enabled'].includes(raw)) return true;
  return hasLivekitCredentials();
};
const ENABLE_VOICE_CALLS = parseVoiceCallsEnabled();
const CALL_TOKEN_TTL_SECONDS = 10 * 60;
const MUSIC_MODE_AUDIO_BITRATE = 320000;
const MUSIC_MODE_AUDIO_SETTINGS = Object.freeze({
  channelCount: 2,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  audioBitrate: MUSIC_MODE_AUDIO_BITRATE,
  dtx: false,
  red: false,
  forceStereo: true,
});
const CALL_EVENT_WINDOW_MS = 4000;
const CALL_EVENT_MAX_PER_WINDOW = 30;
const W2G_API_KEY_ENV_NAMES = [
  'W2G_API_KEY',
  'WATCH2GETHER_API_KEY',
  'WATCH_2_GETHER_API_KEY',
];
const W2G_API_KEY_ENV = readFirstConfiguredEnv(W2G_API_KEY_ENV_NAMES);
const W2G_API_KEY = W2G_API_KEY_ENV.value;
const W2G_CREATE_ROOM_URL = process.env.W2G_CREATE_ROOM_URL || 'https://api.w2g.tv/rooms/create.json';
const W2G_ROOM_BASE_URL = process.env.W2G_ROOM_BASE_URL || 'https://w2g.tv/rooms';
const W2G_REQUEST_TIMEOUT_MS = parsePositiveIntegerEnv('W2G_REQUEST_TIMEOUT_MS', 10000, { min: 1000, max: 30000 });
const WATCH_PARTY_EVENT_WINDOW_MS = 60 * 1000;
const WATCH_PARTY_MAX_CREATES_PER_WINDOW = 3;

const JACKTRIP_STUDIO_CREATE_URL = String(process.env.JACKTRIP_STUDIO_CREATE_URL || 'https://app.jacktrip.org/studios/create').trim();
const JACKTRIP_STUDIO_INVITE_URL = String(process.env.JACKTRIP_STUDIO_INVITE_URL || '').trim();
const SONOBUS_DOWNLOAD_URL = String(process.env.SONOBUS_DOWNLOAD_URL || 'https://sonobus.net/index.html').trim();
const JAM_SESSION_EVENT_WINDOW_MS = 60 * 1000;
const JAM_SESSION_MAX_CREATES_PER_WINDOW = 12;

const SCRYPT_HASH_PREFIX = 'scrypt';

const parseScryptParams = (raw, fallback) => {
  const numeric = Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return numeric;
};

const verifyScryptPassword = (password, encodedHash) => {
  if (typeof password !== 'string' || typeof encodedHash !== 'string') return false;
  const parts = encodedHash.split('$');
  if (parts.length !== 7) return false;
  const [algorithm, rawN, rawR, rawP, saltBase64, keyBase64, rawKeyLength] = parts;
  if (algorithm !== SCRYPT_HASH_PREFIX) return false;

  const N = parseScryptParams(rawN, 16384);
  const r = parseScryptParams(rawR, 8);
  const p = parseScryptParams(rawP, 1);
  const keyLength = parseScryptParams(rawKeyLength, 64);

  let salt;
  let expectedKey;
  try {
    salt = Buffer.from(saltBase64, 'base64');
    expectedKey = Buffer.from(keyBase64, 'base64');
  } catch (_err) {
    return false;
  }

  if (!salt.length || !expectedKey.length || expectedKey.length !== keyLength) return false;

  const actualKey = crypto.scryptSync(password, salt, keyLength, { N, r, p });
  return crypto.timingSafeEqual(actualKey, expectedKey);
};

const buildAdminCredentials = () => {
  const entries = new Map();

  const addCredential = (username, credentialValue, kind) => {
    if (typeof username !== 'string' || typeof credentialValue !== 'string') return;
    const trimmedUsername = username.trim();
    const trimmedCredential = credentialValue.trim();
    if (!trimmedUsername || !trimmedCredential) return;
    const key = normaliseAdminUsername(trimmedUsername);
    if (!key) return;
    entries.set(key, {
      username: trimmedUsername,
      kind,
      credential: trimmedCredential,
    });
  };

  // ADMIN_CREDENTIALS_HASHED format: "username:scrypt$N$r$p$salt$key$length,OtherUser:scrypt$..."
  const rawHashedList = process.env.ADMIN_CREDENTIALS_HASHED;
  if (typeof rawHashedList === 'string' && rawHashedList.trim()) {
    rawHashedList
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((entry) => {
        const [rawUsername, ...rest] = entry.split(':');
        if (!rawUsername || rest.length === 0) return;
        const candidateHash = rest.join(':');
        addCredential(rawUsername, candidateHash, 'scrypt');
      });
  }

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
        addCredential(rawUsername, candidatePassword, 'plaintext');
      });
  }

  const envAdminUsername = process.env.ADMIN_USERNAME;
  const envAdminPasswordHash = process.env.ADMIN_PASSWORD_HASH;
  if (envAdminUsername && envAdminPasswordHash) {
    addCredential(envAdminUsername, envAdminPasswordHash, 'scrypt');
  }

  const envAdminPassword = process.env.ADMIN_PASSWORD;
  if (envAdminUsername && envAdminPassword) {
    addCredential(envAdminUsername, envAdminPassword, 'plaintext');
  }

  if (!entries.size && envAdminPassword) {
    addCredential(envAdminUsername || 'Dizygotic', envAdminPassword, 'plaintext');
  }

  return entries;
};

const adminCredentials = readLegacyAdminCredentials(process.env);
const accountService = createAccountService({ UserModel: User, legacyCredentials: adminCredentials });
const accountSessions = createSessionStore({ ttlMs: ADMIN_SESSION_TTL_MS });
const roomPasswordService = createRoomPasswordService({ RoomModel: Room });
const roomPasswords = new Map();
const PERSISTENT_ROOMS = [
  'General Chat',
  'AJN Chat',
  'Drum & Bass Chat',
  'Psybin Radio',
];
const PERSISTENT_ROOM_SET = new Set(PERSISTENT_ROOMS);
const plaintextAdminCredentialCount = [...adminCredentials.values()].filter((item) => item.kind === 'plaintext').length;
if (plaintextAdminCredentialCount > 0) {
  console.warn(`[Admin] ${plaintextAdminCredentialCount} plaintext admin credential(s) detected. Migrate to ADMIN_PASSWORD_HASH / ADMIN_CREDENTIALS_HASHED.`);
}
const adminAuthFailures = new Map();

const getSocketRemoteAddress = (socket) => {
  const forwardedFor = socket?.handshake?.headers?.['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }
  return socket?.handshake?.address || socket?.conn?.remoteAddress || 'unknown';
};

const getAdminAuthAttemptKey = (socket, username) => {
  const remoteAddress = getSocketRemoteAddress(socket);
  const canonicalUser = normaliseAdminUsername(username || '');
  return `${remoteAddress}::${canonicalUser || '*'}`;
};

const getAdminAuthState = (attemptKey) => {
  const now = Date.now();
  const existing = adminAuthFailures.get(attemptKey);
  if (!existing) return { count: 0, windowStart: now, lockUntil: 0, lastFailedAt: 0 };

  if (existing.lockUntil && existing.lockUntil > now) return existing;
  if (existing.windowStart + ADMIN_AUTH_WINDOW_MS <= now) {
    const reset = { count: 0, windowStart: now, lockUntil: 0, lastFailedAt: 0 };
    adminAuthFailures.set(attemptKey, reset);
    return reset;
  }
  return existing;
};

const computeAdminAuthRetryDelayMs = (state) => {
  const failures = Number.isFinite(state?.count) ? state.count : 0;
  const exponent = Math.max(0, failures - 1);
  const delay = ADMIN_AUTH_MIN_RETRY_DELAY_MS * (2 ** exponent);
  return Math.min(delay, ADMIN_AUTH_MAX_RETRY_DELAY_MS);
};

const registerAdminAuthFailure = (attemptKey) => {
  const now = Date.now();
  const state = getAdminAuthState(attemptKey);
  const nextCount = state.count + 1;
  const lockUntil = nextCount >= ADMIN_AUTH_MAX_FAILURES ? now + ADMIN_AUTH_LOCK_MS : 0;
  const updated = {
    count: nextCount,
    windowStart: state.windowStart || now,
    lockUntil,
    lastFailedAt: now,
  };
  adminAuthFailures.set(attemptKey, updated);
  return updated;
};

const clearAdminAuthFailures = (attemptKey) => {
  adminAuthFailures.delete(attemptKey);
};

// ---------------- MongoDB ----------------
const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
  console.error("[Mongo] MONGO_URI missing");
  process.exit(1);
}
const MONGO_RETRY_BASE_MS = 3000;
let mongoReconnectTimer = null;
let mongoConnectInFlight = false;

const scheduleMongoReconnect = (delayMs = MONGO_RETRY_BASE_MS) => {
  if (mongoReconnectTimer) return;
  const safeDelay = Math.max(1000, Number(delayMs) || MONGO_RETRY_BASE_MS);
  mongoReconnectTimer = setTimeout(() => {
    mongoReconnectTimer = null;
    connectMongoWithRetry();
  }, safeDelay);
};

const connectMongoWithRetry = async () => {
  if (mongoConnectInFlight || mongoose.connection.readyState === 1) return;
  mongoConnectInFlight = true;
  try {
    await mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });
    await accountService.bootstrapProtectedAccounts();
    await roomPasswordService.ensureRooms(PERSISTENT_ROOMS);
    const persistedRoomPasswords = await roomPasswordService.loadAll();
    roomPasswords.clear();
    for (const [roomName, passwordHash] of persistedRoomPasswords.entries()) {
      roomPasswords.set(roomName, passwordHash);
    }
    console.log("[Mongo] Connected");
    console.log("[Auth v2] Protected accounts bootstrapped");
    console.log(`[Rooms] Loaded ${roomPasswords.size} persisted room password state(s)`);
  } catch (err) {
    if (mongoose.connection.readyState === 1) {
      try {
        await mongoose.disconnect();
      } catch (disconnectError) {
        console.error("[Mongo] Disconnect after bootstrap failure failed:", disconnectError?.message || disconnectError);
      }
    }
    console.error("[Mongo] Initial connect/Auth v2 bootstrap failed, retrying:", err?.message || err);
    scheduleMongoReconnect();
  } finally {
    mongoConnectInFlight = false;
  }
};

mongoose.connection.on('disconnected', () => {
  console.warn("[Mongo] Disconnected, attempting reconnect.");
  scheduleMongoReconnect();
});

mongoose.connection.on('error', (err) => {
  console.error("[Mongo] Connection error:", err?.message || err);
  scheduleMongoReconnect();
});

connectMongoWithRetry();

// ---------------- Static Files ----------------
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=*, microphone=*, geolocation=()');
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  next();
});
app.use(
  '/uploads',
  express.static(uploadDir, {
    maxAge: '30d',
    immutable: true,
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  })
);
app.use(express.static(path.join(__dirname, 'public')));

// ---------------- Version endpoint ----------------
const VERSION = "1.3";
const BUILD = "fusion-supernova";
app.get('/version', (req, res) => {
  res.json({ version: VERSION, build: BUILD, time: new Date().toISOString() });
});

// ---------------- File Uploads ----------------
const fsPromises = fs.promises;
const TEMPORARY_UPLOAD_EXTENSION = '.upload';
const MAX_STORED_UPLOAD_EXTENSION_LENGTH = 64;

const normaliseStoredUploadExtension = (ext) => {
  const cleaned = String(ext || '')
    .toLowerCase()
    .trim()
    .replace(/[^.a-z0-9_-]/gi, '');

  if (!cleaned || cleaned === '.') return TEMPORARY_UPLOAD_EXTENSION;

  const withLeadingDot = cleaned.startsWith('.') ? cleaned : `.${cleaned}`;
  if (withLeadingDot.length <= MAX_STORED_UPLOAD_EXTENSION_LENGTH) return withLeadingDot;

  return withLeadingDot.slice(0, MAX_STORED_UPLOAD_EXTENSION_LENGTH);
};

const getSafeStoredUploadExtension = (file) => {
  // Keep uploads permissive while still avoiding path traversal: stored names are
  // generated by the server and only the final extension is copied from the client.
  const originalExt = path.extname(String(file?.originalname || ''));
  return normaliseStoredUploadExtension(originalExt);
};

const validateUploadOrigin = (req, res, next) => {
  if (!ALLOWED_SOCKET_IO_ORIGINS) return next();
  const originHeader = req.headers.origin;
  if (!originHeader) return next();
  if (ALLOWED_SOCKET_IO_ORIGINS.has(originHeader)) return next();
  return res.status(403).json({ error: 'Origin not allowed' });
};

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
const PSYBIN_STATUS_URL =
  process.env.PSYBIN_STATUS_URL || 'https://www.psyb.in/radio/status-json.xsl';
const PSYBIN_CURRENT_SONG_URL =
  process.env.PSYBIN_CURRENT_SONG_URL || 'https://psyb.in/current_song.txt';
const PSYBIN_CURRENT_TRACK_TIME_URL =
  process.env.PSYBIN_CURRENT_TRACK_TIME_URL || 'https://psyb.in/current_track_time.txt';
const PSYBIN_CURRENT_COVER_URL =
  process.env.PSYBIN_CURRENT_COVER_URL || 'https://psyb.in/tmp/cover.jpg';
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

  const fallbackMetadata = async () => {
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

    return mapPsybinNowPlaying(payload);
  };

  try {
    const [songResult, timeResult] = await Promise.allSettled([
      fetch(PSYBIN_CURRENT_SONG_URL, {
        method: 'GET',
        headers: {
          'user-agent': 'DizyChat/1.0 (+https://dizy.chat)',
          accept: 'text/plain',
        },
        signal: controller?.signal,
      }),
      fetch(PSYBIN_CURRENT_TRACK_TIME_URL, {
        method: 'GET',
        headers: {
          'user-agent': 'DizyChat/1.0 (+https://dizy.chat)',
          accept: 'text/plain',
        },
        signal: controller?.signal,
      }),
    ]);

    if (songResult.status !== 'fulfilled') {
      throw songResult.reason || new Error('Failed to fetch Psybin song data');
    }

    const songResponse = songResult.value;
    const timeResponse = timeResult.status === 'fulfilled' ? timeResult.value : null;

    if (!songResponse.ok) {
      throw new Error(`HTTP ${songResponse.status}`);
    }

    const rawSong = await songResponse.text();
    const lines = rawSong
      .split(/\r?\n/g)
      .map((line) => normalisePsybinString(line))
      .filter(Boolean);

    const latestLine = lines.length ? lines[lines.length - 1] : '';
    const split = splitPsybinArtistTitle(latestLine);
    let artist = split?.artist || '';
    let title = split?.title || '';
    let text = latestLine || '';

    if (!text || (!artist && !title)) {
      try {
        const fallback = await fallbackMetadata();
        artist = fallback.artist;
        title = fallback.title;
        text = fallback.text;
      } catch (fallbackErr) {
        console.warn('[Psybin] Fallback metadata fetch failed', fallbackErr?.message);
      }
    }

    let remainingMs = null;
    if (timeResponse?.ok) {
      const remainingText = await timeResponse.text().catch(() => '');
      const numeric = Number.parseFloat(normalisePsybinString(remainingText));
      if (Number.isFinite(numeric) && numeric >= 0) {
        remainingMs = Math.round(numeric * 1000);
      }
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      title,
      artist,
      text,
      coverUrl: PSYBIN_CURRENT_COVER_URL,
      remainingMs,
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
    cb(null, file.fieldname + '-' + unique + getSafeStoredUploadExtension(file));
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

app.post('/upload', validateUploadOrigin, uploadSingleMiddleware, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  // Temporarily accept uploads without MIME, file-signature, or antivirus gating so
  // mobile camera/library files can be tested before upload security is re-added.
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

  if (!/^https?:\/\//i.test(url)) {
    url = 'http://' + url;
  } else {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' && parsed.port && parsed.port !== '443') {
        parsed.protocol = 'http:';
        url = parsed.toString();
      }
    } catch (_err) {
      /* fall back to original url */
    }
  }

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

const pickGiphyMedia = (gif, mediaType = 'gif') => {
  const images = gif?.images || {};
  const preview =
    images.fixed_width_small?.webp ||
    images.fixed_width_small?.url ||
    images.fixed_height_small?.webp ||
    images.fixed_height_small?.url ||
    images.preview_gif?.url ||
    images.downsized_still?.url ||
    '';
  const full =
    images.original?.url ||
    images.downsized?.url ||
    images.fixed_height?.url ||
    images.fixed_width?.url ||
    preview;
  const mp4 =
    images.original?.mp4 ||
    images.downsized_small?.mp4 ||
    images.fixed_height?.mp4 ||
    images.fixed_width?.mp4 ||
    '';

  if (!preview && !full && !mp4) return null;

  return {
    id: gif?.id || '',
    title: gif?.title || gif?.alt_text || (mediaType === 'clip' ? 'Clip' : mediaType === 'sticker' ? 'Sticker' : mediaType === 'emoji' ? 'Emoji' : 'GIF'),
    preview,
    gif: full,
    mp4,
    url: gif?.url || '',
    provider: 'giphy',
    mediaType,
    analytics: gif?.analytics || null,
    hasSound: mediaType === 'clip',
  };
};

const pickGiphyClip = (clip) => {
  const videoAssets = clip?.video?.assets || clip?.assets || {};
  const preferredVideo =
    videoAssets?.['360p'] ||
    videoAssets?.['480p'] ||
    videoAssets?.['720p'] ||
    videoAssets?.['1080p'] ||
    videoAssets?.['4k'] ||
    videoAssets?.source ||
    videoAssets?.original ||
    videoAssets?.hd ||
    videoAssets?.sd ||
    {};
  const images = clip?.images || {};
  const preview =
    images.fixed_width?.webp ||
    images.fixed_width?.url ||
    images.fixed_height?.webp ||
    images.fixed_height?.url ||
    images.original?.webp ||
    images.original?.url ||
    preferredVideo?.url ||
    '';
  const mp4 =
    preferredVideo?.url ||
    clip?.video?.url ||
    images.original?.mp4 ||
    '';

  if (!preview && !mp4) return null;

  return {
    id: clip?.id || '',
    title: clip?.title || clip?.slug || 'Clip',
    preview: preview || mp4,
    gif: '',
    mp4,
    url: clip?.url || '',
    provider: 'giphy',
    mediaType: 'clip',
    analytics: clip?.analytics || null,
    hasSound: true,
  };
};

const getFallbackGiphyClipUrl = (endpoint) => {
  const fallbackEndpoint = endpoint === 'search' ? 'search' : 'trending';
  return `https://api.giphy.com/v1/gifs/${fallbackEndpoint}`;
};

const getGiphyPagination = (data, offset) =>
  data?.pagination || { count: Array.isArray(data?.data) ? data.data.length : 0, offset, total_count: 0 };

const parseCountryCode = (value) => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return '';
  const country = raw.trim().slice(0, 2).toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : '';
};

const getRequestCountryCode = (req) =>
  parseCountryCode(req.headers['cf-ipcountry']) ||
  parseCountryCode(req.headers['x-vercel-ip-country']) ||
  parseCountryCode(req.headers['x-country-code']) ||
  'US';

app.get('/giphy-search', async (req, res) => {
  const giphyKey = process.env.GIPHY_SDK_KEY;
  if (!giphyKey) {
    return res.status(503).json({
      error: 'GIPHY_SDK_KEY is not configured.',
      results: [],
    });
  }

  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 24, 1), 50);
  const offset = Math.min(Math.max(Number.parseInt(req.query.offset, 10) || 0, 0), 4999);
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const requestedType = typeof req.query.type === 'string' ? req.query.type.toLowerCase() : 'gifs';
  const safeType = ['gifs', 'stickers', 'emoji', 'clips', 'text'].includes(requestedType) ? requestedType : 'gifs';
  const endpoint = query ? 'search' : 'trending';
  const params = new URLSearchParams({
    api_key: giphyKey,
    limit: String(limit),
    rating: 'pg-13',
  });
  if (offset > 0) params.set('offset', String(offset));

  if (query) params.set('q', safeType === 'text' ? `text ${query}` : query);
  if (safeType === 'clips') {
    params.set('country_code', getRequestCountryCode(req));
    params.set('bundle', 'clips_grid_picker');
  }
  if (safeType === 'gifs') params.set('bundle', 'messaging_non_clips');

  const apiPath = (() => {
    if (safeType === 'clips') return `https://api.giphy.com/v1/clips/${endpoint}`;
    if (safeType === 'emoji') return 'https://api.giphy.com/v2/emoji';
    if (safeType === 'stickers' || safeType === 'text') return `https://api.giphy.com/v1/stickers/${endpoint}`;
    return `https://api.giphy.com/v1/gifs/${endpoint}`;
  })();

  try {
    const response = await fetch(`${apiPath}?${params.toString()}`);
    const data = await response.json();

    let payloadData = data;
    let payloadType = safeType;
    let fallbackNotice = '';

    if (!response.ok) {
      const apiMessage = data?.message || data?.meta?.msg || response.statusText;
      const isClipApprovalError = safeType === 'clips' && (response.status === 401 || response.status === 403);

      if (!isClipApprovalError) {
        const error = apiMessage || 'GIPHY request failed.';
        console.error('[GIPHY] Error:', error);
        return res.status(response.status).json({
          error,
          results: [],
        });
      }

      fallbackNotice = 'GIPHY Clips API access is not approved for this SDK key, so video GIF results are shown instead.';
      console.warn('[GIPHY] Clips API unavailable for this key; falling back to GIF video results.');
      const fallbackParams = new URLSearchParams(params);
      fallbackParams.delete('country_code');
      fallbackParams.set('bundle', 'messaging_non_clips');
      const fallbackResponse = await fetch(`${getFallbackGiphyClipUrl(endpoint)}?${fallbackParams.toString()}`);
      const fallbackData = await fallbackResponse.json();

      if (!fallbackResponse.ok) {
        const fallbackError = fallbackData?.message || fallbackData?.meta?.msg || fallbackResponse.statusText || fallbackNotice;
        console.error('[GIPHY] Fallback Error:', fallbackError);
        return res.status(fallbackResponse.status).json({
          error: fallbackError,
          results: [],
        });
      }

      payloadData = fallbackData;
      payloadType = 'clip-fallback';
    }

    res.setHeader('Cache-Control', query ? 'no-store' : 'public, max-age=300');
    res.json({
      provider: 'giphy',
      mediaType: payloadType,
      warning: fallbackNotice,
      pagination: getGiphyPagination(payloadData, offset),
      results: (payloadData?.data || [])
        .map((item) => (safeType === 'clips' && payloadType !== 'clips'
          ? pickGiphyMedia(item, 'clip')
          : safeType === 'clips'
            ? pickGiphyClip(item)
            : pickGiphyMedia(item, safeType === 'gifs' ? 'gif' : safeType)))
        .filter(Boolean),
    });
  } catch (err) {
    console.error('[GIPHY] Error:', err.message);
    res.status(502).json({ error: 'GIPHY request failed.', results: [] });
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

app.get('/api/watch-party/status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    provider: 'watch2gether',
    configured: Boolean(W2G_API_KEY),
    missingRequiredEnv: W2G_API_KEY ? [] : ['W2G_API_KEY'],
    acceptedEnvironmentVariables: {
      W2G_API_KEY: W2G_API_KEY_ENV_NAMES,
    },
    detectedEnvironmentVariables: {
      W2G_API_KEY: W2G_API_KEY_ENV.name || '',
    },
  });
});

const jamSessionTimestamps = new Map();

const canCreateJamSession = (socketKey) => {
  const key = socketKey || 'unknown';
  const now = Date.now();
  if (!jamSessionTimestamps.has(key)) jamSessionTimestamps.set(key, []);
  const ts = jamSessionTimestamps.get(key).filter((time) => now - time < JAM_SESSION_EVENT_WINDOW_MS);
  if (ts.length >= JAM_SESSION_MAX_CREATES_PER_WINDOW) {
    jamSessionTimestamps.set(key, ts);
    return false;
  }
  ts.push(now);
  jamSessionTimestamps.set(key, ts);
  return true;
};

const safeJamSlug = (value) => {
  const cleaned = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || 'dizychat-jam';
};

const getJamProviders = () => [
  {
    id: 'jacktrip',
    name: 'JackTrip',
    badge: 'Free test available',
    bestFor: 'Highest-quality low-latency musician sessions with the JackTrip desktop app or browser studio.',
    mode: JACKTRIP_STUDIO_INVITE_URL ? 'configured-link' : 'create-studio',
    freeTier: true,
    maxFreeMusicians: 5,
    freeSessionMinutes: 30,
    requiresInstallForBestAudio: true,
    supportsBrowserJoin: true,
    supportsAsioViaNativeApp: true,
    url: JACKTRIP_STUDIO_INVITE_URL || JACKTRIP_STUDIO_CREATE_URL,
    setupTips: [
      'Create or open a free JackTrip Studio, then share its invite with the room.',
      'Use the JackTrip desktop app for the best latency and audio-interface support.',
      'Use wired Ethernet and headphones; avoid Wi-Fi and speakers for live instruments.',
    ],
  },
  {
    id: 'sonobus',
    name: 'SonoBus',
    badge: 'Free fallback',
    bestFor: 'Open-source peer-to-peer audio groups with ASIO support on Windows and DAW plugin options.',
    mode: 'external-app',
    freeTier: true,
    requiresInstallForBestAudio: true,
    supportsBrowserJoin: false,
    supportsAsioViaNativeApp: true,
    url: SONOBUS_DOWNLOAD_URL,
    setupTips: [
      'Install SonoBus, choose the generated group name, and optionally set the generated password.',
      'SonoBus does not use echo cancellation, so everyone should use headphones.',
      'SonoBus notes that its audio/data communication is not currently encrypted.',
    ],
  },
];

app.get('/api/jam/status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    enabled: true,
    recommendedProvider: 'jacktrip',
    providers: getJamProviders(),
  });
});

app.post('/api/jam/session', express.json(), (req, res) => {
  const remoteAddress = req.ip || req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  if (!canCreateJamSession(String(remoteAddress).split(',')[0].trim())) {
    res.status(429).json({ error: 'Too many jam session requests. Please wait a minute and try again.' });
    return;
  }

  const providers = getJamProviders();
  const providerId = String(req.body?.provider || 'jacktrip').trim().toLowerCase();
  const provider = providers.find((entry) => entry.id === providerId);
  if (!provider) {
    res.status(400).json({ error: 'Unsupported jam provider.', providers });
    return;
  }

  const room = normaliseRoomName(req.body?.room) || 'DizyChat Jam';
  const roomSlug = safeJamSlug(room);
  const sessionId = `${roomSlug}-${crypto.randomBytes(3).toString('hex')}`;
  const password = crypto.randomBytes(4).toString('hex');

  const session = {
    provider: provider.id,
    providerName: provider.name,
    room,
    sessionId,
    title: `${room} Jam`,
    url: provider.url,
    freeTier: provider.freeTier,
    badge: provider.badge,
    mode: provider.mode,
    setupTips: provider.setupTips,
  };

  if (provider.id === 'jacktrip') {
    session.freeSessionMinutes = provider.freeSessionMinutes;
    session.maxFreeMusicians = provider.maxFreeMusicians;
    session.instructions = [
      'JackTrip has a free hosted-studio test path: up to 5 musicians for 30 minutes.',
      'Open JackTrip, create/start a studio, then paste the JackTrip studio invite back into this DizyChat room.',
      'For the best ASIO/audio-interface path, join through the JackTrip desktop app instead of only the browser.',
    ];
  } else if (provider.id === 'sonobus') {
    session.groupName = sessionId;
    session.password = password;
    session.instructions = [
      `Open SonoBus and join group ${sessionId}.`,
      `Use password ${password} if you want a private group.`,
      'Use headphones and wired Ethernet; SonoBus does not currently encrypt audio/data communication.',
    ];
  }

  res.json({ session, providers });
});

const getCallServiceStatus = () => {
  const livekitUrlPresent = Boolean(LIVEKIT_URL_RAW || LIVEKIT_URL);
  const livekitUrlValid = Boolean(LIVEKIT_URL);
  const configured = hasLivekitCredentials();
  const forcedOff = ['false', '0', 'no', 'off', 'disabled'].includes(
    String(process.env.ENABLE_VOICE_CALLS || '').trim().toLowerCase()
  );
  const livekitUrlDetails = (() => {
    try {
      const parsed = LIVEKIT_URL ? new URL(LIVEKIT_URL) : null;
      return {
        host: parsed?.host || '',
        protocol: parsed?.protocol || '',
      };
    } catch (_err) {
      return { host: '', protocol: '' };
    }
  })();
  const missingRequiredEnv = [
    !livekitUrlPresent ? 'LIVEKIT_URL' : '',
    !LIVEKIT_API_KEY ? 'LIVEKIT_API_KEY' : '',
    !LIVEKIT_API_SECRET ? 'LIVEKIT_API_SECRET' : '',
  ].filter(Boolean);
  const acceptedEnvironmentVariables = {
    LIVEKIT_URL: LIVEKIT_URL_ENV_NAMES,
    LIVEKIT_API_KEY: LIVEKIT_API_KEY_ENV_NAMES,
    LIVEKIT_API_SECRET: LIVEKIT_API_SECRET_ENV_NAMES,
  };
  const detectedEnvironmentVariables = {
    LIVEKIT_URL: LIVEKIT_URL_ENV.name || '',
    LIVEKIT_API_KEY: LIVEKIT_API_KEY_ENV.name || '',
    LIVEKIT_API_SECRET: LIVEKIT_API_SECRET_ENV.name || '',
  };
  const missingDetails = missingRequiredEnv.length
    ? ` Missing: ${missingRequiredEnv.join(', ')}.`
    : '';
  return {
    enabled: ENABLE_VOICE_CALLS,
    configured,
    provider: 'livekit',
    selfContained: false,
    voiceOnly: false,
    supportsAudio: true,
    supportsVideo: true,
    livekitHost: livekitUrlDetails.host,
    livekitUrlPresent,
    livekitUrlValid,
    livekitUrlProtocol: LIVEKIT_URL ? new URL(LIVEKIT_URL).protocol : '',
    acceptedEnvironmentVariables,
    detectedEnvironmentVariables,
    missingRequiredEnv,
    missing: {
      LIVEKIT_URL: !livekitUrlPresent,
      LIVEKIT_API_KEY: !LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET: !LIVEKIT_API_SECRET,
    },
    reason: forcedOff
      ? 'Live calls are disabled by ENABLE_VOICE_CALLS=false.'
      : !livekitUrlPresent
        ? `LiveKit call provider is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.${missingDetails}`
        : !livekitUrlValid
          ? 'LIVEKIT_URL must be a valid ws://, wss://, http://, or https:// URL. LiveKit Cloud URLs are usually wss://<project>.livekit.cloud.'
          : configured
            ? 'LiveKit call provider is configured.'
            : `LiveKit call provider is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.${missingDetails}`,
  };
};

app.get('/api/calls/status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    res.json(getCallServiceStatus());
  } catch (err) {
    console.error('[Calls] Failed to report status:', err.message);
    res.json({
      enabled: false,
      configured: false,
      provider: 'livekit',
      selfContained: false,
      voiceOnly: false,
      supportsAudio: true,
      supportsVideo: true,
      livekitHost: '',
      livekitUrlPresent: Boolean(LIVEKIT_URL_RAW),
      livekitUrlValid: false,
      livekitUrlProtocol: '',
      missing: {
        LIVEKIT_URL: !LIVEKIT_URL_RAW,
        LIVEKIT_API_KEY: !LIVEKIT_API_KEY,
        LIVEKIT_API_SECRET: !LIVEKIT_API_SECRET,
      },
      reason: 'Call status could not be checked safely. Verify LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.',
    });
  }
});

app.post('/api/calls/token', express.json(), (req, res) => {
  let status;
  try {
    status = getCallServiceStatus();
  } catch (err) {
    console.error('[Calls] Failed to check status before token:', err.message);
    res.status(503).json({ error: 'Call status could not be checked safely.' });
    return;
  }
  if (!status.enabled) {
    res.status(404).json({ error: 'Live calls are disabled.', status });
    return;
  }
  if (!status.configured) {
    res.status(503).json({ error: status.reason, status });
    return;
  }

  const room = normaliseRoomName(req.body?.room);
  const username = normaliseUsername(req.body?.username, '');
  const musicMode = req.body?.musicMode === true;
  if (!room || !username) {
    res.status(400).json({ error: 'room and username are required.' });
    return;
  }

  try {
    const token = createLivekitToken({
      room,
      username,
      metadata: { room, username, issuedAt: new Date().toISOString(), supportsAudio: true, supportsVideo: true, musicMode },
    });
    const active = getActiveCallSnapshot(room);
    res.json({
      token,
      url: LIVEKIT_URL,
      room,
      callId: active?.callId || null,
      expiresAt: Date.now() + (CALL_TOKEN_TTL_SECONDS * 1000),
      voiceOnly: false,
      supportsAudio: true,
      supportsVideo: true,
      musicMode,
      audioSettings: musicMode ? MUSIC_MODE_AUDIO_SETTINGS : null,
      provider: status.provider,
      selfContained: status.selfContained,
    });
  } catch (err) {
    console.error('[Calls] Failed to issue token:', err.message);
    res.status(503).json({ error: 'Unable to issue call token.', status });
  }
});

// ---------------- Socket.IO ----------------
const typingUsersByRoom = new Map();
const roomMembers = new Map();
const roomPresence = new Map();
const roomUserHistory = new Map();
const roomBans = new Map();
const roomBlocks = new Map();
const roomMutes = new Map();

PERSISTENT_ROOMS.forEach((roomName) => {
  if (!roomMembers.has(roomName)) {
    roomMembers.set(roomName, new Set());
  }
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
    isAdmin: Boolean(requireModerator(socket)),
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
    isAdmin: Boolean(requireModerator(socket)),
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
    const requiresPassword = Boolean(roomPasswords.get(room));
    if (requiresPassword) return;
    rooms.set(room, {
      name: room,
      occupants: members ? members.size : 0,
      requiresPassword,
    });
  });

  for (const [room, members] of roomMembers.entries()) {
    if (rooms.has(room)) {
      const entry = rooms.get(room);
      entry.occupants = members ? members.size : 0;
      entry.requiresPassword = Boolean(roomPasswords.get(room));
      if (entry.requiresPassword) {
        rooms.delete(room);
      }
      continue;
    }

    if (!members || !members.size) continue;
    const requiresPassword = Boolean(roomPasswords.get(room));
    if (requiresPassword) continue;

    rooms.set(room, {
      name: room,
      occupants: members.size,
      requiresPassword,
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
      activeRoomCalls.delete(room);
      activeRoomCallVideoBlocks.delete(room);
      activeExternalWatchParties.delete(room);
    }
  }

  clearTypingUser(socket, room);
  socket.leave(room);
  if (socket.currentRoom === room) {
    socket.currentRoom = null;
    socket.callTokenNonce = null;
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
const callEventTimestamps = new Map();
const watchPartyCreateTimestamps = new Map();
const activeRoomCalls = new Map();
const activeRoomCallVideoBlocks = new Map();
const activeExternalWatchParties = new Map();

const canSendCallEvent = (socketId) => {
  const now = Date.now();
  if (!callEventTimestamps.has(socketId)) callEventTimestamps.set(socketId, []);
  const ts = callEventTimestamps.get(socketId);
  while (ts.length && now - ts[0] > CALL_EVENT_WINDOW_MS) ts.shift();
  if (ts.length >= CALL_EVENT_MAX_PER_WINDOW) return false;
  ts.push(now);
  return true;
};

const buildCallId = () => crypto.randomBytes(8).toString('hex');
const buildWatchPartyId = () => crypto.randomBytes(8).toString('hex');

const canCreateWatchParty = (socketId) => {
  const now = Date.now();
  if (!watchPartyCreateTimestamps.has(socketId)) watchPartyCreateTimestamps.set(socketId, []);
  const ts = watchPartyCreateTimestamps.get(socketId);
  while (ts.length && now - ts[0] > WATCH_PARTY_EVENT_WINDOW_MS) ts.shift();
  if (ts.length >= WATCH_PARTY_MAX_CREATES_PER_WINDOW) return false;
  ts.push(now);
  return true;
};

const normaliseWatchPartyUrl = (value) => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw.length > 2048) return '';
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    parsed.username = '';
    parsed.password = '';
    parsed.hash = '';
    return parsed.toString();
  } catch (_err) {
    return '';
  }
};

const normaliseWatchPartyTitle = (value) =>
  sanitizeHtml(String(value || ''), { allowedTags: [], allowedAttributes: {} }).trim().slice(0, 160);

const buildW2gRoomUrl = (streamkey) => {
  const cleanKey = String(streamkey || '').trim().replace(/[^a-z0-9_-]/gi, '');
  if (!cleanKey) return '';
  return `${W2G_ROOM_BASE_URL.replace(/\/+$/, '')}/${encodeURIComponent(cleanKey)}`;
};

const createWatch2GetherRoom = async ({ sourceUrl }) => {
  if (!W2G_API_KEY) {
    const error = new Error('Watch2Gether API key is not configured.');
    error.code = 'W2G_NOT_CONFIGURED';
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), W2G_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(W2G_CREATE_ROOM_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        w2g_api_key: W2G_API_KEY,
        share: sourceUrl || undefined,
      }),
      signal: controller.signal,
    });

    const bodyText = await response.text();
    let payload = {};
    if (bodyText) {
      try {
        payload = JSON.parse(bodyText);
      } catch (_err) {
        payload = { raw: bodyText };
      }
    }

    if (!response.ok) {
      const error = new Error(`Watch2Gether room creation failed (${response.status}).`);
      error.code = 'W2G_REQUEST_FAILED';
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    const streamkey = payload?.streamkey || payload?.streamKey || payload?.room?.streamkey || payload?.room?.streamKey || '';
    const roomUrl = payload?.roomUrl || payload?.room_url || payload?.url || buildW2gRoomUrl(streamkey);
    if (!roomUrl) {
      const error = new Error('Watch2Gether response did not include a room URL or stream key.');
      error.code = 'W2G_BAD_RESPONSE';
      error.payload = payload;
      throw error;
    }

    return {
      streamkey: streamkey ? String(streamkey) : '',
      roomUrl: String(roomUrl),
    };
  } finally {
    clearTimeout(timeout);
  }
};

const isCallVideoBlocked = (room, username) => {
  const blocked = activeRoomCallVideoBlocks.get(room);
  return blocked ? blocked.has(canonicalUsername(username)) : false;
};

const setCallVideoBlocked = (room, username, blocked) => {
  const canonical = canonicalUsername(username);
  if (!room || !canonical) return false;
  if (blocked) {
    ensureSet(activeRoomCallVideoBlocks, room).add(canonical);
    return true;
  }
  const blockedSet = activeRoomCallVideoBlocks.get(room);
  if (!blockedSet) return false;
  const removed = blockedSet.delete(canonical);
  if (!blockedSet.size) activeRoomCallVideoBlocks.delete(room);
  return removed;
};

const validateCallModerationTarget = (socket, roomName, target) => {
  const cleanedTarget = normaliseUsername(target, '');
  if (!roomName || roomName !== socket.currentRoom || !cleanedTarget) return null;
  const canonicalTarget = canonicalUsername(cleanedTarget);
  if (canonicalTarget === canonicalUsername(socket.username)) {
    socket.emit('toast', { type: 'warn', text: 'You cannot perform that call action on yourself.' });
    return null;
  }
  const presence = roomPresence.get(roomName);
  const targetInfo = presence
    ? Array.from(presence.values()).find((entry) => canonicalUsername(entry.username) === canonicalTarget)
    : null;
  if (!targetInfo) {
    socket.emit('toast', { type: 'warn', text: 'That user is no longer online.' });
    return null;
  }
  if (targetInfo.isAdmin) {
    socket.emit('toast', { type: 'warn', text: 'You cannot perform that call action on an admin.' });
    return null;
  }
  return { cleanedTarget, canonicalTarget };
};

const getActiveCallSnapshot = (room) => {
  const state = activeRoomCalls.get(room);
  if (!state) return null;
  return {
    room,
    callId: state.callId,
    startedAt: state.startedAt,
    startedBy: state.startedBy,
    voiceOnly: false,
    supportsAudio: true,
    supportsVideo: true,
  };
};

const ensureCallsEnabled = (resOrSocket) => {
  if (!ENABLE_VOICE_CALLS) {
    if (typeof resOrSocket?.status === 'function') {
      resOrSocket.status(404).json({ error: 'Live calls are disabled.' });
    } else {
      resOrSocket.emit('toast', { type: 'warn', text: 'Live calls are disabled.' });
    }
    return false;
  }
  return true;
};

const createLivekitToken = ({ room, username, metadata }) => {
  if (!hasLivekitCredentials()) {
    throw new Error('LiveKit credentials are not configured.');
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    iss: LIVEKIT_API_KEY,
    sub: username,
    nbf: nowSeconds - 5,
    exp: nowSeconds + CALL_TOKEN_TTL_SECONDS,
    video: {
      roomJoin: true,
      room,
      canPublish: true,
      canPublishSources: ['microphone', 'camera'],
      canSubscribe: true,
      canPublishData: true,
    },
    metadata: JSON.stringify(metadata || {}),
  };
  const header = { alg: 'HS256', typ: 'JWT' };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode(header)}.${encode(payload)}`;
  const signature = crypto.createHmac('sha256', LIVEKIT_API_SECRET).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
};

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
  const principal = requireModerator(socket);
  if (!principal) {
    socket.emit('toast', { type: 'warn', text: '🚫 Admin only command.' });
    return false;
  }
  return true;
}

io.use((socket, next) => {
  const sessionToken = typeof socket.handshake.auth?.sessionToken === 'string'
    ? socket.handshake.auth.sessionToken.trim()
    : '';
  const session = accountSessions.resolve(sessionToken);
  socket.principal = null;
  socket.accountSessionToken = '';
  if (session) {
    socket.principal = session.principal;
    socket.accountSessionToken = session.token;
  }
  next();
});

io.on('connection', socket => {
  console.log('[Socket] Connected', socket.id);
  socket.emit('room list', getPublicRoomsSnapshot());

  socket.on('account login', async (payload = {}, ack) => {
    try {
      const username = typeof payload.username === 'string' ? payload.username.trim() : '';
      const password = typeof payload.password === 'string' ? payload.password : '';
      const attemptKey = getAdminAuthAttemptKey(socket, username);
      const authState = getAdminAuthState(attemptKey);
      const now = Date.now();

      if (authState.lockUntil > now) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'Too many authentication attempts.', retryAfterMs: authState.lockUntil - now });
        }
        return;
      }

      const retryDelayMs = computeAdminAuthRetryDelayMs(authState);
      if (authState.lastFailedAt && authState.lastFailedAt + retryDelayMs > now) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'Authentication retry delayed.', retryAfterMs: (authState.lastFailedAt + retryDelayMs) - now });
        }
        return;
      }

      const account = await accountService.authenticate(username, password);
      if (!account) {
        const failedState = registerAdminAuthFailure(attemptKey);
        const failedAt = Date.now();
        const retryAfterMs = failedState.lockUntil > failedAt
          ? failedState.lockUntil - failedAt
          : computeAdminAuthRetryDelayMs(failedState);
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'Invalid username or password.', retryAfterMs });
        }
        return;
      }

      clearAdminAuthFailures(attemptKey);
      if (socket.accountSessionToken) {
        accountSessions.revoke(socket.accountSessionToken);
      }

      const principal = {
        kind: 'account',
        username: account.username,
        canonicalUsername: account.canonicalUsername,
        role: account.role,
        userId: account.userId,
      };
      const session = accountSessions.issue(principal);
      socket.principal = session.principal;
      socket.accountSessionToken = session.token;

      if (typeof ack === 'function') {
        ack({
          ok: true,
          session: {
            token: session.token,
            issuedAt: session.issuedAt,
            expiresAt: session.expiresAt,
            identity: { ...session.principal },
          },
        });
      }
    } catch (err) {
      console.error('[Auth v2] Account login failed:', err?.message || err);
      if (typeof ack === 'function') ack({ ok: false, error: 'Authentication failed.' });
    }
  });

  socket.on('account session', (payload = {}, ack) => {
    const session = accountSessions.resolve(socket.accountSessionToken);
    if (!session) {
      socket.accountSessionToken = '';
      socket.principal = null;
      if (typeof ack === 'function') ack({ ok: true, session: null });
      return;
    }

    socket.principal = session.principal;
    if (typeof ack === 'function') {
      ack({
        ok: true,
        session: {
          token: session.token,
          issuedAt: session.issuedAt,
          expiresAt: session.expiresAt,
          identity: { ...session.principal },
        },
      });
    }
  });

  socket.on('account logout', (payload = {}, ack) => {
    if (socket.accountSessionToken) {
      accountSessions.revoke(socket.accountSessionToken);
    }
    socket.accountSessionToken = '';
    socket.principal = null;
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('account manage user', async (payload = {}, ack) => {
    try {
      const actor = requireOwner(socket);
      if (!actor) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Owner role required.' });
        return;
      }

      const username = typeof payload.username === 'string' ? payload.username.trim() : '';
      const password = typeof payload.password === 'string' ? payload.password : '';
      const role = typeof payload.role === 'string' ? payload.role.trim().toLowerCase() : 'user';
      const account = await accountService.createManagedUser(actor, { username, password, role });
      accountSessions.revokeUser(account.canonicalUsername);
      if (typeof ack === 'function') ack({ ok: true, account });
    } catch (err) {
      console.error('[Auth v2] Managed user creation failed:', err?.message || err);
      if (typeof ack === 'function') {
        ack({ ok: false, error: err?.message || 'Unable to create account.' });
      }
    }
  });

  socket.on('join room', async ({ room, username, password }) => {
    const roomName = normaliseRoomName(room);
    if (!roomName) {
      sendJoinError(socket, 'Room name is required');
      return;
    }

    const providedPassword = normalisePassword(password);
    let roomPasswordResult;
    try {
      roomPasswordResult = await roomPasswordService.claimOrVerify(roomName, providedPassword);
      roomPasswords.set(roomName, roomPasswordResult.passwordHash);
    } catch (err) {
      console.error('[Room] Password verification failed:', err?.message || err);
      sendJoinError(socket, 'Unable to verify room password');
      return;
    }

    if (!roomPasswordResult.ok) {
      logSecurityEvent('room_password_mismatch', {
        room: roomName,
        ip: getSocketRemoteAddress(socket),
        socketId: socket.id,
      });
      sendJoinError(socket, 'Incorrect room password');
      return;
    }

    const fallbackUser = `Guest-${socket.id.slice(0, 4)}`;
    let effectivePrincipal;
    if (socket.principal?.kind === 'account') {
      effectivePrincipal = socket.principal;
    } else {
      const guestUsername = normaliseUsername(username, fallbackUser);
      if (await accountService.isRegisteredUsername(guestUsername)) {
        logSecurityEvent('registered_username_guest_join_attempt', {
          room: roomName,
          username: guestUsername,
          ip: getSocketRemoteAddress(socket),
          socketId: socket.id,
        });
        sendJoinError(socket, 'That username is reserved. Sign in to use it.');
        return;
      }
      effectivePrincipal = {
        kind: 'guest',
        username: guestUsername,
        canonicalUsername: canonicalUsername(guestUsername),
        role: 'guest',
      };
    }

    socket.username = effectivePrincipal.username;
    socket.canonicalUsername = effectivePrincipal.canonicalUsername;
    socket.identityKind = effectivePrincipal.kind;
    socket.role = effectivePrincipal.role;
    socket.principal = effectivePrincipal;

    const previousRoom = socket.currentRoom;
    if (previousRoom && previousRoom !== roomName) {
      removeSocketFromRoom(socket, previousRoom);
      emitRoomListUpdate();
    }

    const canonicalUser = socket.canonicalUsername;
    const bannedSet = roomBans.get(roomName);
    if (bannedSet && bannedSet.has(canonicalUser)) {
      logSecurityEvent('banned_user_join_attempt', {
        room: roomName,
        username: socket.username,
        ip: getSocketRemoteAddress(socket),
      });
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
    socket.callTokenNonce = crypto.randomBytes(24).toString('base64url');
    socket.emit('call token nonce', { room: roomName, token: socket.callTokenNonce, socketId: socket.id });
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

    const activeWatchParty = activeExternalWatchParties.get(roomName);
    if (activeWatchParty) {
      socket.emit('watch-party:external-active', activeWatchParty);
    }
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

  socket.on('watch-party:w2g-create', async ({ room, url, title } = {}) => {
    const roomName = normaliseRoomName(room || socket.currentRoom);
    if (!roomName || roomName !== socket.currentRoom) return;

    if (isUserBlocked(roomName, socket.username)) {
      socket.emit('moderation notice', { type: 'blocked', room: roomName, reason: 'watch-party' });
      return;
    }

    const muteUntil = getMuteExpiry(roomName, socket.username);
    if (muteUntil) {
      socket.emit('moderation notice', { type: 'muted', room: roomName, until: muteUntil, reason: 'watch-party' });
      return;
    }

    if (!canCreateWatchParty(socket.id)) {
      socket.emit('watch-party:error', { room: roomName, message: 'Please wait before creating another watch party.' });
      return;
    }

    const sourceUrl = normaliseWatchPartyUrl(url);
    if (!sourceUrl) {
      socket.emit('watch-party:error', { room: roomName, message: 'Enter a valid http:// or https:// video URL.' });
      return;
    }

    try {
      const result = await createWatch2GetherRoom({ sourceUrl });
      const safeTitle = normaliseWatchPartyTitle(title);
      const payload = {
        provider: 'watch2gether',
        sessionId: buildWatchPartyId(),
        room: roomName,
        sourceUrl,
        sourceTitle: safeTitle,
        watchUrl: result.roomUrl,
        streamkey: result.streamkey,
        createdBy: socket.username || 'Someone',
        createdAt: Date.now(),
      };
      activeExternalWatchParties.set(roomName, payload);
      io.to(roomName).emit('watch-party:external-created', payload);
    } catch (err) {
      const message = err?.code === 'W2G_NOT_CONFIGURED'
        ? 'Watch2Gether is not configured yet. Add W2G_API_KEY to the protected runtime environment.'
        : err?.name === 'AbortError'
          ? 'Watch2Gether took too long to respond. Try again shortly.'
          : 'Could not create a Watch2Gether room right now.';
      console.error('[WatchParty] Watch2Gether creation failed:', err?.message || err);
      socket.emit('watch-party:error', { room: roomName, message });
    }
  });

  socket.on('watch-party:external-clear', ({ room } = {}) => {
    const roomName = normaliseRoomName(room || socket.currentRoom);
    if (!roomName || roomName !== socket.currentRoom) return;
    const active = activeExternalWatchParties.get(roomName);
    if (!active) return;
    if (!requireModerator(socket) && canonicalUsername(active.createdBy) !== canonicalUsername(socket.username)) {
      socket.emit('watch-party:error', { room: roomName, message: 'Only the host or an admin can clear this watch party.' });
      return;
    }
    activeExternalWatchParties.delete(roomName);
    io.to(roomName).emit('watch-party:external-cleared', { room: roomName, clearedBy: socket.username || 'Someone', sessionId: active.sessionId });
  });

  socket.on('call:start', ({ room } = {}) => {
    if (!ensureCallsEnabled(socket) || !canSendCallEvent(socket.id)) return;
    const roomName = normaliseRoomName(room || socket.currentRoom);
    if (!roomName || roomName !== socket.currentRoom) return;
    if (activeRoomCalls.has(roomName)) {
      socket.emit('call:error', { room: roomName, message: 'A call is already active.' });
      return;
    }
    activeRoomCalls.set(roomName, {
      callId: buildCallId(),
      startedAt: Date.now(),
      startedBy: socket.username || 'admin',
    });
    io.to(roomName).emit('call:started', getActiveCallSnapshot(roomName));
  });

  socket.on('call:join', ({ room } = {}) => {
    if (!ensureCallsEnabled(socket) || !canSendCallEvent(socket.id)) return;
    const roomName = normaliseRoomName(room || socket.currentRoom);
    if (!roomName || roomName !== socket.currentRoom) return;
    if (!activeRoomCalls.has(roomName)) {
      activeRoomCalls.set(roomName, {
        callId: buildCallId(),
        startedAt: Date.now(),
        startedBy: socket.username || 'participant',
      });
      io.to(roomName).emit('call:started', getActiveCallSnapshot(roomName));
    }
    const active = getActiveCallSnapshot(roomName);
    socket.emit('call:joined', active);
    socket.to(roomName).emit('call:participant-joined', { room: roomName, username: socket.username });
  });

  socket.on('call:leave', ({ room } = {}) => {
    if (!ensureCallsEnabled(socket) || !canSendCallEvent(socket.id)) return;
    const roomName = normaliseRoomName(room || socket.currentRoom);
    if (!roomName || roomName !== socket.currentRoom) return;
    socket.to(roomName).emit('call:participant-left', { room: roomName, username: socket.username });
  });

  socket.on('call:mute-user', ({ room, target } = {}) => {
    if (!ensureCallsEnabled(socket) || !canSendCallEvent(socket.id) || !requireAdmin(socket)) return;
    const roomName = normaliseRoomName(room || socket.currentRoom);
    const cleanedTarget = normaliseUsername(target, '');
    if (!roomName || roomName !== socket.currentRoom || !cleanedTarget) return;
    io.to(roomName).emit('call:user-muted', { room: roomName, target: cleanedTarget, by: socket.username });
  });

  socket.on('call:kick-user', ({ room, target } = {}) => {
    if (!ensureCallsEnabled(socket) || !canSendCallEvent(socket.id) || !requireAdmin(socket)) return;
    const roomName = normaliseRoomName(room || socket.currentRoom);
    const cleanedTarget = normaliseUsername(target, '');
    if (!roomName || roomName !== socket.currentRoom || !cleanedTarget) return;
    io.to(roomName).emit('call:user-kicked', { room: roomName, target: cleanedTarget, by: socket.username });
  });

  socket.on('call:disable-video-user', ({ room, target } = {}) => {
    if (!ensureCallsEnabled(socket) || !canSendCallEvent(socket.id) || !requireAdmin(socket)) return;
    const roomName = normaliseRoomName(room || socket.currentRoom);
    const targetInfo = validateCallModerationTarget(socket, roomName, target);
    if (!targetInfo) return;
    setCallVideoBlocked(roomName, targetInfo.cleanedTarget, true);
    io.to(roomName).emit('call:user-video-disabled', { room: roomName, target: targetInfo.cleanedTarget, by: socket.username });
    socket.emit('toast', { type: 'info', text: `${targetInfo.cleanedTarget}'s camera was disabled for this call.` });
  });

  socket.on('call:enable-video-user', ({ room, target } = {}) => {
    if (!ensureCallsEnabled(socket) || !canSendCallEvent(socket.id) || !requireAdmin(socket)) return;
    const roomName = normaliseRoomName(room || socket.currentRoom);
    const targetInfo = validateCallModerationTarget(socket, roomName, target);
    if (!targetInfo) return;
    setCallVideoBlocked(roomName, targetInfo.cleanedTarget, false);
    io.to(roomName).emit('call:user-video-enabled', { room: roomName, target: targetInfo.cleanedTarget, by: socket.username });
    socket.emit('toast', { type: 'info', text: `${targetInfo.cleanedTarget}'s camera is allowed again.` });
  });

  socket.on('call:end', ({ room } = {}) => {
    if (!ensureCallsEnabled(socket) || !canSendCallEvent(socket.id)) return;
    const roomName = normaliseRoomName(room || socket.currentRoom);
    if (!roomName || roomName !== socket.currentRoom) return;
    const active = activeRoomCalls.get(roomName);
    if (!active) return;
    activeRoomCalls.delete(roomName);
    activeRoomCallVideoBlocks.delete(roomName);
    io.to(roomName).emit('call:ended', { room: roomName, callId: active.callId, endedBy: socket.username, endedAt: Date.now() });
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

      if (!requireModerator(socket) && !isOwner) {
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
      if (!requireModerator(socket) && !isOwner) {
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

    if (!requireModerator(socket)) {
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
      const maxSeconds = 86400;
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
      if (!requireModerator(socket)) {
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
      if (!requireModerator(socket)) {
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
      if (!requireModerator(socket)) {
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

// ---------------- Dedicated Chat Route ----------------
app.get(['/login', '/chat', '/app'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ---------------- Catch-all Route ----------------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
