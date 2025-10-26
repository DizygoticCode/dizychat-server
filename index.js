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
const Message = require('./src/models/message');

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// ---------------- App Setup ----------------
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] }
});
const PORT = process.env.PORT || 10000;

// ---------------- Admin ----------------
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Dizygotic';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

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

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + unique + path.extname(file.originalname));
  }
});

// NOTE: no explicit size limits (Render/infrastructure may still cap)
const upload = multer({ storage });

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
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

    const title = pick(
      () => $('meta[property="og:title"]').attr('content'),
      () => $('meta[name="twitter:title"]').attr('content'),
      () => $('title').text(),
    );

    const description = pick(
      () => $('meta[property="og:description"]').attr('content'),
      () => $('meta[name="description"]').attr('content'),
      () => $('meta[name="twitter:description"]').attr('content'),
    );

    const imageRaw = pick(
      () => $('meta[property="og:image"]').attr('content'),
      () => $('meta[name="twitter:image"]').attr('content'),
      () => $('link[rel="image_src"]').attr('href'),
    );

    const iconRaw = pick(
      () => $('link[rel="icon"]').attr('href'),
      () => $('link[rel="shortcut icon"]').attr('href'),
      () => $('link[rel="apple-touch-icon"]').attr('href'),
    );

    const siteName = pick(
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

    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      title: title || '',
      description: description || '',
      image: resolveAsset(imageRaw),
      icon: resolveAsset(iconRaw),
      siteName: siteName || '',
    });
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


// ---------------- Socket.IO ----------------
let typingUsers = {};
const roomPasswords = new Map();
const roomMembers = new Map();
const roomPresence = new Map();
const roomUserHistory = new Map();
const roomBans = new Map();
const roomBlocks = new Map();
const roomMutes = new Map();

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

const ensureHistoryMap = (room) => {
  if (!roomUserHistory.has(room)) roomUserHistory.set(room, new Map());
  return roomUserHistory.get(room);
};

const markUserSeen = (room, username, { isAdmin } = {}) => {
  const canonical = canonicalUsername(username);
  if (!room || !canonical) return;
  const history = ensureHistoryMap(room);
  const existing = history.get(canonical) || {};
  history.set(canonical, {
    username: username || existing.username || '',
    isAdmin: typeof isAdmin === 'boolean' ? Boolean(isAdmin) : Boolean(existing.isAdmin),
    lastSeen: Date.now(),
  });
};

const emitRoomUsers = (room) => {
  const presence = roomPresence.get(room);
  const history = roomUserHistory.get(room);

  const usersByCanonical = new Map();

  if (history) {
    for (const [canonical, record] of history.entries()) {
      if (!record?.username) continue;
      usersByCanonical.set(canonical, {
        username: record.username,
        isAdmin: Boolean(record.isAdmin),
        online: false,
        mutedUntil: getMuteExpiry(room, record.username) || 0,
        isBlocked: isUserBlocked(room, record.username),
        lastSeen: record.lastSeen || 0,
      });
    }
  }

  if (presence) {
    for (const entry of presence.values()) {
      if (!entry || !entry.username) continue;
      const canonical = canonicalUsername(entry.username);
      if (!canonical) continue;
      const existing = usersByCanonical.get(canonical) || {};
      usersByCanonical.set(canonical, {
        username: entry.username,
        isAdmin: typeof entry.isAdmin === 'boolean' ? Boolean(entry.isAdmin) : Boolean(existing.isAdmin),
        online: true,
        mutedUntil: getMuteExpiry(room, entry.username) || 0,
        isBlocked: isUserBlocked(room, entry.username),
        lastSeen: Date.now(),
      });
    }
  }

  const users = Array.from(usersByCanonical.values()).filter((entry) => entry.username);

  users.sort((a, b) => {
    if (a.online && !b.online) return -1;
    if (!a.online && b.online) return 1;
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
  markUserSeen(targetRoom, socket.username, { isAdmin: socket.isAdmin });
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
  markUserSeen(room, socket.username, { isAdmin: socket.isAdmin });
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
  return Array.from(roomMembers.entries())
    .filter(([, members]) => members && members.size)
    .map(([room, members]) => ({
      name: room,
      occupants: members.size,
      requiresPassword: Boolean(roomPasswords.get(room))
    }))
    .sort((a, b) => {
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
    if (!members.size) {
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

  markUserSeen(room, socket.username, { isAdmin: socket.isAdmin });

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
      const history = await Message.find({ room: roomName }).sort({ timestamp: 1 });
      console.log(`[History] Loaded ${history.length} messages from ${roomName}`);
      const plain = history.map(m => (m.toJSON ? m.toJSON() : m));
      socket.emit('load messages', plain);     // new clients
      socket.emit('previous messages', plain); // legacy clients
    } catch (err) {
      console.error("Error fetching history:", err);
    }

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
  socket.on('typing', username => {
    if (!canSendTyping(socket.id)) return;
    typingUsers[socket.id] = username;
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
