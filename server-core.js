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
const MobileSession = require('./src/models/mobile-session');
const Room = require('./src/models/room');
const PushDevice = require('./src/models/push-device');
const PushRoomSubscription = require('./src/models/push-room-subscription');
const WebPushSubscription = require('./src/models/web-push-subscription');
const RoomReadCursor = require('./src/models/room-read-cursor');
const { createAccountService } = require('./src/auth/account-service');
const { createPushDeviceService } = require('./src/push/push-device-service');
const { createReadStateService } = require('./src/push/read-state-service');
const { createPushCoordinator } = require('./src/push/push-coordinator');
const { createWebPushSubscriptionService } = require('./src/push/web-push-subscription-service');
const { createWebPushCoordinator } = require('./src/push/web-push-coordinator');
const { createConfiguredWebPushTransport } = require('./src/push/web-push-config');
const { createReadStateCoordinator } = require('./src/push/read-state-coordinator');
const { createChatMessageService } = require('./src/messages/chat-message-service');
const {
  isMessageAuthor,
  resolveCurrentSocketRoom,
  resolveSocketUsername,
} = require('./src/messages/socket-message-authorization');
const { createConfiguredPushTransport } = require('./src/push/fcm-config');
const { readLegacyAdminCredentials } = require('./src/auth/legacy-admin-credentials');
const { createSessionStore } = require('./src/auth/session-store');
const { createMobileSessionService } = require('./src/auth/mobile-session-service');
const { requireModerator, requireOwner } = require('./src/auth/authorization');
const { createRoomPasswordService } = require('./src/rooms/room-password-service');
const { createRoomAuthThrottle } = require('./src/rooms/room-auth-throttle');
const soundboardStore = require('./src/utils/soundboard');
const {
  createSoundboardImporter,
  parseBoardUrl: parseSoundboardImportUrl,
  parseSoundPageUrl: parseSoundboardClipUrl,
} = require('./src/soundboards/board-importer');
const { scanFileWithClamAv } = require('./src/uploads/clamav-scanner');
const { normalizeVoiceMessageUpload } = require('./src/uploads/voice-message-normalizer');
const { applyUploadResponseHeaders } = require('./src/uploads/upload-response-security');
const {
  createUploadAdmissionController,
  readUploadAbuseLimits,
} = require('./src/uploads/upload-abuse-guard');
const { DizyJamCredentialStore } = require('./src/jam/dizyjam-credentials');
const { createJamSessionRateLimiter } = require('./src/jam/jam-session-rate-limit');
const { resolveCallTokenGrant } = require('./src/calls/call-token-grant');
const { resolveBindHost, resolveTrustedRemoteAddress } = require('./src/config/network');
const { fetchPublicHtmlPreview } = require('./src/security/public-http-fetch');
const {
  createBoundedJsonFetcher,
  createPublicMediaAdmissionController,
  readBoundedBody,
  readPublicMediaProxyLimits,
} = require('./src/security/public-media-proxy-guard');

const nodeFetchModulePromise = import('node-fetch');
const fetch = (...args) =>
  nodeFetchModulePromise.then(({ default: fetch }) => fetch(...args));

const publicMediaProxyLimits = readPublicMediaProxyLimits(process.env);
const publicMediaAdmission = createPublicMediaAdmissionController(publicMediaProxyLimits);
const fetchPublicMediaJson = createBoundedJsonFetcher({
  fetchImpl: fetch,
  timeoutMs: publicMediaProxyLimits.fetchTimeoutMs,
});

const soundboardImporter = createSoundboardImporter({ fetchImpl: fetch });
const soundboardImportJobs = new Map();
let activeSoundboardImportJobId = '';
const SOUNDBOARD_IMPORT_JOB_TTL_MS = 6 * 60 * 60 * 1000;

const trimSoundboardImportJobs = () => {
  const cutoff = Date.now() - SOUNDBOARD_IMPORT_JOB_TTL_MS;
  for (const [jobId, job] of soundboardImportJobs.entries()) {
    if (job.status === 'running' || job.status === 'queued') continue;
    if (Number(job.updatedAt || 0) < cutoff) soundboardImportJobs.delete(jobId);
  }
};

const readSoundboardImportJob = (jobId) => {
  const job = soundboardImportJobs.get(String(jobId || '').trim());
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    boardUrl: job.boardUrl,
    boardId: job.boardId,
    soundPageUrl: job.soundPageUrl || '',
    progress: job.progress,
    result: job.result || null,
    error: job.error || '',
    code: job.code || '',
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
};

const readExisting101SoundboardTargets = async () => {
  const dataRoot = path.join(__dirname, 'data', 'soundboards');
  let index;
  try {
    index = JSON.parse(await fs.promises.readFile(path.join(dataRoot, 'index.json'), 'utf8'));
  } catch {
    return [];
  }

  const boardIds = Array.isArray(index?.boards) ? index.boards : [];
  const targets = [];
  for (const rawId of boardIds) {
    const boardId = String(rawId || '').trim();
    if (!boardId) continue;
    try {
      const board = JSON.parse(await fs.promises.readFile(path.join(dataRoot, `${boardId}.json`), 'utf8'));
      const source = String(board?.source || '').trim().toLowerCase();
      if (source !== '101soundboards') continue;
      const candidate = board?.sourceUrl || `https://www.101soundboards.com/boards/${boardId}`;
      const parsed = parseSoundboardImportUrl(candidate);
      targets.push({ boardId: parsed.boardId, boardUrl: parsed.url });
    } catch (error) {
      console.warn('[Soundboard Import] Skipping unreadable legacy board during rebuild discovery', {
        boardId,
        error: error?.message || error,
      });
    }
  }
  return targets;
};

const startSoundboardImportJob = ({
  boardUrl,
  soundPageUrl = '',
  requestedBy,
  replaceExisting = false,
}) => {
  trimSoundboardImportJobs();
  const parsed = parseSoundboardImportUrl(boardUrl);
  const parsedSound = soundPageUrl ? parseSoundboardClipUrl(soundPageUrl) : null;

  if (activeSoundboardImportJobId) {
    const active = soundboardImportJobs.get(activeSoundboardImportJobId);
    if (active && ['queued', 'running'].includes(active.status)) {
      if (
        active.boardId === parsed.boardId
        && String(active.soundPageUrl || '') === String(parsedSound?.url || '')
      ) return readSoundboardImportJob(active.id);
      const error = new Error('Another soundboard import is already running.');
      error.code = 'SOUNDBOARD_IMPORT_BUSY';
      throw error;
    }
    activeSoundboardImportJobId = '';
  }

  const now = Date.now();
  const job = {
    id: crypto.randomUUID(),
    status: 'queued',
    boardUrl: parsed.url,
    boardId: parsed.boardId,
    soundPageUrl: parsedSound?.url || '',
    requestedBy: String(requestedBy || ''),
    progress: { phase: 'queued', message: 'Import queued…', current: 0, total: 0 },
    result: null,
    error: '',
    code: '',
    createdAt: now,
    updatedAt: now,
  };
  soundboardImportJobs.set(job.id, job);
  activeSoundboardImportJobId = job.id;

  setImmediate(async () => {
    job.status = 'running';
    job.updatedAt = Date.now();
    try {
      const result = await soundboardImporter.importBoard({
        boardUrl: parsed.url,
        replaceExisting,
        onlySoundPageUrl: parsedSound?.url || '',
        onProgress: async (progress) => {
          job.progress = {
            phase: String(progress?.phase || 'running'),
            message: String(progress?.message || ''),
            current: Number(progress?.current || 0),
            total: Number(progress?.total || 0),
          };
          job.updatedAt = Date.now();
        },
      });
      soundboardStore.reload();
      job.result = result;
      job.status = 'complete';
      job.progress = {
        phase: 'complete',
        message: `Import complete: ${result.imported} added, ${result.replaced || 0} rebuilt, ${result.skipped} already present, ${result.failed} unavailable.`,
        current: Number(result.processed || 0),
        total: Number(result.processed || 0),
      };
    } catch (error) {
      job.status = error?.code === 'BROWSER_APPROVAL_REQUIRED' ? 'browser-approval-required' : 'error';
      job.code = String(error?.code || 'SOUNDBOARD_IMPORT_FAILED');
      job.error = String(error?.message || 'Soundboard import failed.');
      job.progress = {
        phase: job.status,
        message: job.error,
        current: Number(job.progress?.current || 0),
        total: Number(job.progress?.total || 0),
      };
      console.warn('[Soundboard Import] Import failed', {
        boardId: parsed.boardId,
        code: job.code,
        error: job.error,
      });
    } finally {
      job.updatedAt = Date.now();
      if (activeSoundboardImportJobId === job.id) activeSoundboardImportJobId = '';
    }
  });

  return readSoundboardImportJob(job.id);
};

const startExistingSoundboardRebuildJob = ({ requestedBy }) => {
  trimSoundboardImportJobs();

  if (activeSoundboardImportJobId) {
    const active = soundboardImportJobs.get(activeSoundboardImportJobId);
    if (active && ['queued', 'running'].includes(active.status)) {
      const error = new Error('Another soundboard import is already running.');
      error.code = 'SOUNDBOARD_IMPORT_BUSY';
      throw error;
    }
    activeSoundboardImportJobId = '';
  }

  const now = Date.now();
  const job = {
    id: crypto.randomUUID(),
    status: 'queued',
    boardUrl: '',
    boardId: '__rebuild-existing__',
    requestedBy: String(requestedBy || ''),
    progress: { phase: 'queued', message: 'Existing-board rebuild queued…', current: 0, total: 0 },
    result: null,
    error: '',
    code: '',
    createdAt: now,
    updatedAt: now,
  };
  soundboardImportJobs.set(job.id, job);
  activeSoundboardImportJobId = job.id;

  setImmediate(async () => {
    job.status = 'running';
    job.updatedAt = Date.now();
    try {
      const targets = await readExisting101SoundboardTargets();
      const summary = {
        boards: targets.length,
        boardsComplete: 0,
        imported: 0,
        replaced: 0,
        skipped: 0,
        failed: 0,
        failedBoards: [],
      };

      if (!targets.length) {
        job.result = summary;
        job.status = 'complete';
        job.progress = { phase: 'complete', message: 'No existing 101Soundboards catalogs were found.', current: 0, total: 0 };
        return;
      }

      for (let boardIndex = 0; boardIndex < targets.length; boardIndex += 1) {
        const target = targets[boardIndex];
        job.progress = {
          phase: 'rebuild',
          message: `Rebuilding board ${boardIndex + 1}/${targets.length}: ${target.boardId}`,
          current: boardIndex,
          total: targets.length,
        };
        job.updatedAt = Date.now();

        try {
          const result = await soundboardImporter.importBoard({
            boardUrl: target.boardUrl,
            replaceExisting: true,
            onProgress: async (progress) => {
              const clipCount = Number(progress?.total || 0);
              const clipCurrent = Number(progress?.current || 0);
              const clipSuffix = clipCount > 0 ? ` · clip ${clipCurrent}/${clipCount}` : '';
              job.progress = {
                phase: 'rebuild',
                message: `Board ${boardIndex + 1}/${targets.length}: ${target.boardId}${clipSuffix} · ${String(progress?.message || '')}`,
                current: boardIndex,
                total: targets.length,
              };
              job.updatedAt = Date.now();
            },
          });
          summary.boardsComplete += 1;
          summary.imported += Number(result.imported || 0);
          summary.replaced += Number(result.replaced || 0);
          summary.skipped += Number(result.skipped || 0);
          summary.failed += Number(result.failed || 0);
          soundboardStore.reload();
        } catch (error) {
          if (error?.code === 'BROWSER_APPROVAL_REQUIRED') throw error;
          summary.failedBoards.push({
            boardId: target.boardId,
            error: String(error?.message || 'Board rebuild failed.'),
          });
        }
      }

      soundboardStore.reload();
      job.result = summary;
      job.status = 'complete';
      job.progress = {
        phase: 'complete',
        message: `Rebuild complete: ${summary.replaced} clips replaced, ${summary.imported} new, ${summary.failed} unavailable across ${summary.boardsComplete}/${summary.boards} boards.`,
        current: targets.length,
        total: targets.length,
      };
    } catch (error) {
      job.status = error?.code === 'BROWSER_APPROVAL_REQUIRED' ? 'browser-approval-required' : 'error';
      job.code = String(error?.code || 'SOUNDBOARD_REBUILD_FAILED');
      job.error = String(error?.message || 'Existing soundboard rebuild failed.');
      job.progress = {
        phase: job.status,
        message: job.error,
        current: Number(job.progress?.current || 0),
        total: Number(job.progress?.total || 0),
      };
      console.warn('[Soundboard Import] Existing-board rebuild stopped', {
        code: job.code,
        error: job.error,
      });
    } finally {
      job.updatedAt = Date.now();
      if (activeSoundboardImportJobId === job.id) activeSoundboardImportJobId = '';
    }
  });

  return readSoundboardImportJob(job.id);
};

