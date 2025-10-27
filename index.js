// ===== DIZYCHAT FUSION — SUPERNOVA LIVE (Render Edition) =====
require('dotenv').config();

// ---------------- Imports ----------------
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');
const cheerio = require('cheerio');
const fs = require('fs');
const multer = require('multer');
const sanitizeHtml = require('sanitize-html');
const crypto = require('crypto');
const util = require('util');
const Message = require('./src/models/message');
const User = require('./src/models/user');
const RoomConfig = require('./src/models/roomConfig');

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// ---------------- App Setup ----------------
const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] }
});
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const createRateLimiter = ({ windowMs, max }) => {
  const buckets = new Map();
  const sweep = () => {
    const now = Date.now();
    for (const [key, entry] of buckets) {
      if (entry.reset <= now) {
        buckets.delete(key);
      }
    }
  };
  setInterval(sweep, windowMs).unref?.();

  return (req, res, next) => {
    const key = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    let entry = buckets.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
    }
    entry.count += 1;
    buckets.set(key, entry);
    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.reset - now) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many requests' });
    }
    return next();
  };
};

const globalHttpLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 200 });
const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 });
const uploadLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 60 });

class SimpleCache {
  constructor({ max = 500, ttl = 1000 * 60 * 10 } = {}) {
    this.max = max;
    this.ttl = ttl;
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value, options = {}) {
    const ttl = typeof options.ttl === 'number' ? options.ttl : this.ttl;
    const expiresAt = ttl ? Date.now() + ttl : 0;
    if (this.store.has(key)) {
      this.store.delete(key);
    }
    this.store.set(key, { value, expiresAt });
    if (this.store.size > this.max) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
  }
}

const linkPreviewCache = new SimpleCache({ max: 500, ttl: 1000 * 60 * 10 });
const LINK_PREVIEW_TIMEOUT_MS = 5000;
const LINK_PREVIEW_STALE_TTL = 1000 * 60 * 60;

app.use(globalHttpLimiter);
const PORT = process.env.PORT || 10000;

// ---------------- Admin ----------------
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Dizygotic';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  JWT_SECRET = crypto.randomBytes(32).toString('base64url');
  console.warn('[Auth] JWT_SECRET missing, generated ephemeral secret (sessions reset on restart).');
}
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------- MongoDB ----------------
const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
  console.error("[Mongo] MONGO_URI missing");
  process.exit(1);
}
mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log("[Mongo] Connected");
    await primeRoomConfigs();
  })
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

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + unique + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 1024 * 1024 * 1024,
  },
});

app.post('/upload', uploadLimiter, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({
    url: `/uploads/${req.file.filename}`,
    name: req.file.originalname,
    type: req.file.mimetype,
    size: req.file.size
  });
});

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File exceeds 1 GB upload limit.' });
  }
  return next(err);
});

// ---------------- Authentication ----------------

const USERNAME_REGEX = /^[a-z0-9_.-]{3,60}$/i;
const MIN_PASSWORD_LENGTH = 8;

const scryptAsync = util.promisify(crypto.scrypt);

const hashPassword = async (password) => {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(password, salt, 64);
  return `${salt.toString('base64')}:${Buffer.from(derived).toString('base64')}`;
};

const verifyPasswordHash = async (password, storedHash) => {
  if (typeof storedHash !== 'string') return false;
  const [saltB64, hashB64] = storedHash.split(':');
  if (!saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, 'base64');
  const existing = Buffer.from(hashB64, 'base64');
  const derived = await scryptAsync(password, salt, existing.length);
  if (derived.length !== existing.length) return false;
  return crypto.timingSafeEqual(Buffer.from(derived), existing);
};

const base64UrlEncode = (value) => Buffer.from(value).toString('base64url');
const base64UrlDecode = (value) => Buffer.from(value, 'base64url').toString();

