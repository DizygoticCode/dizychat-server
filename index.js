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
    const response = await fetch(url, { timeout: 5000 });
    const html = await response.text();
    const $ = cheerio.load(html);

    const title =
      $('meta[property="og:title"]').attr('content') ||
      $('title').text() ||
      '';
    const image =
      $('meta[property="og:image"]').attr('content') ||
      $('img').first().attr('src') ||
      '';

    // ✅ Add this one line before sending JSON:
    res.setHeader('Cache-Control', 'public, max-age=300');

    res.json({ title, image });
  } catch (err) {
    console.error('[Link Preview] Error:', err.message);
    res.json({ title: '', image: '' });
  }
});


// ---------------- Socket.IO ----------------
let typingUsers = {};
let rooms = {}; // room passwords (if used)
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

socket.on('join room', async ({ room, username, password }) => {
  if (rooms[room] && rooms[room] !== password) {
    socket.emit('join error', 'Incorrect room password');
    return;
  }

  // Track user identity & room
  socket.username = username || `Guest-${socket.id.slice(0, 4)}`;
  socket.currentRoom = room;

  socket.join(room);
  console.log(`User joined room: ${room} as ${socket.username}`);

  // Emit successful room join
  socket.emit('join room success');  // Added this line!

  // Load history and pinned messages
  try {
    const history = await Message.find({ room }).sort({ timestamp: 1 });
    console.log(`[History] Loaded ${history.length} messages from ${room}`);
    const plain = history.map(m => (m.toJSON ? m.toJSON() : m));
    socket.emit('load messages', plain);     // new clients
    socket.emit('previous messages', plain); // legacy clients
  } catch (err) {
    console.error("Error fetching history:", err);
  }

  // Send pinned messages
  try {
    const pinned = await Message.find({ room, pinned: true }).sort({ timestamp: -1 }).limit(50);
    socket.emit('pinned messages', pinned);
  } catch (err) { console.error("[Pinned] Error:", err); }
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
    } catch(e){ console.log('[admin auth error]', e); }
  });

  // ----- Chat message -----
  socket.on('chat message', async msgData => {
    if (!canSendMessage(socket.id)) return;
    try {
      if (msgData.text?.length > 1000) msgData.text = msgData.text.substring(0,1000);
      if (msgData.text) msgData.text = sanitizeHtml(msgData.text, { allowedTags: [], allowedAttributes: {} });

      const newMsg = new Message({
        ...msgData,
        timestamp: msgData.timestamp ? new Date(msgData.timestamp) : new Date(),
        reactions: msgData.reactions || [],
        pinned: msgData.pinned || false,
        starredBy: msgData.starredBy || []
      });
      await newMsg.save();
      io.to(msgData.room).emit('chat message', newMsg);
      io.to(msgData.room).emit('message status', { id: newMsg._id, status: 'delivered' });
      console.log('[Message]', msgData.user, '→', msgData.room, ':', newMsg.text);
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

  socket.on('delete message', async ({ room, id }) => {
    try {
      await Message.findByIdAndDelete(id);
      io.to(room).emit('delete message', id);
    } catch(err){ console.error("[Delete] Error:", err); }
  });

  socket.on('pin message', async ({ room, id }) => {
    if (!requireAdmin(socket)) return;
    try {
      const msg = await Message.findByIdAndUpdate(id, { pinned: true }, { new: true });
      if (msg) io.to(room).emit('message pinned', msg);
    } catch(err){ console.error("[Pin] Error:", err); }
  });

  socket.on('unpin message', async ({ room, id }) => {
    if (!requireAdmin(socket)) return;
    try {
      const msg = await Message.findByIdAndUpdate(id, { pinned: false }, { new: true });
      if (msg) io.to(room).emit('message unpinned', msg);
    } catch(err){ console.error("[Unpin] Error:", err); }
  });

  socket.on('get pinned', async ({ room }) => {
    try {
      const pinned = await Message.find({ room, pinned: true }).sort({ timestamp: -1 }).limit(50);
      socket.emit('pinned messages', pinned);
    } catch(err){ console.error("[Pinned fetch] Error:", err); }
  });

  socket.on('star message', async ({ room, id, user }) => {
    try {
      const msg = await Message.findById(id);
      if (!msg) return;
      if (!msg.starredBy.includes(user)) msg.starredBy.push(user);
      await msg.save();
      io.to(room).emit('message starred', { id, starredBy: msg.starredBy });
    } catch(err){ console.error("[Star] Error:", err); }
  });

  socket.on('unstar message', async ({ room, id, user }) => {
    try {
      const msg = await Message.findById(id);
      if (!msg) return;
      msg.starredBy = msg.starredBy.filter(u => u !== user);
      await msg.save();
      io.to(room).emit('message unstarred', { id, starredBy: msg.starredBy });
    } catch(err){ console.error("[Unstar] Error:", err); }
  });

  socket.on('react message', async ({ room, id, reaction, username }) => {
    try {
      const msg = await Message.findById(id);
      if (!msg) return;
      const existing = msg.reactions.findIndex(r => r.user === username);
      if (existing >= 0) msg.reactions[existing].emoji = reaction;
      else msg.reactions.push({ user: username, emoji: reaction });
      await msg.save();
      io.to(room).emit('update reactions', { id, reactions: msg.reactions });
    } catch(err){ console.error("[React] Error:", err); }
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
      if (!global.roomBans) global.roomBans = new Map();
      if (!roomBans.has(room)) roomBans.set(room, new Set());
      roomBans.get(room).add(target);
      io.to(room).emit('toast', { type: 'warn', text: `${target} was banned.` });
      console.log('[Moderate] ban', target, 'in', room);
    }
    if (cmd === 'kick' && target) {
      for (const [id, s] of io.of('/').sockets) {
        if (s.currentRoom === room && s.username === target) {
          s.leave(room);
          io.to(room).emit('toast', { type: 'warn', text: `${target} was kicked.` });
          s.emit('join error', 'You were kicked from the room.');
          console.log('[Moderate] kick', target, 'from', room);
        }
      }
    }
  });

  // ----- Disconnect -----
  socket.on('disconnect', () => {
    console.log('[Socket] Disconnected', socket.id);
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