const TRUSTED_NATIVE_ORIGINS = new Set([
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
]);

const isTrustedNativeOrigin = (socket) => {
  const origin = String(socket?.handshake?.headers?.origin || '').trim().toLowerCase();
  return TRUSTED_NATIVE_ORIGINS.has(origin);
};

const isTrustedNativeHttpOrigin = (req) => {
  const origin = String(req?.headers?.origin || '').trim().toLowerCase();
  return TRUSTED_NATIVE_ORIGINS.has(origin) ? origin : '';
};

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
app.set('trust proxy', 'loopback');
const server = http.createServer(app);
const SOCKET_IO_CORS_ORIGIN_CONFIG = parseSocketCorsOrigins();
const SOCKET_IO_CORS_ORIGIN = Array.isArray(SOCKET_IO_CORS_ORIGIN_CONFIG)
  ? [...new Set([...SOCKET_IO_CORS_ORIGIN_CONFIG, ...TRUSTED_NATIVE_ORIGINS])]
  : SOCKET_IO_CORS_ORIGIN_CONFIG;
const ALLOWED_SOCKET_IO_ORIGINS = Array.isArray(SOCKET_IO_CORS_ORIGIN)
  ? new Set(SOCKET_IO_CORS_ORIGIN)
  : null;
const io = new Server(server, {
  cors: { origin: SOCKET_IO_CORS_ORIGIN, methods: ["GET", "POST"] }
});
const PORT = process.env.PORT || 10000;
const BIND_HOST = resolveBindHost(process.env);
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
const ADMIN_AUTH_MAX_TRACKED_KEYS = parsePositiveIntegerEnv('ADMIN_AUTH_MAX_TRACKED_KEYS', 5000, { min: 100, max: 50_000 });
const ROOM_AUTH_MAX_TRACKED_KEYS = parsePositiveIntegerEnv('ROOM_AUTH_MAX_TRACKED_KEYS', 5000, { min: 100, max: 50_000 });
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
const MUSIC_MODE_AUDIO_BITRATE = 510000;
const MUSIC_MODE_AUDIO_SETTINGS = Object.freeze({
  channelCount: 2,
  sampleRate: 48000,
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

const DIZYJAM_HOST = String(process.env.DIZYJAM_HOST || '').trim();
const DIZYJAM_TCP_PORT = parsePositiveIntegerEnv('DIZYJAM_TCP_PORT', 4464, { min: 1, max: 65535 });
const DIZYJAM_UDP_BASE_PORT = parsePositiveIntegerEnv('DIZYJAM_UDP_BASE_PORT', 61002, { min: 1024, max: 65535 });
const DIZYJAM_UDP_END_PORT = parsePositiveIntegerEnv('DIZYJAM_UDP_END_PORT', 61100, { min: 1024, max: 65535 });
const DIZYJAM_SAMPLE_RATE = parsePositiveIntegerEnv('DIZYJAM_SAMPLE_RATE', 48000, { min: 8000, max: 192000 });
const DIZYJAM_BUFFER_SIZE = parsePositiveIntegerEnv('DIZYJAM_BUFFER_SIZE', 128, { min: 16, max: 4096 });
const DIZYJAM_CLIENT_INSTALL_URL = String(process.env.DIZYJAM_CLIENT_INSTALL_URL || 'https://jacktrip.github.io/jacktrip/Install/').trim();
const DIZYJAM_DISABLED = ['false', '0', 'no', 'off', 'disabled'].includes(String(process.env.ENABLE_DIZYJAM || '').trim().toLowerCase());
const DIZYJAM_AUTH_DIR = path.resolve(String(process.env.DIZYJAM_AUTH_DIR || path.join(__dirname, 'ops', 'dizyjam', 'runtime')).trim());
const DIZYJAM_AUTH_CERT_FILE = path.resolve(String(process.env.DIZYJAM_AUTH_CERT_FILE || path.join(DIZYJAM_AUTH_DIR, 'jacktrip.crt')).trim());
const DIZYJAM_AUTH_KEY_FILE = path.resolve(String(process.env.DIZYJAM_AUTH_KEY_FILE || path.join(DIZYJAM_AUTH_DIR, 'jacktrip.key')).trim());
const DIZYJAM_AUTH_CREDS_FILE = path.resolve(String(process.env.DIZYJAM_AUTH_CREDS_FILE || path.join(DIZYJAM_AUTH_DIR, 'auth')).trim());
const DIZYJAM_CREDENTIAL_TTL_SECONDS = parsePositiveIntegerEnv('DIZYJAM_CREDENTIAL_TTL_SECONDS', 7200, { min: 300, max: 86400 });
const DIZYJAM_AUTH_FILES_READY = () =>
  fs.existsSync(DIZYJAM_AUTH_CERT_FILE) && fs.existsSync(DIZYJAM_AUTH_KEY_FILE);
let dizyJamCredentialStoreReady = false;
const DIZYJAM_ENABLED = () =>
  !DIZYJAM_DISABLED &&
  Boolean(DIZYJAM_HOST) &&
  DIZYJAM_AUTH_FILES_READY() &&
  dizyJamCredentialStoreReady;
const SONOBUS_DOWNLOAD_URL = String(process.env.SONOBUS_DOWNLOAD_URL || 'https://sonobus.net/index.html').trim();
const JAM_SESSION_EVENT_WINDOW_MS = 60 * 1000;
const JAM_SESSION_MAX_CREATES_PER_WINDOW = 12;

const dizyJamCredentialStore = new DizyJamCredentialStore({
  credentialsFile: DIZYJAM_AUTH_CREDS_FILE,
  ttlSeconds: DIZYJAM_CREDENTIAL_TTL_SECONDS,
});
try {
  // Credentials are intentionally ephemeral. A DizyChat restart invalidates all
  // previously issued JackTrip passwords instead of leaving stale hub access behind.
  dizyJamCredentialStore.initialiseEmpty();
  dizyJamCredentialStoreReady = true;
} catch (error) {
  console.error('[DizyJam] Unable to initialise credential store:', error?.message || error);
}
const dizyJamCredentialPruneTimer = setInterval(() => {
  try {
    dizyJamCredentialStore.pruneExpired();
  } catch (error) {
    console.error('[DizyJam] Failed to prune expired credentials:', error?.message || error);
  }
}, 60 * 1000);
dizyJamCredentialPruneTimer.unref?.();

const getDizyJamMissingConfig = () => [
  !DIZYJAM_HOST ? 'DIZYJAM_HOST' : '',
  !fs.existsSync(DIZYJAM_AUTH_CERT_FILE) ? 'DIZYJAM_AUTH_CERT_FILE' : '',
  !fs.existsSync(DIZYJAM_AUTH_KEY_FILE) ? 'DIZYJAM_AUTH_KEY_FILE' : '',
  !dizyJamCredentialStoreReady ? 'DIZYJAM_AUTH_CREDS_FILE' : '',
].filter(Boolean);

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
const mobileAccountSessions = createMobileSessionService({
  MobileSessionModel: MobileSession,
  UserModel: User,
});
const pushDeviceService = createPushDeviceService({
  PushDeviceModel: PushDevice,
  SubscriptionModel: PushRoomSubscription,
  MobileSessionModel: MobileSession,
  UserModel: User,
});
const readStateService = createReadStateService({ RoomReadCursorModel: RoomReadCursor });
const pushTransport = createConfiguredPushTransport();
const nativePushCoordinator = createPushCoordinator({
  pushDeviceService,
  readStateService,
  transport: pushTransport,
});
const webPushSubscriptionService = createWebPushSubscriptionService({
  SubscriptionModel: WebPushSubscription,
  UserModel: User,
  logger: console,
});
const webPushTransport = createConfiguredWebPushTransport({ logger: console });
const webPushCoordinator = createWebPushCoordinator({
  subscriptionService: webPushSubscriptionService,
  transport: webPushTransport,
  logger: console,
});
const combinePushResults = async (promises) => {
  const results = await Promise.allSettled(promises);
  const combined = { attempted: 0, sent: 0, failed: 0 };
  for (const result of results) {
    if (result.status === 'rejected') {
      combined.failed += 1;
      console.warn('[Push] coordinator unavailable', {
        code: String(result.reason?.code || 'unexpected'),
      });
      continue;
    }
    combined.attempted += Number(result.value?.attempted || 0);
    combined.sent += Number(result.value?.sent || 0);
    combined.failed += Number(result.value?.failed || 0);
  }
  return combined;
};

const pushCoordinator = {
  onMessageStored(message, metadata = {}) {
    return combinePushResults([
      nativePushCoordinator.onMessageStored(message, metadata),
      webPushCoordinator.onMessageStored(message, metadata),
    ]);
  },
  onActivityStarted(activity, metadata = {}) {
    return combinePushResults([
      nativePushCoordinator.onActivityStarted(activity, metadata),
      webPushCoordinator.onActivityStarted(activity, metadata),
    ]);
  },
  sendRoomClear: (...args) => nativePushCoordinator.sendRoomClear(...args),
};
const readStateCoordinator = createReadStateCoordinator({
  readStateService,
  pushCoordinator,
  logger: console,
});
const chatMessageService = createChatMessageService({ io, pushCoordinator });

const notifyRoomActivity = ({
  room,
  activityType,
  activityId,
  socket = null,
  sender = '',
} = {}) => {
  const roomName = normaliseRoomName(room);
  const id = String(activityId || '').trim();
  const type = String(activityType || '').trim().toLowerCase();
  if (!roomName || !id || !type) return;

  const starter = String(sender || socket?.username || 'Someone').trim() || 'Someone';
  const senderCanonicalUsername = socket?.principal?.kind === 'account'
    ? String(socket.principal.canonicalUsername || '')
    : '';

  void pushCoordinator.onActivityStarted({
    room: roomName,
    activityType: type,
    activityId: id,
    sender: starter,
    timestamp: new Date(),
  }, {
    senderCanonicalUsername,
  }).catch((error) => {
    console.warn('[Push] room activity notification failed', {
      type,
      room: roomName,
      code: String(error?.code || 'unexpected'),
    });
  });
};
const resolveAccountSessionToken = async (token) => {
  if (typeof token !== 'string' || !token) return null;
  const browserSession = accountSessions.resolve(token);
  if (browserSession) return browserSession;
  return mobileAccountSessions.resolve(token);
};
const revokeAccountSessionToken = async (token) => {
  if (typeof token !== 'string' || !token) return false;
  if (accountSessions.revoke(token)) return true;
  return mobileAccountSessions.revoke(token);
};
const roomPasswordService = createRoomPasswordService({ RoomModel: Room });
const roomAuthThrottle = createRoomAuthThrottle({
  maxTrackedKeys: ROOM_AUTH_MAX_TRACKED_KEYS,
});
const accountAuthThrottle = createRoomAuthThrottle({
  windowMs: ADMIN_AUTH_WINDOW_MS,
  maxFailures: ADMIN_AUTH_MAX_FAILURES,
  lockMs: ADMIN_AUTH_LOCK_MS,
  minRetryDelayMs: ADMIN_AUTH_MIN_RETRY_DELAY_MS,
  maxRetryDelayMs: ADMIN_AUTH_MAX_RETRY_DELAY_MS,
  maxTrackedKeys: ADMIN_AUTH_MAX_TRACKED_KEYS,
});
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
const getSocketRemoteAddress = (socket) =>
  resolveTrustedRemoteAddress({
    peerAddress: socket?.handshake?.address || socket?.conn?.remoteAddress,
    forwardedFor: socket?.handshake?.headers?.['x-forwarded-for'],
  });

const getAdminAuthAttemptKey = (socket, username) => {
  const remoteAddress = getSocketRemoteAddress(socket);
  const canonicalUser = normaliseAdminUsername(username || '');
  return `${remoteAddress}::${canonicalUser || '*'}`;
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
  const origin = isTrustedNativeHttpOrigin(req);
  if (!origin) return next();

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

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
    setHeaders: (res, filePath) => {
      applyUploadResponseHeaders(res, filePath);
    },
  })
);
app.use(express.static(path.join(__dirname, 'public')));