const signAuthToken = (user) => {
  const header = { alg: 'HS256', typ: 'JWT' };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user._id.toString(),
    username: user.username,
    displayName: user.displayName || user.username,
    roles: user.roles || [],
    iat: nowSeconds,
    exp: nowSeconds + Math.floor(TOKEN_TTL_MS / 1000),
  };
  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${headerEncoded}.${payloadEncoded}`)
    .digest('base64url');
  return `${headerEncoded}.${payloadEncoded}.${signature}`;
};

const decodeAuthToken = (token) => {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerEncoded, payloadEncoded, signature] = parts;
  try {
    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${headerEncoded}.${payloadEncoded}`)
      .digest('base64url');
    const provided = Buffer.from(signature, 'base64url');
    const expected = Buffer.from(expectedSignature, 'base64url');
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      return null;
    }
    const payloadJson = base64UrlDecode(payloadEncoded);
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
};

const buildUserPayload = (user) => ({
  id: user._id,
  username: user.username,
  displayName: user.displayName || user.username,
  roles: user.roles || [],
});

const extractTokenFromHeader = (req) => {
  const header = req.get('authorization') || '';
  const match = header.match(/bearer\s+(.*)/i);
  return match ? match[1].trim() : '';
};

const verifyAuthToken = async (token) => {
  if (!token) return null;
  try {
    const payload = decodeAuthToken(token);
    if (!payload) return null;
    if (payload.exp && payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    const user = await User.findById(payload.sub);
    if (!user) return null;
    return user;
  } catch (err) {
    return null;
  }
};

app.post('/auth/register', authLimiter, async (req, res) => {
  try {
    const { username, password, displayName } = req.body || {};
    if (typeof username !== 'string' || !USERNAME_REGEX.test(username.trim())) {
      return res.status(400).json({ error: 'Username must be 3-60 characters (letters, numbers, ._-).' });
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    }

    const normalisedUsername = username.trim().toLowerCase();
    const existing = await User.findOne({ username: normalisedUsername });
    if (existing) {
      return res.status(409).json({ error: 'That username is already taken.' });
    }

    const passwordHash = await hashPassword(password);
    const cleanDisplay = typeof displayName === 'string'
      ? sanitizeHtml(displayName.trim(), { allowedTags: [], allowedAttributes: {} }).slice(0, 80)
      : '';

    const user = await User.create({
      username: normalisedUsername,
      displayName: cleanDisplay || normalisedUsername,
      passwordHash,
    });

    const token = signAuthToken(user);
    res.status(201).json({
      token,
      user: buildUserPayload(user),
    });
  } catch (err) {
    console.error('[Auth] Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/auth/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const normalisedUsername = username.trim().toLowerCase();
    const user = await User.findOne({ username: normalisedUsername });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const valid = await verifyPasswordHash(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    user.lastSeenAt = new Date();
    await user.save();

    const token = signAuthToken(user);
    res.json({ token, user: buildUserPayload(user) });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/auth/me', async (req, res) => {
  try {
    const token = extractTokenFromHeader(req);
    const user = await verifyAuthToken(token);
    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    res.json({ user: buildUserPayload(user) });
  } catch (err) {
    console.error('[Auth] Profile error:', err);
    res.status(500).json({ error: 'Could not verify token' });
  }
});

// ---------------- Link Preview ----------------
const normalisePreviewUrl = (value) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    parsed.hash = '';
    return {
      formatted: parsed.toString(),
      cacheKey: `${parsed.origin}${parsed.pathname}`.toLowerCase(),
    };
  } catch {
    return null;
  }
};

const buildEmptyPreview = (overrides = {}) => ({
  title: '',
  image: '',
  description: '',
  siteName: '',
  icon: '',
  ...overrides,
});

app.get('/link-preview', async (req, res) => {
  const normalised = normalisePreviewUrl(req.query?.url);
  if (!normalised) {
    return res.status(400).json({ error: 'No URL provided' });
  }

  const { formatted, cacheKey } = normalised;
  const cached = linkPreviewCache.get(cacheKey);
  if (cached) {
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.json({ ...cached, cached: true });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LINK_PREVIEW_TIMEOUT_MS);
    const response = await fetch(formatted, {
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    clearTimeout(timeout);

    const contentType = response.headers.get('content-type') || '';
    if (!/text\/html/i.test(contentType)) {
      const payload = buildEmptyPreview({ siteName: new URL(formatted).hostname });
      linkPreviewCache.set(cacheKey, payload, { ttl: LINK_PREVIEW_STALE_TTL });
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.json(payload);
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

    const ensureString = (value) => {
      if (!value) return '';
      if (Array.isArray(value)) return ensureString(value[0]);
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      return '';
    };

    const first = (value) => (Array.isArray(value) ? value[0] : value);

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

    const extractImage = (value) => {
      if (!value) return '';
      if (typeof value === 'string') return value;
      if (Array.isArray(value)) return extractImage(value[0]);
      if (typeof value === 'object') {
        return extractImage(value.url || value.contentUrl || value.secure_url || value.thumbnailUrl || value['@id']);
      }
      return '';
    };

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
      () => new URL(formatted).hostname,
    );

    const resolveAsset = (asset) => {
      if (!asset) return '';
      try {
        return new URL(asset, formatted).href;
      } catch {
        return '';
      }
    };

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

    const payload = {
      title: clean(title),
      description: clean(description),
      image: resolveAsset(clean(imageRaw)),
      icon: resolveAsset(clean(iconRaw)),
      siteName: clean(siteName) || new URL(formatted).hostname,
    };

    linkPreviewCache.set(cacheKey, payload, { ttl: LINK_PREVIEW_STALE_TTL });
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(payload);
  } catch (err) {
    const errorType = err.name === 'AbortError' ? 'timeout' : 'fetch_failed';
    console.error('[Link Preview] Error:', err.message || err);
    const payload = buildEmptyPreview({ error: errorType });
    linkPreviewCache.set(cacheKey, payload, { ttl: 60 * 1000 });
    res.json(payload);
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


// ---------------- Socket.IO ----------------
let typingUsers = {};
const roomMembers = new Map();
const roomPresence = new Map();

const roomState = new Map();

const defaultRoomState = () => ({
  password: '',
  bans: new Set(),
  blocks: new Set(),
  mutes: new Map(),
});

const hydrateRoomState = (doc) => {
  const state = defaultRoomState();
  if (!doc) return state;
  state.password = doc.password || '';
  (doc.bans || []).forEach((user) => {
    const canonical = canonicalUsername(user);
    if (canonical) state.bans.add(canonical);
  });
  (doc.blocks || []).forEach((user) => {
    const canonical = canonicalUsername(user);
    if (canonical) state.blocks.add(canonical);
  });
  (doc.mutes || []).forEach(({ user, expiresAt }) => {
    const canonical = canonicalUsername(user);
    if (!canonical) return;
    const expiry = expiresAt ? new Date(expiresAt).getTime() : 0;
    if (expiry && expiry <= Date.now()) return;
    if (expiry) state.mutes.set(canonical, expiry);
  });
  return state;
};

const serialiseRoomState = (state) => ({
  password: state.password || '',
  bans: Array.from(state.bans),
  blocks: Array.from(state.blocks),
  mutes: Array.from(state.mutes.entries()).map(([user, until]) => ({
    user,
    expiresAt: until ? new Date(until) : null,
  })),
});

const ensureRoomState = async (roomName) => {
  const key = normaliseRoomName(roomName);
  if (!key) return null;
  if (roomState.has(key)) return roomState.get(key);
  let doc = await RoomConfig.findOne({ name: key });
  if (!doc) {
    doc = await RoomConfig.create({ name: key });
  }
  const state = hydrateRoomState(doc);
  roomState.set(key, state);
  return state;
};

const persistRoomState = async (roomName) => {
  const key = normaliseRoomName(roomName);
  if (!key) return;
  const state = roomState.get(key) || defaultRoomState();
  roomState.set(key, state);
  const payload = serialiseRoomState(state);
  await RoomConfig.updateOne(
    { name: key },
    { $set: payload, $setOnInsert: { name: key } },
    { upsert: true },
  );
};

const primeRoomConfigs = async () => {
  try {
    const docs = await RoomConfig.find({});
    docs.forEach((doc) => {
      const key = normaliseRoomName(doc.name);
      if (!key) return;
      roomState.set(key, hydrateRoomState(doc));
    });

    await Promise.all(
      PERSISTENT_ROOMS.map(async (room) => {
        const key = normaliseRoomName(room);
        if (!key) return;
        await ensureRoomState(key);
        await persistRoomState(key);
      })
    );
  } catch (err) {
    console.error('[Rooms] Prime error:', err);
  }
};

const PERSISTENT_ROOMS = [
  'General Chat',
  'InfoWars Chat',
  'Drum & Bass Chat',
];
const PERSISTENT_ROOM_SET = new Set(PERSISTENT_ROOMS);

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

const normaliseUsername = (username, fallback) => {
  if (typeof username !== 'string') return fallback;
  const trimmed = username.trim();
  return trimmed ? trimmed.slice(0, 60) : fallback;
};

const normalisePassword = (password) => {
  if (typeof password !== 'string') return '';
  return password.trim().slice(0, 120);
};

const ensureMap = (map, key) => {
  if (!map.has(key)) map.set(key, new Map());
  return map.get(key);
};

const getRoomStateSnapshot = (room) => {
  const key = normaliseRoomName(room);
  if (!key) return null;
  return roomState.get(key) || null;
};

const isUserBlocked = (room, username) => {
  const canonical = canonicalUsername(username);
  const state = getRoomStateSnapshot(room);
  return state ? state.blocks.has(canonical) : false;
};

const getMuteExpiry = (room, username) => {
  const canonical = canonicalUsername(username);
  const state = getRoomStateSnapshot(room);
  if (!state) return 0;
  const until = state.mutes.get(canonical) || 0;
  if (until && until <= Date.now()) {
    state.mutes.delete(canonical);
    persistRoomState(room).catch((err) => console.error('[Rooms] Persist mute cleanup error:', err));
    return 0;
  }
  return until || 0;
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

const setUserMute = async (room, canonicalTarget, durationMs) => {
  const state = await ensureRoomState(room);
  if (!state) return 0;
  const until = Date.now() + durationMs;
  state.mutes.set(canonicalTarget, until);
  await persistRoomState(room);
  return until;
};

const clearUserMute = async (room, canonicalTarget) => {
  const state = await ensureRoomState(room);
  if (!state) return false;
  const removed = state.mutes.delete(canonicalTarget);
  if (removed) await persistRoomState(room);
  return removed;
};

const addUserBlock = async (room, canonicalTarget) => {
  const state = await ensureRoomState(room);
  if (!state) return false;
  const existed = state.blocks.has(canonicalTarget);
  state.blocks.add(canonicalTarget);
  if (!existed) await persistRoomState(room);
  return !existed;
};

const removeUserBlock = async (room, canonicalTarget) => {
  const state = await ensureRoomState(room);
  if (!state) return false;
  const removed = state.blocks.delete(canonicalTarget);
  if (removed) await persistRoomState(room);
  return removed;
};

const addUserBan = async (room, canonicalTarget) => {
  const state = await ensureRoomState(room);
  if (!state) return false;
  const existed = state.bans.has(canonicalTarget);
  state.bans.add(canonicalTarget);
  if (!existed) await persistRoomState(room);
  return !existed;
};

const getPublicRoomsSnapshot = () => {
  const rooms = new Map();

  PERSISTENT_ROOMS.forEach((room) => {
    const members = roomMembers.get(room);
    const state = getRoomStateSnapshot(room);
    rooms.set(room, {
      name: room,
      occupants: members ? members.size : 0,
      requiresPassword: Boolean(state?.password),
    });
  });

  for (const [room, members] of roomMembers.entries()) {
    if (rooms.has(room)) {
      const entry = rooms.get(room);
      entry.occupants = members ? members.size : 0;
      const state = getRoomStateSnapshot(room);
      entry.requiresPassword = Boolean(state?.password);
      continue;
    }

    if (!members || !members.size) continue;

    const state = getRoomStateSnapshot(room);
    rooms.set(room, {
      name: room,
      occupants: members.size,
      requiresPassword: Boolean(state?.password),
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

  delete typingUsers[socket.id];
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
const SOCKET_RATE_LIMIT_WINDOW = 2000;
const MAX_MESSAGES_PER_WINDOW = 3;
const MAX_TYPING_EVENTS_PER_WINDOW = 5;

const messageTimestamps = new Map();
const typingTimestamps = new Map();
const ipRateBuckets = new Map();

const takeRateToken = (ip, bucket, limit, windowMs) => {
  if (!ip) return true;
  const key = `${ip}:${bucket}`;
  const now = Date.now();
  let entry = ipRateBuckets.get(key);
  if (!entry || now - entry.start > windowMs) {
    entry = { count: 0, start: now };
  }
  entry.count += 1;
  entry.start = entry.start || now;
  ipRateBuckets.set(key, entry);
  return entry.count <= limit;
};

const getSocketIp = (socket) => {
  const forwarded = socket.handshake.headers?.['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return socket.handshake.address || socket.request?.socket?.remoteAddress || 'unknown';
};

function canSendMessage(socket) {
  const now = Date.now();
  const socketId = socket.id;
  if (!messageTimestamps.has(socketId)) messageTimestamps.set(socketId, []);
  const ts = messageTimestamps.get(socketId);
  while(ts.length && now - ts[0] > SOCKET_RATE_LIMIT_WINDOW) ts.shift();
  if (ts.length >= MAX_MESSAGES_PER_WINDOW) return false;
  ts.push(now);
  return takeRateToken(socket.ipAddress, 'message', 40, 60 * 1000);
}

function canSendTyping(socket) {
  const now = Date.now();
  const socketId = socket.id;
  if (!typingTimestamps.has(socketId)) typingTimestamps.set(socketId, []);
  const ts = typingTimestamps.get(socketId);
  while(ts.length && now - ts[0] > SOCKET_RATE_LIMIT_WINDOW) ts.shift();
  if (ts.length >= MAX_TYPING_EVENTS_PER_WINDOW) return false;
  ts.push(now);
  return takeRateToken(socket.ipAddress, 'typing', 120, 60 * 1000);
}

const HISTORY_PAGE_SIZE = 200;

const fetchHistoryChunk = async (room, { before, limit } = {}) => {
  const resolvedLimit = Math.max(1, Math.min(Number(limit) || HISTORY_PAGE_SIZE, 500));
  const conditions = { room };
  if (before) {
    const beforeDate = new Date(before);
    if (!Number.isNaN(beforeDate.getTime())) {
      conditions.timestamp = { $lt: beforeDate };
    }
  }

  const results = await Message.find(conditions)
    .sort({ timestamp: -1 })
    .limit(resolvedLimit + 1);

  const hasMore = results.length > resolvedLimit;
  const trimmed = hasMore ? results.slice(0, resolvedLimit) : results;
  const ordered = trimmed.reverse().map((m) => (m.toJSON ? m.toJSON() : m));
  const nextCursor = ordered.length ? ordered[0].timestamp : before || null;

  return {
    messages: ordered,
    hasMore,
    nextCursor,
  };
};

const sendHistoryChunk = async (socket, room, { before, limit, mode } = {}) => {
  try {
    const chunk = await fetchHistoryChunk(room, { before, limit });
    const finalMode = mode || (before ? 'prepend' : 'replace');
    socket.emit('history chunk', {
      room,
      mode: finalMode,
      ...chunk,
    });
    if (finalMode === 'replace') {
      socket.emit('load messages', chunk.messages);
      socket.emit('previous messages', chunk.messages);
    }
  } catch (err) {
    console.error('[History] Chunk error:', err);
    socket.emit('history chunk', {
      room,
      mode: mode || 'replace',
      messages: [],
      hasMore: false,
      nextCursor: null,
      error: 'history_unavailable',
    });
  }
};

const applySocketUser = (socket, user, { silent } = {}) => {
  if (!user) {
    socket.userRecord = null;
    socket.userPayload = null;
    socket.userId = null;
    socket.username = null;
    if (!silent) socket.emit('auth state', { authenticated: false, user: null });
    return;
  }

  const payload = buildUserPayload(user);
  socket.userRecord = user;
  socket.userPayload = payload;
  socket.userId = user._id.toString();
  socket.username = payload.displayName || payload.username;
  if (!silent) socket.emit('auth state', { authenticated: true, user: payload });
};

const authenticateSocketWithToken = async (socket, token, { silent } = {}) => {
  if (!token) {
    applySocketUser(socket, null, { silent });
    return false;
  }

  try {
    const user = await verifyAuthToken(token);
    if (!user) {
      applySocketUser(socket, null, { silent });
      return false;
    }

    user.lastSeenAt = new Date();
    await user.save().catch((err) => console.error('[Auth] Last seen update error:', err));
    applySocketUser(socket, user, { silent });
    return true;
  } catch (err) {
    console.error('[Auth] Socket token error:', err);
    applySocketUser(socket, null, { silent });
    return false;
  }
};

function requireAdmin(socket){
  if (!socket.isAdmin) {
    socket.emit('toast', { type: 'warn', text: '🚫 Admin only command.' });
    return false;
  }
  return true;
}

io.on('connection', async (socket) => {
  console.log('[Socket] Connected', socket.id);
  socket.ipAddress = getSocketIp(socket);
  socket.isAdmin = false;
  applySocketUser(socket, null, { silent: true });

  const handshakeToken = socket.handshake.auth?.token;
  if (handshakeToken) {
    await authenticateSocketWithToken(socket, handshakeToken, { silent: true });
  }

  socket.emit('auth state', {
    authenticated: Boolean(socket.userPayload),
    user: socket.userPayload,
  });

  socket.emit('room list', getPublicRoomsSnapshot());

  socket.on('authenticate', async ({ token } = {}) => {
    const success = await authenticateSocketWithToken(socket, token);
    if (success) refreshSocketPresence(socket);
  });

  socket.on('logout', () => {
    applySocketUser(socket, null);
    refreshSocketPresence(socket);
  });

  socket.on('join room', async ({ room, password } = {}) => {
    if (!socket.userRecord) {
      sendJoinError(socket, 'Please sign in before joining rooms.');
      return;
    }

    if (!takeRateToken(socket.ipAddress, 'join', 10, 60 * 1000)) {
      sendJoinError(socket, 'Too many join attempts. Please wait a moment.');
      return;
    }

    const roomName = normaliseRoomName(room);
    if (!roomName) {
      sendJoinError(socket, 'Room name is required');
      return;
    }

    const providedPassword = normalisePassword(password);
    const state = await ensureRoomState(roomName);
    if (!state) {
      sendJoinError(socket, 'Room is unavailable.');
      return;
    }

    if (state.password) {
      if (state.password !== providedPassword) {
        sendJoinError(socket, 'Incorrect room password');
        return;
      }
    } else if (providedPassword) {
      state.password = providedPassword;
      await persistRoomState(roomName);
    }

    const previousRoom = socket.currentRoom;
    if (previousRoom && previousRoom !== roomName) {
      removeSocketFromRoom(socket, previousRoom);
      emitRoomListUpdate();
    }

    const canonicalAccount = canonicalUsername(socket.userRecord.username);
    if (state.bans.has(canonicalAccount)) {
      sendJoinError(socket, 'You are banned from this room.');
      socket.currentRoom = null;
      return;
    }

    socket.username = socket.userRecord.displayName || socket.userRecord.username;
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
    await sendHistoryChunk(socket, roomName, { mode: 'replace' });

    // Send pinned messages
    try {
      const pinned = await Message.find({ room: roomName, pinned: true, deleted: { $ne: true } }).sort({ timestamp: -1 }).limit(50);
      socket.emit('pinned messages', pinned);
    } catch (err) { console.error("[Pinned] Error:", err); }
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

  socket.on('history request', async ({ room, before, limit } = {}) => {
    const target = normaliseRoomName(room) || socket.currentRoom;
    if (!target) return;
    if (socket.currentRoom !== target) return;
    await sendHistoryChunk(socket, target, { before, limit, mode: 'prepend' });
  });


  // ----- Admin Auth (post-join) -----
  socket.on('admin auth', ({ room, username, adminPassword }) => {
    try {
      const _user = username || socket.username;
      if (_user === ADMIN_USERNAME && adminPassword && adminPassword === ADMIN_PASSWORD) {
        socket.isAdmin = true;
        socket.emit('admin status', { isAdmin: true });
        console.log('[Admin] Authenticated', _user);
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
    if (!socket.userRecord) return;

    if (isUserBlocked(roomName, socket.username)) {
      socket.emit('moderation notice', { type: 'blocked', room: roomName, reason: 'send' });
      return;
    }

    const muteUntil = getMuteExpiry(roomName, socket.username);
    if (muteUntil) {
      socket.emit('moderation notice', { type: 'muted', room: roomName, until: muteUntil, reason: 'send' });
      return;
    }

    if (!canSendMessage(socket)) return;

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

      const newMsg = new Message({
        ...msgData,
        timestamp: msgData.timestamp ? new Date(msgData.timestamp) : new Date(),
        reactions: msgData.reactions || [],
        pinned: msgData.pinned || false,
        starredBy: msgData.starredBy || []
      });
      await newMsg.save();
      io.to(roomName).emit('chat message', newMsg);
      io.to(roomName).emit('message status', { id: newMsg._id, status: 'delivered' });
      console.log('[Message]', msgData.user, '→', roomName, ':', newMsg.text);
    } catch(err){ console.error("[Message] Error:", err); }
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
      if (!msg.starredBy.includes(user)) msg.starredBy.push(user);
      await msg.save();
      io.to(room).emit('message starred', { id, starredBy: msg.starredBy });
    } catch(err){ console.error("[Star] Error:", err); }
  });

  socket.on('unstar message', async ({ room, id, user }) => {
    try {
      const msg = await Message.findById(id);
      if (!msg || msg.deleted) return;
      if (room && msg.room !== room) return;
      msg.starredBy = msg.starredBy.filter(u => u !== user);
      await msg.save();
      io.to(room).emit('message unstarred', { id, starredBy: msg.starredBy });
    } catch(err){ console.error("[Unstar] Error:", err); }
  });

  socket.on('react message', async ({ room, id, reaction, username }) => {
    try {
      const msg = await Message.findById(id);
      if (!msg || msg.deleted) return;
      if (room && msg.room !== room) return;
      const existing = msg.reactions.findIndex(r => r.user === username);
      if (existing >= 0) msg.reactions[existing].emoji = reaction;
      else msg.reactions.push({ user: username, emoji: reaction });
      await msg.save();
      io.to(room).emit('update reactions', { id, reactions: msg.reactions });
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
  socket.on('typing', () => {
    if (!canSendTyping(socket)) return;
    typingUsers[socket.id] = socket.username;
    io.emit('typing', Object.values(typingUsers));
  });

  socket.on('stop typing', () => {
    delete typingUsers[socket.id];
    io.emit('typing', Object.values(typingUsers));
  });

  // ----- Announcement & Moderation -----
  socket.on('announce', ({ room, text }) => {
    if (!requireAdmin(socket)) return;
    const clean = sanitizeHtml(text || '', { allowedTags: [], allowedAttributes: {} });
    io.to(room).emit('announcement', { text: clean, at: new Date().toISOString(), by: socket.username || 'Admin' });
    console.log('[Announce]', room, clean);
  });

  socket.on('moderate', async ({ room, cmd, target }) => {
    if (!requireAdmin(socket)) return;
    if (!room) return;

    if (cmd === 'ban' && target) {
      const canonicalTarget = canonicalUsername(target);
      await addUserBan(room, canonicalTarget);
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

  socket.on('moderate user', async ({ room, target, action, duration }) => {
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
      if (action !== 'mute') {
        socket.emit('toast', { type: 'warn', text: 'Only admins can perform that action.' });
        return;
      }
      if (isTargetAdmin) {
        socket.emit('toast', { type: 'warn', text: 'You cannot mute an admin.' });
        return;
      }
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
      const until = await setUserMute(targetRoom, canonicalTarget, seconds * 1000);
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
      const removed = await clearUserMute(targetRoom, canonicalTarget);
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
      const added = await addUserBlock(targetRoom, canonicalTarget);
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
      const removed = await removeUserBlock(targetRoom, canonicalTarget);
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
      await addUserBan(targetRoom, canonicalTarget);
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
    delete typingUsers[socket.id];
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