const pushApiJson = express.json({ limit: '32kb' });
const PRESENCE_LEASE_MAX_MS = 90_000;
const PUSH_OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const pushTokenFingerprint = (token) => {
  const clean = String(token || '').trim();
  return clean ? crypto.createHash('sha256').update(clean).digest('hex').slice(0, 12) : '';
};

const readAccountSessionTokenFromRequest = (req) => {
  const authorization = String(req.headers.authorization || '');
  if (!/^Bearer\s+/i.test(authorization)) return '';
  return authorization.replace(/^Bearer\s+/i, '').trim();
};

const requireHttpAccount = async (req, res, next) => {
  const token = readAccountSessionTokenFromRequest(req);
  if (!token) return res.status(401).json({ ok: false, code: 'AUTH_REQUIRED' });
  try {
    const session = await resolveAccountSessionToken(token);
    if (!session?.principal) {
      return res.status(401).json({ ok: false, code: 'AUTH_REQUIRED' });
    }
    req.accountSession = session;
    req.accountSessionToken = token;
    req.accountPrincipal = session.principal;
    return next();
  } catch (error) {
    console.warn('[Push] account HTTP auth unavailable', { code: String(error?.code || 'unexpected') });
    return res.status(503).json({ ok: false, code: 'AUTH_UNAVAILABLE' });
  }
};

const requireHttpOwner = (req, res, next) => {
  if (req.accountPrincipal?.kind !== 'account' || req.accountPrincipal?.role !== 'owner') {
    return res.status(403).json({ ok: false, code: 'OWNER_REQUIRED' });
  }
  return next();
};

const requireHttpMobileAccount = async (req, res, next) => {
  const token = readAccountSessionTokenFromRequest(req);
  if (!token) return res.status(401).json({ ok: false, code: 'AUTH_REQUIRED' });
  try {
    const session = await resolveAccountSessionToken(token);
    if (!session?.principal) {
      return res.status(401).json({ ok: false, code: 'AUTH_REQUIRED' });
    }
    if (session.kind !== 'mobile' || !session.sessionId) {
      return res.status(403).json({ ok: false, code: 'MOBILE_SESSION_REQUIRED' });
    }
    req.accountSession = session;
    req.accountSessionToken = token;
    req.accountPrincipal = session.principal;
    return next();
  } catch (error) {
    console.warn('[Push] mobile HTTP auth unavailable', { code: String(error?.code || 'unexpected') });
    return res.status(503).json({ ok: false, code: 'AUTH_UNAVAILABLE' });
  }
};

const sendPushStateError = (res, error) => {
  const code = String(error?.code || 'PUSH_STATE_INVALID');
  const conflictCodes = new Set([
    'DEVICE_NOT_REGISTERED',
    'DEVICE_ACCOUNT_MISMATCH',
    'MOBILE_SESSION_INVALID',
    'ACCOUNT_INACTIVE',
  ]);
  return res.status(conflictCodes.has(code) ? 409 : 400).json({ ok: false, code });
};

const readCursorJson = (cursor) => cursor ? {
  room: String(cursor.room || ''),
  messageId: String(cursor.messageId || ''),
  messageTimestamp: cursor.messageTimestamp,
} : null;

app.get('/api/web-push/config', (_req, res) => {
  return res.json({
    enabled: Boolean(webPushTransport.enabled),
    publicKey: webPushTransport.enabled ? webPushTransport.publicKey : '',
  });
});

app.post('/api/web-push/register', pushApiJson, requireHttpAccount, async (req, res) => {
  try {
    await webPushSubscriptionService.registerSubscription({
      canonicalUsername: req.accountPrincipal.canonicalUsername,
      subscription: req.body?.subscription,
      deviceLabel: req.body?.deviceLabel,
    });
    return res.json({ ok: true });
  } catch (error) {
    console.warn('[WebPush] subscription registration failed', {
      code: String(error?.code || 'unexpected'),
    });
    return res.status(400).json({ ok: false, code: String(error?.code || 'WEB_PUSH_REGISTER_FAILED') });
  }
});

app.post('/api/web-push/room', pushApiJson, requireHttpAccount, async (req, res) => {
  try {
    await webPushSubscriptionService.setRoomSubscription({
      canonicalUsername: req.accountPrincipal.canonicalUsername,
      endpoint: req.body?.endpoint,
      room: req.body?.room,
      subscribed: req.body?.subscribed !== false,
    });
    return res.json({ ok: true });
  } catch (error) {
    console.warn('[WebPush] room subscription update failed', {
      code: String(error?.code || 'unexpected'),
    });
    return res.status(400).json({ ok: false, code: String(error?.code || 'WEB_PUSH_ROOM_FAILED') });
  }
});

app.post('/api/web-push/presence', pushApiJson, requireHttpAccount, async (req, res) => {
  try {
    const expiresAt = await webPushSubscriptionService.setPresence({
      canonicalUsername: req.accountPrincipal.canonicalUsername,
      endpoint: req.body?.endpoint,
      interactive: req.body?.interactive === true,
      ttlMs: req.body?.ttlMs,
    });
    return res.json({ ok: true, expiresAt });
  } catch (error) {
    console.warn('[WebPush] presence update failed', {
      code: String(error?.code || 'unexpected'),
    });
    return res.status(400).json({ ok: false, code: String(error?.code || 'WEB_PUSH_PRESENCE_FAILED') });
  }
});

app.post('/api/web-push/unregister', pushApiJson, requireHttpAccount, async (req, res) => {
  try {
    await webPushSubscriptionService.disableSubscription({
      canonicalUsername: req.accountPrincipal.canonicalUsername,
      endpoint: req.body?.endpoint,
      reason: 'signed-out',
    });
    return res.json({ ok: true });
  } catch (error) {
    console.warn('[WebPush] unregister failed', {
      code: String(error?.code || 'unexpected'),
    });
    return res.status(400).json({ ok: false, code: String(error?.code || 'WEB_PUSH_UNREGISTER_FAILED') });
  }
});

app.post('/api/mobile/push/register', pushApiJson, requireHttpMobileAccount, async (req, res) => {
  try {
    await pushDeviceService.registerDevice({
      sessionId: req.accountSession.sessionId,
      canonicalUsername: req.accountPrincipal.canonicalUsername,
      deviceId: req.body?.deviceId,
      fcmToken: req.body?.fcmToken,
      platform: req.body?.platform,
      deviceLabel: req.body?.deviceLabel,
    });
    console.info('[Push] device registered', {
      tokenFingerprint: pushTokenFingerprint(req.body?.fcmToken),
    });
    return res.json({ ok: true });
  } catch (error) {
    console.warn('[Push] device registration failed', { code: String(error?.code || 'unexpected') });
    return sendPushStateError(res, error);
  }
});

app.post('/api/mobile/push/presence', pushApiJson, requireHttpMobileAccount, async (req, res) => {
  const deviceId = String(req.body?.deviceId || '').trim();
  try {
    if (req.body?.interactive === true) {
      const raw = Number(req.body?.ttlMs ?? 45_000);
      const ttlMs = Math.min(Math.max(Number.isFinite(raw) ? raw : 45_000, 5_000), PRESENCE_LEASE_MAX_MS);
      const expiresAt = await pushDeviceService.renewSuppressionLease({
        sessionId: req.accountSession.sessionId,
        deviceId,
        ttlMs,
      });
      return res.json({ ok: true, interactive: true, expiresAt });
    }

    await pushDeviceService.clearSuppressionLease({
      sessionId: req.accountSession.sessionId,
      deviceId,
    });
    return res.json({ ok: true, interactive: false });
  } catch (error) {
    console.warn('[Push] device presence update failed', { code: String(error?.code || 'unexpected') });
    return sendPushStateError(res, error);
  }
});

app.post('/api/mobile/push/reply', pushApiJson, requireHttpMobileAccount, async (req, res) => {
  const room = normaliseRoomName(req.body?.room);
  const text = String(req.body?.text || '').trim();
  const replyToMessageId = String(req.body?.replyToMessageId || '').trim();
  const deviceId = String(req.body?.deviceId || '').trim();
  if (!room || !text || text.length > 1000 || !deviceId) {
    return res.status(400).json({ ok: false, code: 'MOBILE_REPLY_INVALID' });
  }
  if (replyToMessageId && !PUSH_OBJECT_ID_PATTERN.test(replyToMessageId)) {
    return res.status(400).json({ ok: false, code: 'MOBILE_REPLY_TARGET_INVALID' });
  }

  try {
    const subscription = await pushDeviceService.findActiveSubscription({
      sessionId: req.accountSession.sessionId,
      deviceId,
      room,
    });
    if (!subscription) {
      return res.status(403).json({ ok: false, code: 'ROOM_SUBSCRIPTION_REQUIRED' });
    }

    const username = String(req.accountPrincipal.username || '').trim();
    if (!username) return res.status(403).json({ ok: false, code: 'ACCOUNT_IDENTITY_REQUIRED' });
    if (isUserBlocked(room, username)) {
      return res.status(403).json({ ok: false, code: 'ROOM_BLOCKED' });
    }
    const muteUntil = getMuteExpiry(room, username);
    if (muteUntil) {
      return res.status(403).json({ ok: false, code: 'ROOM_MUTED', until: muteUntil });
    }
    if (!canSendMessage(`mobile:${req.accountSession.sessionId}`)) {
      return res.status(429).json({ ok: false, code: 'MESSAGE_RATE_LIMITED' });
    }

    const persistedMessage = await chatMessageService.persistChatMessage({
      room,
      username,
      senderCanonicalUsername: req.accountPrincipal.canonicalUsername,
      message: {
        text,
        replyTo: replyToMessageId || undefined,
      },
    });
    return res.status(201).json({ ok: true, messageId: String(persistedMessage._id) });
  } catch (error) {
    console.warn('[Push] mobile notification reply failed', { code: String(error?.code || 'unexpected') });
    return res.status(500).json({ ok: false, code: 'MOBILE_REPLY_UNAVAILABLE' });
  }
});

app.post('/api/read-state/mark', pushApiJson, requireHttpAccount, async (req, res) => {
  const room = normaliseRoomName(req.body?.room);
  const messageId = String(req.body?.messageId || '').trim();
  if (!room || !PUSH_OBJECT_ID_PATTERN.test(messageId)) {
    return res.status(400).json({ ok: false, code: 'READ_STATE_INVALID' });
  }

  try {
    const persistedMessage = await Message.findById(messageId);
    if (!persistedMessage) {
      return res.status(404).json({ ok: false, code: 'MESSAGE_NOT_FOUND' });
    }
    if (String(persistedMessage.room || '') !== room) {
      return res.status(409).json({ ok: false, code: 'MESSAGE_ROOM_MISMATCH' });
    }
    const messageTimestamp = persistedMessage.timestamp;
    const result = await readStateCoordinator.advance({
      canonicalUsername: req.accountPrincipal.canonicalUsername,
      room,
      messageId: String(persistedMessage._id),
      messageTimestamp,
    });
    return res.json({ ok: true, advanced: result.advanced, cursor: readCursorJson(result.cursor) });
  } catch (error) {
    console.warn('[Push] read cursor advance failed', { code: String(error?.code || 'unexpected') });
    return res.status(500).json({ ok: false, code: 'READ_STATE_UNAVAILABLE' });
  }
});

app.get('/api/read-state', requireHttpAccount, async (req, res) => {
  const room = normaliseRoomName(req.query?.room);
  if (!room) return res.status(400).json({ ok: false, code: 'READ_STATE_INVALID' });
  try {
    const cursor = await readStateCoordinator.getCursor({
      canonicalUsername: req.accountPrincipal.canonicalUsername,
      room,
    });
    return res.json({ ok: true, cursor: readCursorJson(cursor) });
  } catch (error) {
    console.warn('[Push] read cursor lookup failed', { code: String(error?.code || 'unexpected') });
    return res.status(500).json({ ok: false, code: 'READ_STATE_UNAVAILABLE' });
  }
});

// ---------------- Version endpoint ----------------
const VERSION = "1.3";
const BUILD = "fusion-supernova";
app.get('/version', (req, res) => {
  res.json({ version: VERSION, build: BUILD, time: new Date().toISOString() });
});

// ---------------- File Uploads ----------------
const fsPromises = fs.promises;
const UPLOAD_QUARANTINE_DIR = path.resolve(
  process.env.UPLOAD_QUARANTINE_DIR || '/var/lib/dizychat/upload-quarantine'
);
const PUBLIC_ROOT = path.resolve(__dirname, 'public');
if (
  UPLOAD_QUARANTINE_DIR === PUBLIC_ROOT
  || UPLOAD_QUARANTINE_DIR.startsWith(`${PUBLIC_ROOT}${path.sep}`)
) {
  throw new Error('UPLOAD_QUARANTINE_DIR must not be inside the public web root');
}
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
const PSYBIN_METADATA_MAX_BYTES = parsePositiveIntegerEnv('PSYBIN_METADATA_MAX_BYTES', 512 * 1024, { min: 1024, max: 4 * 1024 * 1024 });
const PSYBIN_TEXT_MAX_BYTES = parsePositiveIntegerEnv('PSYBIN_TEXT_MAX_BYTES', 64 * 1024, { min: 256, max: 1024 * 1024 });
const psybinMetadataAdmission = createPublicMediaAdmissionController({
  maxStarts: parsePositiveIntegerEnv('PSYBIN_METADATA_MAX_STARTS_PER_WINDOW', 30, { min: 6, max: 300 }),
  maxConcurrent: parsePositiveIntegerEnv('PSYBIN_METADATA_MAX_CONCURRENT_PER_IP', 3, { min: 1, max: 10 }),
  windowMs: parsePositiveIntegerEnv('PSYBIN_METADATA_RATE_WINDOW_SECONDS', 60, { min: 10, max: 60 * 60 }) * 1000,
});

const guardPsybinMetadata = (req, res, next) => {
  const admission = psybinMetadataAdmission.acquire(req.ip || req.socket?.remoteAddress || 'unknown');
  if (!admission.ok) {
    const retryAfterSeconds = Math.max(1, Math.ceil(admission.retryAfterMs / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    logSecurityEvent('psybin_metadata_rate_limited', {
      code: admission.code,
      ip: req.ip || req.socket?.remoteAddress || 'unknown',
    });
    return res.status(429).json({
      title: '',
      artist: '',
      text: '',
      fetchedAt: Date.now(),
      error: 'RATE_LIMITED',
    });
  }

  const release = () => admission.release();
  res.once('finish', release);
  res.once('close', release);
  next();
};
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

app.get('/api/psybin/now-playing', guardPsybinMetadata, async (req, res) => {
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
      const payloadBuffer = await readBoundedBody(response, PSYBIN_METADATA_MAX_BYTES);
      payload = JSON.parse(payloadBuffer.toString('utf8'));
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

    const rawSongBuffer = await readBoundedBody(songResponse, PSYBIN_TEXT_MAX_BYTES);
    const rawSong = rawSongBuffer.toString('utf8');
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
      const remainingText = await readBoundedBody(timeResponse, PSYBIN_TEXT_MAX_BYTES)
        .then((buffer) => buffer.toString('utf8'))
        .catch(() => '');
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
  destination: (_req, _file, cb) => {
    fs.mkdir(UPLOAD_QUARANTINE_DIR, { recursive: true, mode: 0o700 }, (error) => {
      cb(error, UPLOAD_QUARANTINE_DIR);
    });
  },
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

const uploadAbuseLimits = readUploadAbuseLimits(process.env);
const uploadAdmissionController = createUploadAdmissionController(uploadAbuseLimits);
console.log(
  `[Upload] Abuse guard: ${uploadAbuseLimits.maxConcurrent} concurrent/IP, `
  + `${uploadAbuseLimits.maxStarts} starts/${Math.round(uploadAbuseLimits.windowMs / 1000)}s/IP`
);

const guardUploadAbuse = (req, res, next) => {
  const clientKey = String(req.ip || req.socket?.remoteAddress || 'unknown').trim() || 'unknown';
  const admission = uploadAdmissionController.acquire(clientKey);

  if (!admission.ok) {
    const retryAfterSeconds = Math.max(1, Math.ceil(admission.retryAfterMs / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    logSecurityEvent('upload_rate_limited', {
      code: admission.code,
      ip: clientKey,
      retryAfterSeconds,
    });
    return res.status(429).json({
      error: 'Too many uploads from this connection. Please wait and try again.',
      code: admission.code,
      retryAfterSeconds,
    });
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    admission.release();
  };
  res.once('finish', release);
  res.once('close', release);
  return next();
};

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

app.post('/upload', validateUploadOrigin, guardUploadAbuse, uploadSingleMiddleware, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const quarantinePath = req.file.path;
  const finalPath = path.join(uploadDir, req.file.filename);

  try {
    await scanFileWithClamAv(quarantinePath);

    const voiceMessage = String(req.body?.voiceMessage || '').trim() === '1';
    if (voiceMessage) {
      const publishedVoice = await normalizeVoiceMessageUpload({
        sourcePath: quarantinePath,
        storedFilename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        uploadDir,
      });
      return res.json({
        url: `/uploads/${publishedVoice.filename}`,
        name: publishedVoice.originalName,
        type: publishedVoice.mimeType,
        size: publishedVoice.size,
      });
    }

    await fsPromises.rename(quarantinePath, finalPath);

    return res.json({
      url: `/uploads/${req.file.filename}`,
      name: req.file.originalname,
      type: req.file.mimetype,
      size: req.file.size
    });
  } catch (err) {
    try {
      await fsPromises.unlink(quarantinePath);
    } catch (cleanupError) {
      if (cleanupError?.code !== 'ENOENT') {
        console.error('[Upload] Failed to remove quarantined file:', cleanupError);
      }
    }

    if (err?.code === 'CLAMAV_INFECTED') {
      logSecurityEvent('upload_malware_rejected', {
        filename: path.basename(String(req.file.originalname || '')),
        threat: err.threat || 'detected',
      });
      return res.status(422).json({ error: 'Upload rejected by antivirus scan.' });
    }

    logSecurityEvent('upload_scan_failed', {
      code: err?.code || 'CLAMAV_ERROR',
      message: err?.message || 'ClamAV scan failed',
    });
    return res.status(503).json({
      error: 'Upload antivirus scan unavailable. Try again later.',
    });
  }
});

// ---------------- Link Preview ----------------
const linkPreviewAdmission = createPublicMediaAdmissionController({
  maxStarts: parsePositiveIntegerEnv('LINK_PREVIEW_MAX_STARTS_PER_WINDOW', 30, { min: 5, max: 300 }),
  maxConcurrent: parsePositiveIntegerEnv('LINK_PREVIEW_MAX_CONCURRENT_PER_IP', 3, { min: 1, max: 10 }),
  windowMs: parsePositiveIntegerEnv('LINK_PREVIEW_RATE_WINDOW_SECONDS', 60, { min: 10, max: 60 * 60 }) * 1000,
});

const guardLinkPreview = (req, res, next) => {
  const admission = linkPreviewAdmission.acquire(req.ip || req.socket?.remoteAddress || 'unknown');
  if (!admission.ok) {
    const retryAfterSeconds = Math.max(1, Math.ceil(admission.retryAfterMs / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    logSecurityEvent('link_preview_rate_limited', {
      code: admission.code,
      ip: req.ip || req.socket?.remoteAddress || 'unknown',
    });
    return res.status(429).json({ error: 'Too many link preview requests. Please wait and try again.' });
  }

  const release = () => admission.release();
  res.once('finish', release);
  res.once('close', release);
  next();
};

app.get('/link-preview', guardLinkPreview, async (req, res) => {
  let { url } = req.query;
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  try {
    const previewResponse = await fetchPublicHtmlPreview({
      fetchImpl: fetch,
      url,
    });
    url = previewResponse.url;

    if (!previewResponse.isHtml) {
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.json({ title: '', image: '', description: '', siteName: '', icon: '', embedUrl: '' });
    }

    const html = previewResponse.html;
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

    let embedRaw = pick(
      () => $('meta[property="og:video:secure_url"]').attr('content'),
      () => $('meta[property="og:video:url"]').attr('content'),
      () => $('meta[property="og:video"]').attr('content'),
      () => $('meta[name="twitter:player"]').attr('content'),
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
      const candidateEmbed = ensureString(chosen.embedUrl || chosen.contentUrl);
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
      if (candidateEmbed) embedRaw = candidateEmbed;
      if (candidateSite) siteName = candidateSite;
    };

    refineFromJsonLd();

    const clean = (value) => ensureString(value).trim();

    const responsePayload = {
      title: clean(title),
      description: clean(description),
      image: resolveAsset(clean(imageRaw)),
      icon: resolveAsset(clean(iconRaw)),
      embedUrl: resolveAsset(clean(embedRaw)),
      siteName: clean(siteName) || host,
    };

    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(responsePayload);
  } catch (err) {
    const code = String(err?.code || 'LINK_PREVIEW_FAILED');
    const logger = code.includes('BLOCKED') ? console.warn : console.error;
    logger('[Link Preview] Request rejected:', code, err?.message || err);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ title: '', image: '', description: '', siteName: '', icon: '', embedUrl: '' });
  }
});

const guardPublicMediaProxy = (req, res, next) => {
  const admission = publicMediaAdmission.acquire(req.ip || req.socket?.remoteAddress || 'unknown');
  if (!admission.ok) {
    const retryAfterSeconds = Math.max(1, Math.ceil(admission.retryAfterMs / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    logSecurityEvent('public_media_proxy_rate_limited', {
      code: admission.code,
      ip: req.ip || req.socket?.remoteAddress || 'unknown',
      path: req.path,
    });
    return res.status(429).json({
      error: 'Too many media lookup requests. Please wait and try again.',
      results: [],
      gif: '',
      tinyGif: '',
    });
  }

  const release = () => admission.release();
  res.once('finish', release);
  res.once('close', release);
  next();
};

app.get('/tenor-proxy', guardPublicMediaProxy, async (req, res) => {
  const { url } = req.query;
  if (!url || !/^https?:\/\/(?:www\.)?tenor\.com\//i.test(url)) {
    return res.status(400).json({ gif: '', tinyGif: '' });
  }

  try {
    const { data } = await fetchPublicMediaJson(`https://tenor.com/oembed?url=${encodeURIComponent(url)}`);
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

app.get('/giphy-search', guardPublicMediaProxy, async (req, res) => {
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
    const { response, data } = await fetchPublicMediaJson(`${apiPath}?${params.toString()}`);

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
      const { response: fallbackResponse, data: fallbackData } = await fetchPublicMediaJson(
        `${getFallbackGiphyClipUrl(endpoint)}?${fallbackParams.toString()}`,
      );

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

const soundboardImportJson = express.json({ limit: '4kb' });

app.post('/api/soundboards/import', soundboardImportJson, requireHttpAccount, requireHttpOwner, (req, res) => {
  try {
    const job = startSoundboardImportJob({
      boardUrl: req.body?.url,
      requestedBy: req.accountPrincipal?.canonicalUsername || req.accountPrincipal?.username,
    });
    return res.status(job.status === 'queued' ? 202 : 200).json({ ok: true, job });
  } catch (error) {
    const code = String(error?.code || 'SOUNDBOARD_IMPORT_INVALID');
    const status = code === 'SOUNDBOARD_IMPORT_BUSY' ? 409 : 400;
    return res.status(status).json({
      ok: false,
      code,
      error: String(error?.message || 'Unable to start soundboard import.'),
    });
  }
});

app.post('/api/soundboards/import-clip', soundboardImportJson, requireHttpAccount, requireHttpOwner, (req, res) => {
  try {
    const job = startSoundboardImportJob({
      boardUrl: req.body?.boardUrl,
      soundPageUrl: req.body?.soundPageUrl,
      requestedBy: req.accountPrincipal?.canonicalUsername || req.accountPrincipal?.username,
    });
    return res.status(job.status === 'queued' ? 202 : 200).json({ ok: true, job });
  } catch (error) {
    const code = String(error?.code || 'SOUNDBOARD_CLIP_IMPORT_INVALID');
    const status = code === 'SOUNDBOARD_IMPORT_BUSY' ? 409 : 400;
    return res.status(status).json({
      ok: false,
      code,
      error: String(error?.message || 'Unable to start soundboard clip import.'),
    });
  }
});

const soundboardLiveAdmission = createPublicMediaAdmissionController({
  maxStarts: parsePositiveIntegerEnv('SOUNDBOARD_LIVE_MAX_STARTS_PER_WINDOW', 60, { min: 10, max: 600 }),
  maxConcurrent: parsePositiveIntegerEnv('SOUNDBOARD_LIVE_MAX_CONCURRENT_PER_IP', 4, { min: 1, max: 20 }),
  windowMs: parsePositiveIntegerEnv('SOUNDBOARD_LIVE_RATE_WINDOW_SECONDS', 60, { min: 10, max: 60 * 60 }) * 1000,
});

const guardSoundboardLiveLookup = (req, res, next) => {
  const admission = soundboardLiveAdmission.acquire(req.ip || req.socket?.remoteAddress || 'unknown');
  if (!admission.ok) {
    const retryAfterSeconds = Math.max(1, Math.ceil(admission.retryAfterMs / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    logSecurityEvent('soundboard_live_lookup_rate_limited', {
      code: admission.code,
      ip: req.ip || req.socket?.remoteAddress || 'unknown',
      path: req.path,
    });
    return res.status(429).json({
      ok: false,
      code: 'SOUNDBOARD_LIVE_RATE_LIMIT',
      error: 'Too many live soundboard requests. Please wait and try again.',
    });
  }

  const release = () => admission.release();
  res.once('finish', release);
  res.once('close', release);
  next();
};

app.get('/api/soundboards/live-search', guardSoundboardLiveLookup, async (req, res) => {
  try {
    const result = await soundboardImporter.searchBoards({
      query: typeof req.query?.q === 'string' ? req.query.q : '',
      limit: 24,
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, ...result });
  } catch (error) {
    const code = String(error?.code || 'SOUNDBOARD_LIVE_SEARCH_FAILED');
    const status = code === 'BROWSER_APPROVAL_REQUIRED' ? 409 : 502;
    return res.status(status).json({
      ok: false,
      code,
      error: String(error?.message || '101Soundboards live search failed.'),
      results: [],
    });
  }
});

app.get('/api/soundboards/live-board', guardSoundboardLiveLookup, async (req, res) => {
  try {
    const result = await soundboardImporter.browseBoard({
      boardUrl: typeof req.query?.url === 'string' ? req.query.url : '',
      limit: 100,
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, board: result });
  } catch (error) {
    const code = String(error?.code || 'SOUNDBOARD_LIVE_BOARD_FAILED');
    const status = code === 'BROWSER_APPROVAL_REQUIRED' ? 409 : 502;
    return res.status(status).json({
      ok: false,
      code,
      error: String(error?.message || 'Could not browse that 101Soundboards board.'),
    });
  }
});

app.get('/api/soundboards/live-clip', guardSoundboardLiveLookup, async (req, res) => {
  try {
    const result = await soundboardImporter.resolveClip({
      soundPageUrl: typeof req.query?.url === 'string' ? req.query.url : '',
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, clip: result });
  } catch (error) {
    const code = String(error?.code || 'SOUNDBOARD_LIVE_CLIP_FAILED');
    const status = code === 'BROWSER_APPROVAL_REQUIRED' ? 409 : 502;
    return res.status(status).json({
      ok: false,
      code,
      error: String(error?.message || 'Could not preview that 101Soundboards clip.'),
    });
  }
});

app.post('/api/soundboards/rebuild-existing', soundboardImportJson, requireHttpAccount, requireHttpOwner, (req, res) => {
  try {
    const job = startExistingSoundboardRebuildJob({
      requestedBy: req.accountPrincipal?.canonicalUsername || req.accountPrincipal?.username,
    });
    return res.status(202).json({ ok: true, job });
  } catch (error) {
    const code = String(error?.code || 'SOUNDBOARD_REBUILD_INVALID');
    const status = code === 'SOUNDBOARD_IMPORT_BUSY' ? 409 : 400;
    return res.status(status).json({
      ok: false,
      code,
      error: String(error?.message || 'Unable to start existing-board rebuild.'),
    });
  }
});

app.get('/api/soundboards/import/:jobId', requireHttpAccount, requireHttpOwner, (req, res) => {
  trimSoundboardImportJobs();
  const job = readSoundboardImportJob(req.params?.jobId);
  if (!job) return res.status(404).json({ ok: false, code: 'SOUNDBOARD_IMPORT_NOT_FOUND' });
  return res.json({ ok: true, job });
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

const jamSessionRateLimiter = createJamSessionRateLimiter({
  windowMs: JAM_SESSION_EVENT_WINDOW_MS,
  maxStarts: JAM_SESSION_MAX_CREATES_PER_WINDOW,
});

const canCreateJamSession = (socketKey) => jamSessionRateLimiter.check(socketKey);

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
    id: 'music-call',
    name: 'Music Call',
    badge: 'Built into DizyChat',
    bestFor: 'Music-quality calls, lessons, Rocksmith, camera and screen sharing with no extra app.',
    mode: 'livekit-music-call',
    available: ENABLE_VOICE_CALLS && hasLivekitCredentials(),
    requiresInstallForBestAudio: false,
    setupTips: [
      'Starts the existing DizyChat call with Music mode enabled.',
      'Use this for talking, lessons, screen sharing and casual playing.',
      'For tightly synchronized playing, use DizyJam Low Latency instead.',
    ],
  },
  {
    id: 'dizyjam',
    name: 'DizyJam Low Latency',
    badge: DIZYJAM_ENABLED() ? 'Self-hosted · authenticated' : 'Server setup required',
    bestFor: 'Lowest-latency instrument sessions using our private JackTrip hub while DizyChat handles camera, chat and screen sharing.',
    mode: 'self-hosted-jacktrip',
    available: DIZYJAM_ENABLED(),
    host: DIZYJAM_ENABLED() ? DIZYJAM_HOST : '',
    tcpPort: DIZYJAM_TCP_PORT,
    udpBasePort: DIZYJAM_UDP_BASE_PORT,
    udpEndPort: DIZYJAM_UDP_END_PORT,
    sampleRate: DIZYJAM_SAMPLE_RATE,
    bufferSize: DIZYJAM_BUFFER_SIZE,
    requiresInstallForBestAudio: true,
    supportsAsioViaNativeApp: true,
    clientInstallUrl: DIZYJAM_CLIENT_INSTALL_URL,
    setupTips: [
      'DizyChat guides each musician through installing JackTrip and connecting to this room.',
      'Connection credentials are temporary and tied to the current DizyChat room session.',
      'Use your own interface, microphone, keyboard or DAW audio routing.',
    ],
  },
  {
    id: 'sonobus',
    name: 'SonoBus',
    badge: 'Optional fallback',
    bestFor: 'Free peer-to-peer fallback when you do not want to use the DizyJam hub.',
    mode: 'external-app',
    available: true,
    requiresInstallForBestAudio: true,
    supportsBrowserJoin: false,
    supportsAsioViaNativeApp: true,
    url: SONOBUS_DOWNLOAD_URL,
    setupTips: [
      'Install SonoBus, choose the generated group name, and optionally use the generated password.',
      'Use headphones and wired Ethernet for live instruments.',
      'SonoBus remains a fallback; DizyJam is the primary low-latency path.',
    ],
  },
];

app.get('/api/jam/status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    enabled: true,
    recommendedProvider: DIZYJAM_ENABLED() ? 'dizyjam' : 'music-call',
    dizyJam: {
      configured: DIZYJAM_ENABLED(),
      host: DIZYJAM_ENABLED() ? DIZYJAM_HOST : '',
      tcpPort: DIZYJAM_TCP_PORT,
      udpBasePort: DIZYJAM_UDP_BASE_PORT,
      udpEndPort: DIZYJAM_UDP_END_PORT,
      sampleRate: DIZYJAM_SAMPLE_RATE,
      bufferSize: DIZYJAM_BUFFER_SIZE,
      authRequired: true,
      credentialTtlSeconds: DIZYJAM_CREDENTIAL_TTL_SECONDS,
      missingRequiredEnv: getDizyJamMissingConfig(),
      oneSharedMix: true,
    },
    providers: getJamProviders(),
  });
});

app.post('/api/jam/session', express.json({ limit: '4kb' }), (req, res) => {
  const remoteAddress = req.ip || req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  if (!canCreateJamSession(String(remoteAddress).split(',')[0].trim())) {
    res.status(429).json({ error: 'Too many jam session requests. Please wait a minute and try again.' });
    return;
  }

  const providers = getJamProviders();
  const providerId = String(req.body?.provider || 'music-call').trim().toLowerCase();
  const provider = providers.find((entry) => entry.id === providerId);
  if (!provider) {
    res.status(400).json({ error: 'Unsupported jam provider.', providers });
    return;
  }
  if (provider.available === false) {
    const missing = provider.id === 'dizyjam' && !DIZYJAM_HOST ? ['DIZYJAM_HOST'] : [];
    res.status(503).json({
      error: provider.id === 'dizyjam'
        ? 'DizyJam is not configured on this server yet.'
        : 'This jam option is not currently available.',
      provider,
      missingRequiredEnv: missing,
    });
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
    badge: provider.badge,
    mode: provider.mode,
    setupTips: provider.setupTips,
  };

  if (provider.id === 'music-call') {
    session.instructions = [
      'DizyChat will open the existing Live Call panel with Music mode selected.',
      'Use this for lessons, Rocksmith, screen sharing, talking and casual playing.',
      'For the tightest instrument timing, switch to DizyJam Low Latency.',
    ];
  } else if (provider.id === 'dizyjam') {
    res.status(403).json({
      error: 'DizyJam credentials are issued only to an admitted DizyChat room session.',
      code: 'DIZYJAM_SOCKET_AUTH_REQUIRED',
    });
    return;
  } else if (provider.id === 'sonobus') {
    session.groupName = sessionId;
    session.password = password;
    session.instructions = [
      `Open SonoBus and join group ${sessionId}.`,
      `Use password ${password} if you want a private group.`,
      'Use headphones and wired Ethernet. SonoBus remains the optional peer-to-peer fallback.',
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

app.post('/api/calls/token', express.json({ limit: '8kb' }), (req, res) => {
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
  const grant = resolveCallTokenGrant({
    io,
    room,
    socketId: req.body?.socketId,
    nonce: req.body?.callTokenNonce,
  });
  if (!grant.ok) {
    logSecurityEvent('call_token_grant_rejected', {
      code: grant.code,
      room,
      ip: req.ip || req.socket?.remoteAddress || 'unknown',
    });
    res.status(403).json({
      error: 'Join this DizyChat room before requesting a call token.',
      code: 'CALL_ROOM_GRANT_REQUIRED',
    });
    return;
  }

  const username = normaliseUsername(grant.username, '');
  const musicMode = req.body?.musicMode === true;
  const callSessionId = String(req.body?.callSessionId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  if (!room || !username) {
    res.status(400).json({ error: 'room and admitted room identity are required.' });
    return;
  }
  if (isUserBlocked(room, username)) {
    res.status(403).json({ error: 'Call access is unavailable while blocked in this room.' });
    return;
  }

  try {
    const token = createLivekitToken({
      room,
      username: callSessionId ? `${username}--${callSessionId}` : username,
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
      cameraDisabled: isCallVideoBlocked(room, username),
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

  try {
    dizyJamCredentialStore.revokeSocket(socket.id);
  } catch (error) {
    console.error('[DizyJam] Failed to revoke room credential:', error?.message || error);
  }

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
const SOCKET_QUERY_RATE_WINDOW_MS = parsePositiveIntegerEnv('SOCKET_QUERY_RATE_WINDOW_MS', 2000, { min: 500, max: 60_000 });
const SOCKET_QUERY_MAX_PER_WINDOW = parsePositiveIntegerEnv('SOCKET_QUERY_MAX_PER_WINDOW', 8, { min: 2, max: 100 });

const messageTimestamps = new Map();
const typingTimestamps = new Map();
const socketQueryTimestamps = new Map();
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
const normaliseCallActivityMode = (value) =>
  String(value || '').trim().toLowerCase() === 'jam' ? 'jam' : 'voice';

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
    mode: state.mode === 'jam' ? 'jam' : 'voice',
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
      canPublishSources: ['microphone', 'camera', 'screen_share', 'screen_share_audio'],
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

const canRunSocketQuery = (socketId) => {
  if (!socketId) return false;
  const now = Date.now();
  if (!socketQueryTimestamps.has(socketId)) socketQueryTimestamps.set(socketId, []);
  const ts = socketQueryTimestamps.get(socketId);
  while (ts.length && now - ts[0] > SOCKET_QUERY_RATE_WINDOW_MS) ts.shift();
  if (ts.length >= SOCKET_QUERY_MAX_PER_WINDOW) return false;
  ts.push(now);
  return true;
};

const clearSocketRateLimitState = (socketId) => {
  if (!socketId) return;
  messageTimestamps.delete(socketId);
  typingTimestamps.delete(socketId);
  socketQueryTimestamps.delete(socketId);
  callEventTimestamps.delete(socketId);
  watchPartyCreateTimestamps.delete(socketId);
};

function requireAdmin(socket){
  const principal = requireModerator(socket);
  if (!principal) {
    socket.emit('toast', { type: 'warn', text: '🚫 Admin only command.' });
    return false;
  }
  return true;
}

io.use(async (socket, next) => {
  const sessionToken = typeof socket.handshake.auth?.sessionToken === 'string'
    ? socket.handshake.auth.sessionToken.trim()
    : '';
  socket.principal = null;
  socket.accountSessionToken = '';
  socket.mobileSessionId = '';
  socket.mobileDeviceId = '';
  try {
    const session = await resolveAccountSessionToken(sessionToken);
    if (session) {
      socket.principal = session.principal;
      socket.accountSessionToken = session.token;
      socket.mobileSessionId = session.kind === 'mobile' ? String(session.sessionId || '') : '';
    }
    next();
  } catch (err) {
    console.error('[Auth v2] Session handshake unavailable:', err?.message || err);
    next();
  }
});

io.on('connection', socket => {
  console.log('[Socket] Connected', socket.id);
  socket.emit('room list', getPublicRoomsSnapshot());

  socket.on('account login', async (payload = {}, ack) => {
    try {
      const username = typeof payload.username === 'string' ? payload.username.trim() : '';
      const password = typeof payload.password === 'string' ? payload.password : '';
      const attemptKey = getAdminAuthAttemptKey(socket, username);
      const authGate = accountAuthThrottle.check(attemptKey);
      if (authGate.blocked) {
        if (typeof ack === 'function') {
          ack({
            ok: false,
            error: authGate.reason === 'delay'
              ? 'Authentication retry delayed.'
              : 'Too many authentication attempts.',
            retryAfterMs: authGate.retryAfterMs,
          });
        }
        return;
      }

      const account = await accountService.authenticate(username, password);
      if (!account) {
        const failedState = accountAuthThrottle.registerFailure(attemptKey);
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'Invalid username or password.', retryAfterMs: failedState.retryAfterMs });
        }
        return;
      }

      const wantsMobileSession = payload.sessionKind === 'mobile';
      if (wantsMobileSession && !isTrustedNativeOrigin(socket)) {
        if (typeof ack === 'function') ack({ ok: false, error: 'MOBILE_SESSION_ORIGIN_NOT_ALLOWED' });
        return;
      }

      accountAuthThrottle.clear(attemptKey);
      if (socket.accountSessionToken) {
        const previousMobileSessionId = socket.mobileSessionId;
        await revokeAccountSessionToken(socket.accountSessionToken);
        if (previousMobileSessionId) {
          await pushDeviceService.disableSession(previousMobileSessionId, 'session-replaced');
        }
      }

      const principal = {
        kind: 'account',
        username: account.username,
        canonicalUsername: account.canonicalUsername,
        role: account.role,
        userId: account.userId,
      };
      const session = wantsMobileSession
        ? await mobileAccountSessions.issue(principal, { deviceLabel: payload.deviceLabel })
        : accountSessions.issue(principal);
      socket.principal = session.principal;
      socket.accountSessionToken = session.token;
      socket.mobileSessionId = session.kind === 'mobile' ? String(session.sessionId || '') : '';
      socket.mobileDeviceId = '';

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

  socket.on('account session', async (payload = {}, ack) => {
    try {
      const session = await resolveAccountSessionToken(socket.accountSessionToken);
      if (!session) {
        socket.accountSessionToken = '';
        socket.principal = null;
        socket.mobileSessionId = '';
        socket.mobileDeviceId = '';
        if (typeof ack === 'function') ack({ ok: true, session: null });
        return;
      }

      const previousMobileSessionId = socket.mobileSessionId;
      socket.principal = session.principal;
      socket.accountSessionToken = session.token;
      socket.mobileSessionId = session.kind === 'mobile' ? String(session.sessionId || '') : '';
      if (socket.mobileSessionId !== previousMobileSessionId) socket.mobileDeviceId = '';
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
      console.error('[Auth v2] Account session unavailable:', err?.message || err);
      if (typeof ack === 'function') ack({ ok: false, error: 'ACCOUNT_SESSION_UNAVAILABLE' });
    }
  });

  socket.on('account logout', async (payload = {}, ack) => {
    try {
      const mobileSessionId = socket.mobileSessionId;
      try {
        dizyJamCredentialStore.revokeSocket(socket.id);
      } catch (error) {
        console.error('[DizyJam] Failed to revoke logout credential:', error?.message || error);
      }
      if (socket.accountSessionToken) {
        await revokeAccountSessionToken(socket.accountSessionToken);
      }
      if (mobileSessionId) {
        await pushDeviceService.disableSession(mobileSessionId, 'session-revoked');
      }
      socket.accountSessionToken = '';
      socket.principal = null;
      socket.mobileSessionId = '';
      socket.mobileDeviceId = '';
      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      console.error('[Auth v2] Account logout unavailable:', err?.message || err);
      if (typeof ack === 'function') ack({ ok: false, error: 'ACCOUNT_LOGOUT_UNAVAILABLE' });
    }
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
      await mobileAccountSessions.revokeUser(account.canonicalUsername);
      await pushDeviceService.disableUser(account.canonicalUsername, 'account-revoked');
      if (typeof ack === 'function') ack({ ok: true, account });
    } catch (err) {
      console.error('[Auth v2] Managed user creation failed:', err?.message || err);
      if (typeof ack === 'function') {
        ack({ ok: false, error: err?.message || 'Unable to create account.' });
      }
    }
  });

  socket.on('join room', async (payload = {}) => {
    const { room, username, password } = payload;
    const deviceId = typeof payload.deviceId === 'string' ? payload.deviceId.trim() : '';
    const roomName = normaliseRoomName(room);
    if (!roomName) {
      sendJoinError(socket, 'Room name is required');
      return;
    }

    const providedPassword = normalisePassword(password);
    const roomAuthKey = `${getSocketRemoteAddress(socket)}::${roomName.toLowerCase()}`;
    const roomAuthGate = roomAuthThrottle.check(roomAuthKey);
    if (roomAuthGate.blocked) {
      logSecurityEvent('room_password_rate_limited', {
        room: roomName,
        ip: getSocketRemoteAddress(socket),
        socketId: socket.id,
        retryAfterMs: roomAuthGate.retryAfterMs,
      });
      sendJoinError(socket, 'Too many incorrect room password attempts. Please wait and try again.');
      return;
    }

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
      const failure = roomAuthThrottle.registerFailure(roomAuthKey);
      logSecurityEvent('room_password_mismatch', {
        room: roomName,
        ip: getSocketRemoteAddress(socket),
        socketId: socket.id,
        retryAfterMs: failure.retryAfterMs,
      });
      sendJoinError(socket, 'Incorrect room password');
      return;
    }

    roomAuthThrottle.clear(roomAuthKey);

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
    if (socket.mobileSessionId && deviceId && socket.principal?.kind === 'account') {
      try {
        const device = await pushDeviceService.findRegisteredDevice({
          sessionId: socket.mobileSessionId,
          deviceId,
        });
        if (device) {
          socket.mobileDeviceId = deviceId;
          await pushDeviceService.subscribeRoom({
            sessionId: socket.mobileSessionId,
            canonicalUsername: socket.principal.canonicalUsername,
            deviceId,
            room: roomName,
          });
        }
      } catch (error) {
        console.warn('[Push] room subscription unavailable', { code: String(error?.code || 'unexpected') });
      }
    }
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

      if (!canRunSocketQuery(socket.id)) {
        socket.emit('older messages', {
          messages: [],
          hasMore: true,
          cursor: String(cursor),
          rateLimited: true,
        });
        return;
      }

      const historyChunk = await fetchMessageHistoryChunk(roomName, { beforeId: cursor });
      socket.emit('older messages', historyChunk);
    } catch (err) {
      console.error('[History] Failed to load older messages:', err);
      socket.emit('older messages', { messages: [], hasMore: false, cursor: null });
    }
  });

  socket.on('leave room', async ({ room, deviceId } = {}) => {
    const target = normaliseRoomName(room) || socket.currentRoom;
    if (!target) return;
    const normalizedDeviceId = String(deviceId || '').trim();
    if (socket.mobileSessionId && normalizedDeviceId && normalizedDeviceId === socket.mobileDeviceId) {
      try {
        await pushDeviceService.unsubscribeRoom({
          sessionId: socket.mobileSessionId,
          deviceId: normalizedDeviceId,
          room: target,
        });
      } catch (error) {
        console.warn('[Push] room unsubscribe unavailable', { code: String(error?.code || 'unexpected') });
      }
    }
    removeSocketFromRoom(socket, target);
    emitRoomListUpdate();
  });

  socket.on('jam:dizyjam-credentials', (payload = {}, ack) => {
    const respond = (body) => {
      if (typeof ack === 'function') ack(body);
    };

    try {
      if (!DIZYJAM_ENABLED()) {
        respond({
          ok: false,
          error: 'DizyJam is not fully configured on this server yet.',
          code: 'DIZYJAM_NOT_CONFIGURED',
          missingRequiredEnv: getDizyJamMissingConfig(),
        });
        return;
      }

      const roomName = normaliseRoomName(socket.currentRoom);
      const requestedRoom = normaliseRoomName(payload?.room);
      if (!roomName || (requestedRoom && requestedRoom !== roomName)) {
        respond({
          ok: false,
          error: 'Join the DizyChat room before requesting DizyJam access.',
          code: 'DIZYJAM_ROOM_REQUIRED',
        });
        return;
      }

      const displayName = normaliseUsername(socket.username, '');
      const identityKind = String(socket.identityKind || socket.principal?.kind || '');
      if (!displayName || !['account', 'guest'].includes(identityKind)) {
        respond({
          ok: false,
          error: 'A registered DizyChat account or admitted guest identity is required.',
          code: 'DIZYJAM_IDENTITY_REQUIRED',
        });
        return;
      }

      if (isUserBlocked(roomName, displayName)) {
        respond({
          ok: false,
          error: 'DizyJam access is unavailable while you are blocked in this room.',
          code: 'DIZYJAM_BLOCKED',
        });
        return;
      }

      if (!canCreateJamSession(socket.id)) {
        respond({
          ok: false,
          error: 'Too many DizyJam credential requests. Please wait a minute and try again.',
          code: 'DIZYJAM_RATE_LIMITED',
        });
        return;
      }

      const activeRooms = dizyJamCredentialStore.getActiveRooms();
      const startingNewJam = !activeRooms.includes(roomName);
      if (activeRooms.some((activeRoom) => activeRoom !== roomName)) {
        respond({
          ok: false,
          error: 'The low-latency DizyJam hub is currently in use by another DizyChat room.',
          code: 'DIZYJAM_BUSY',
        });
        return;
      }

      const credential = dizyJamCredentialStore.issue({
        socketId: socket.id,
        displayName,
        room: roomName,
        identityKind,
      });

      const command = [
        'jacktrip',
        '-C', DIZYJAM_HOST,
        '-A',
        '--username', credential.username,
        '--password',
        '-q', 'auto',
        '--bufstrategy', '4',
      ].join(' ');

      logSecurityEvent('dizyjam_credential_issued', {
        room: roomName,
        username: displayName,
        identityKind,
        socketId: socket.id,
        expiresAt: credential.expiresAt,
      });

      if (startingNewJam) {
        notifyRoomActivity({
          room: roomName,
          activityType: 'jam',
          activityId: `dizyjam:${crypto.randomUUID()}`,
          socket,
        });
      }

      respond({
        ok: true,
        session: {
          provider: 'dizyjam',
          providerName: 'DizyJam Low Latency',
          room: roomName,
          title: `${roomName} Jam`,
          badge: 'Self-hosted · authenticated',
          mode: 'self-hosted-jacktrip',
          host: DIZYJAM_HOST,
          tcpPort: DIZYJAM_TCP_PORT,
          udpBasePort: DIZYJAM_UDP_BASE_PORT,
          udpEndPort: DIZYJAM_UDP_END_PORT,
          sampleRate: DIZYJAM_SAMPLE_RATE,
          bufferSize: DIZYJAM_BUFFER_SIZE,
          clientInstallUrl: DIZYJAM_CLIENT_INSTALL_URL,
          authRequired: true,
          username: credential.username,
          password: credential.password,
          displayName: credential.displayName,
          identityKind: credential.identityKind,
          expiresAt: credential.expiresAt,
          clientCommand: command,
          oneSharedMix: true,
          instructions: [
            'These JackTrip credentials were minted for your current DizyChat session and are not derived from your public username.',
            'Connect in authenticated Hub Client mode; the credential is removed when you leave/sign out and also expires automatically.',
            `The DizyJam server runs at ${DIZYJAM_SAMPLE_RATE} Hz with a ${DIZYJAM_BUFFER_SIZE}-frame JACK buffer.`,
            'Keep DizyChat open for camera, chat and screen sharing. Mute DizyChat call audio while actively jamming to avoid doubled/echoed instruments.',
            'Use wired Ethernet, headphones and an ASIO interface on Windows where possible.',
          ],
        },
      });
    } catch (error) {
      console.error('[DizyJam] Credential issue failed:', error?.message || error);
      respond({
        ok: false,
        error: 'Unable to issue DizyJam credentials right now.',
        code: 'DIZYJAM_CREDENTIAL_FAILURE',
      });
    }
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
      notifyRoomActivity({
        room: roomName,
        activityType: 'watch-party',
        activityId: payload.sessionId,
        socket,
      });
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

  socket.on('call:start', ({ room, mode } = {}) => {
    if (!ensureCallsEnabled(socket) || !canSendCallEvent(socket.id)) return;
    const roomName = normaliseRoomName(room || socket.currentRoom);
    if (!roomName || roomName !== socket.currentRoom) return;
    if (activeRoomCalls.has(roomName)) {
      socket.emit('call:error', { room: roomName, message: 'A call is already active.' });
      return;
    }
    const activityType = normaliseCallActivityMode(mode);
    const state = {
      callId: buildCallId(),
      startedAt: Date.now(),
      startedBy: socket.username || 'admin',
      startedBySocketId: socket.id,
      mode: activityType,
      mediaAnnouncements: new Set(),
    };
    activeRoomCalls.set(roomName, state);
    io.to(roomName).emit('call:started', getActiveCallSnapshot(roomName));
    notifyRoomActivity({
      room: roomName,
      activityType,
      activityId: state.callId,
      socket,
    });
  });

  socket.on('call:join', ({ room, mode } = {}) => {
    if (!ensureCallsEnabled(socket) || !canSendCallEvent(socket.id)) return;
    const roomName = normaliseRoomName(room || socket.currentRoom);
    if (!roomName || roomName !== socket.currentRoom) return;
    if (!activeRoomCalls.has(roomName)) {
      const activityType = normaliseCallActivityMode(mode);
      const state = {
        callId: buildCallId(),
        startedAt: Date.now(),
        startedBy: socket.username || 'participant',
        startedBySocketId: socket.id,
        mode: activityType,
        mediaAnnouncements: new Set(),
      };
      activeRoomCalls.set(roomName, state);
      io.to(roomName).emit('call:started', getActiveCallSnapshot(roomName));
      notifyRoomActivity({
        room: roomName,
        activityType,
        activityId: state.callId,
        socket,
      });
    }
    const active = getActiveCallSnapshot(roomName);
    socket.emit('call:joined', active);
    socket.to(roomName).emit('call:participant-joined', { room: roomName, username: socket.username });
  });

  socket.on('call:media-start', ({ room, kind } = {}) => {
    if (!ensureCallsEnabled(socket) || !canSendCallEvent(socket.id)) return;
    const roomName = normaliseRoomName(room || socket.currentRoom);
    if (!roomName || roomName !== socket.currentRoom) return;

    const activityType = String(kind || '').trim().toLowerCase();
    if (!['video', 'screen-share'].includes(activityType)) return;

    const state = activeRoomCalls.get(roomName);
    if (!state) return;
    if (!(state.mediaAnnouncements instanceof Set)) state.mediaAnnouncements = new Set();

    const actorKey = canonicalUsername(socket.username) || socket.id;
    const dedupeKey = `${actorKey}:${activityType}`;
    if (state.mediaAnnouncements.has(dedupeKey)) return;
    state.mediaAnnouncements.add(dedupeKey);

    notifyRoomActivity({
      room: roomName,
      activityType,
      activityId: `${state.callId}:${dedupeKey}`,
      socket,
    });
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
    const targetInfo = validateCallModerationTarget(socket, roomName, target);
    if (!targetInfo) return;
    io.to(roomName).emit('call:user-muted', {
      room: roomName,
      target: targetInfo.cleanedTarget,
      by: socket.username,
    });
  });

  socket.on('call:kick-user', ({ room, target } = {}) => {
    if (!ensureCallsEnabled(socket) || !canSendCallEvent(socket.id) || !requireAdmin(socket)) return;
    const roomName = normaliseRoomName(room || socket.currentRoom);
    const targetInfo = validateCallModerationTarget(socket, roomName, target);
    if (!targetInfo) return;
    io.to(roomName).emit('call:user-kicked', {
      room: roomName,
      target: targetInfo.cleanedTarget,
      by: socket.username,
    });
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

    const actor = normaliseUsername(socket.username, '');
    const isCallStarter = Boolean(
      active.startedBySocketId && active.startedBySocketId === socket.id
    );
    if (!requireModerator(socket) && !isCallStarter) {
      socket.emit('call:error', {
        room: roomName,
        message: 'Only the call starter or an admin can end the room call.',
      });
      return;
    }

    activeRoomCalls.delete(roomName);
    activeRoomCallVideoBlocks.delete(roomName);
    io.to(roomName).emit('call:ended', {
      room: roomName,
      callId: active.callId,
      endedBy: actor || 'participant',
      endedAt: Date.now(),
    });
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

    const senderCanonicalUsername = socket.principal?.kind === 'account'
      ? String(socket.principal.canonicalUsername || '')
      : '';
    try {
      await chatMessageService.persistChatMessage({
        room: roomName,
        username: socket.username,
        senderCanonicalUsername,
        message: msgDataRaw,
      });
    } catch (err) {
      console.error('[Message] Error:', err);
    }
  });

  socket.on('message read', async ({ room, id }) => {
    try {
      const targetRoom = resolveCurrentSocketRoom(socket, room);
      if (!targetRoom || !id) return;
      const msg = await Message.findById(id);
      if (!msg) return;
      if (msg.room !== targetRoom) return;
      if (msg.deleted) return;
      if (socket.principal?.kind === 'account') {
        try {
          await readStateCoordinator.advance({
            canonicalUsername: socket.principal.canonicalUsername,
            room: targetRoom,
            messageId: String(msg._id),
            messageTimestamp: msg.timestamp,
          });
        } catch (error) {
          console.warn('[Push] socket read cursor advance failed', {
            code: String(error?.code || 'unexpected'),
          });
        }
      }
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
      const targetRoom = resolveCurrentSocketRoom(socket, room);
      if (!targetRoom || !id) return;

      const msg = await Message.findById(id);
      if (!msg || msg.deleted || msg.room !== targetRoom) return;

      const username = resolveSocketUsername(socket);
      if (!username || !isMessageAuthor(msg, username)) {
        socket.emit('toast', { type: 'warn', text: 'You can only edit your own messages.' });
        return;
      }

      const sanitized = sanitizeHtml(String(text || ''), {
        allowedTags: [],
        allowedAttributes: {},
      }).slice(0, 1000);
      msg.text = sanitized;
      await msg.save();
      io.to(targetRoom).emit('edit message', { id, text: msg.text });
    } catch(err){ console.error("[Edit] Error:", err); }
  });

  socket.on('delete message', async ({ room, id, scope }) => {
    try {
      const targetRoom = resolveCurrentSocketRoom(socket, room);
      if (!targetRoom || !id) return;

      if (scope === 'me') {
        socket.emit('delete message local', { id });
        return;
      }

      const msg = await Message.findById(id);
      if (!msg || msg.room !== targetRoom) return;

      const username = resolveSocketUsername(socket);
      const isOwner = isMessageAuthor(msg, username);

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
      const targetRoom = resolveCurrentSocketRoom(socket, room);
      if (!targetRoom || !id) return;

      const msg = await Message.findById(id);
      if (!msg || msg.deleted || msg.room !== targetRoom) return;

      msg.pinned = true;
      msg.pinnedBy = resolveSocketUsername(socket);
      await msg.save();

      const payload = msg.toJSON ? msg.toJSON() : msg;
      io.to(targetRoom).emit('message pinned', payload);
    } catch(err){ console.error("[Pin] Error:", err); }
  });

  socket.on('unpin message', async ({ room, id }) => {
    try {
      const targetRoom = resolveCurrentSocketRoom(socket, room);
      if (!targetRoom || !id) return;

      const msg = await Message.findById(id);
      if (!msg || msg.room !== targetRoom) return;

      const username = resolveSocketUsername(socket);
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

  socket.on('get pinned', async ({ room } = {}) => {
    try {
      const targetRoom = resolveCurrentSocketRoom(socket, room);
      if (!targetRoom) return;
      const pinned = await Message.find({
        room: targetRoom,
        pinned: true,
        deleted: { $ne: true },
      }).sort({ timestamp: -1 }).limit(50);
      socket.emit('pinned messages', pinned);
    } catch(err){ console.error("[Pinned fetch] Error:", err); }
  });

  socket.on('star message', async ({ room, id }) => {
    try {
      const targetRoom = resolveCurrentSocketRoom(socket, room);
      if (!targetRoom || !id) return;

      const msg = await Message.findById(id);
      if (!msg || msg.deleted || msg.room !== targetRoom) return;

      const username = resolveSocketUsername(socket);
      if (!username) return;
      if (!msg.starredBy.includes(username)) msg.starredBy.push(username);
      await msg.save();
      io.to(targetRoom).emit('message starred', { id, starredBy: msg.starredBy });
    } catch(err){ console.error("[Star] Error:", err); }
  });

  socket.on('unstar message', async ({ room, id }) => {
    try {
      const targetRoom = resolveCurrentSocketRoom(socket, room);
      if (!targetRoom || !id) return;

      const msg = await Message.findById(id);
      if (!msg || msg.deleted || msg.room !== targetRoom) return;

      const username = resolveSocketUsername(socket);
      if (!username) return;
      msg.starredBy = msg.starredBy.filter(u => u !== username);
      await msg.save();
      io.to(targetRoom).emit('message unstarred', { id, starredBy: msg.starredBy });
    } catch(err){ console.error("[Unstar] Error:", err); }
  });

  socket.on('react message', async ({ room, id, reaction }) => {
    try {
      const targetRoom = resolveCurrentSocketRoom(socket, room);
      if (!targetRoom || !id) return;

      const msg = await Message.findById(id);
      if (!msg || msg.deleted || msg.room !== targetRoom) return;

      const user = resolveSocketUsername(socket);
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
      const targetRoom = resolveCurrentSocketRoom(socket, room);
      if (!targetRoom) return;
      if (!canRunSocketQuery(socket.id)) return;

      const safeQuery = typeof query === 'string' ? query.trim().slice(0, 200) : '';
      const conditions = { room: targetRoom, deleted: { $ne: true } };

      if (filter === 'pinned') {
        conditions.pinned = true;
      } else if (filter === 'starred') {
        const username = resolveSocketUsername(socket);
        if (username) conditions.starredBy = username;
        else conditions.starredBy = { $exists: true, $not: { $size: 0 } };
      }

      const limitCount = Math.max(1, Math.min(Number(limit) || 50, 100));
      let results;
      if (safeQuery) {
        results = await Message.find({ ...conditions, $text: { $search: safeQuery } })
          .sort({ timestamp: -1 })
          .limit(limitCount);
      } else {
        results = await Message.find(conditions)
          .sort({ timestamp: -1 })
          .limit(limitCount);
      }

      const payload = results.map(m => (m.toJSON ? m.toJSON() : m));
      socket.emit('search results', { room: targetRoom, query: safeQuery, filter, results: payload });
    } catch(err){
      console.error('[Search] Error:', err);
      socket.emit('search results', { room: socket.currentRoom, query, filter, results: [] });
    }
  });

  // ----- Typing Indicator -----
  socket.on('typing', () => {
    if (!canSendTyping(socket.id)) return;
    const safeName = normaliseUsername(socket.username, '');
    if (!safeName) return;
    registerTypingUser(socket, safeName);
  });

  socket.on('stop typing', () => {
    clearTypingUser(socket);
  });

  // ----- Announcement & Moderation -----
  socket.on('announce', ({ room, text } = {}) => {
    const targetRoom = normaliseRoomName(room) || socket.currentRoom;
    if (!targetRoom || targetRoom !== socket.currentRoom) return;
    if (!requireAdmin(socket)) return;

    const clean = sanitizeHtml(String(text || ''), {
      allowedTags: [],
      allowedAttributes: {},
    }).slice(0, 1000);
    if (!clean) return;

    io.to(targetRoom).emit('announcement', {
      text: clean,
      at: new Date().toISOString(),
      by: socket.username || 'Admin',
    });
    console.log('[Announce]', targetRoom, 'broadcast by', socket.username || 'Admin');
  });

  socket.on('moderate', ({ room, cmd, target } = {}) => {
    const targetRoom = normaliseRoomName(room) || socket.currentRoom;
    if (!targetRoom || targetRoom !== socket.currentRoom) return;
    if (!requireAdmin(socket)) return;

    const cleanedTarget = normaliseUsername(target, '').trim();
    if (!cleanedTarget) return;

    const canonicalTarget = canonicalUsername(cleanedTarget);
    const presence = roomPresence.get(targetRoom);
    const targetInfo = presence
      ? Array.from(presence.values()).find(
          (entry) => canonicalUsername(entry.username) === canonicalTarget
        )
      : null;

    if (!targetInfo) {
      socket.emit('toast', { type: 'warn', text: 'That user is no longer online.' });
      return;
    }
    if (canonicalTarget === canonicalUsername(socket.username)) {
      socket.emit('toast', { type: 'warn', text: 'You cannot perform that action on yourself.' });
      return;
    }
    if (targetInfo.isAdmin) {
      socket.emit('toast', { type: 'warn', text: 'You cannot perform that action on an admin.' });
      return;
    }

    const targets = getSocketsForUser(targetRoom, canonicalTarget);
    if (!targets.length) return;

    if (cmd === 'ban') {
      addUserBan(targetRoom, canonicalTarget);
      targets.forEach((targetSocket) => {
        targetSocket.emit('moderation notice', { type: 'banned', room: targetRoom });
        targetSocket.emit('join error', 'You were banned from the room.');
        removeSocketFromRoom(targetSocket, targetRoom);
      });
      emitRoomListUpdate();
      emitRoomUsers(targetRoom);
      io.to(targetRoom).emit('user moderation', {
        room: targetRoom,
        action: 'ban',
        target: cleanedTarget,
        performedBy: socket.username || 'Admin',
      });
      io.to(targetRoom).emit('toast', { type: 'warn', text: `${cleanedTarget} was banned.` });
      console.log('[Moderate] ban', cleanedTarget, 'in', targetRoom);
      return;
    }

    if (cmd === 'kick') {
      targets.forEach((targetSocket) => {
        removeSocketFromRoom(targetSocket, targetRoom);
        targetSocket.emit('join error', 'You were kicked from the room.');
      });
      emitRoomListUpdate();
      emitRoomUsers(targetRoom);
      io.to(targetRoom).emit('user moderation', {
        room: targetRoom,
        action: 'kick',
        target: cleanedTarget,
        performedBy: socket.username || 'Admin',
      });
      io.to(targetRoom).emit('toast', { type: 'warn', text: `${cleanedTarget} was kicked.` });
      console.log('[Moderate] kick', cleanedTarget, 'from', targetRoom);
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
    try {
      dizyJamCredentialStore.revokeSocket(socket.id);
    } catch (error) {
      console.error('[DizyJam] Failed to revoke disconnected credential:', error?.message || error);
    }
    const lastRoom = socket.currentRoom;
    if (lastRoom) {
      removeSocketFromRoom(socket, lastRoom);
      emitRoomListUpdate();
    }
    clearTypingUser(socket, lastRoom);
    clearSocketRateLimitState(socket.id);
    jamSessionRateLimiter.clear(socket.id);
  });
});

// ---------------- Start Server ----------------
server.listen(PORT, BIND_HOST, () => {
  console.log("🎛️ DizyChat Fusion — Supernova Live 💜");
  console.log(`Version ${VERSION} (${BUILD})`);
  console.log(`Booted on ${new Date().toLocaleString()}`);
  console.log(`[Server] Listening on ${BIND_HOST}:${PORT}`);
});

// ---------------- Dedicated Chat Route ----------------
app.get(['/login', '/chat', '/app'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ---------------- Catch-all Route ----------------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
