// index.js (enhanced: fetch ALL messages, room-scoped typing, share-safe)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const cheerio = require('cheerio');
const fs = require('fs');
const multer = require('multer');
const sanitizeHtml = require('sanitize-html');
const Message = require('./src/models/message');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET","POST"] } });
const PORT = process.env.PORT || 10000;

// MongoDB
const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
  console.error("MONGO_URI missing");
  process.exit(1);
}
mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("🟢 Connected to MongoDB"))
  .catch(err => { console.error("❌ MongoDB error:", err); process.exit(1); });

// Static & JSON
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Uploads
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + unique + path.extname(file.originalname));
  }
});
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

// Link preview
app.get('/link-preview', async (req, res) => {
  let { url } = req.query;
  if (!url) return res.status(400).json({ error: 'No URL provided' });
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
  try {
    const response = await fetch(url, { timeout: 5000 });
    const html = await response.text();
    const $ = cheerio.load(html);
    const title = $('meta[property="og:title"]').attr('content') || $('title').text() || '';
    const image = $('meta[property="og:image"]').attr('content') || $('img').first().attr('src') || '';
    res.json({ title, image });
  } catch (err) { res.json({ title: '', image: '' }); }
});

// Full-history endpoint (handy for debugging/pagination later)
app.get('/messages', async (req, res) => {
  const room = req.query.room;
  if (!room) return res.status(400).json({ error: 'room required' });
  try {
    const msgs = await Message.find({ room }).sort({ timestamp: 1 });
    res.json(msgs);
  } catch (err) {
    console.error("Error fetching messages:", err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Socket.IO
// typingUsers: Map<room, Map<socketId, username>>
const typingUsers = new Map();
let rooms = {}; // optional: room password map
const RATE_LIMIT_WINDOW = 2000;
const MAX_MESSAGES_PER_WINDOW = 3;
const MAX_TYPING_EVENTS_PER_WINDOW = 5;

const messageTimestamps = new Map();
const typingTimestamps = new Map();

function canSendMessage(socketId) {
  const now = Date.now();
  if (!messageTimestamps.has(socketId)) messageTimestamps.set(socketId, []);
  const ts = messageTimestamps.get(socketId);
  while (ts.length && now - ts[0] > RATE_LIMIT_WINDOW) ts.shift();
  if (ts.length >= MAX_MESSAGES_PER_WINDOW) return false;
  ts.push(now);
  return true;
}
function canSendTyping(socketId) {
  const now = Date.now();
  if (!typingTimestamps.has(socketId)) typingTimestamps.set(socketId, []);
  const ts = typingTimestamps.get(socketId);
  while (ts.length && now - ts[0] > RATE_LIMIT_WINDOW) ts.shift();
  if (ts.length >= MAX_TYPING_EVENTS_PER_WINDOW) return false;
  ts.push(now);
  return true;
}

io.on('connection', socket => {
  socket.currentRoom = null;
  console.log("A user connected =>", socket.id);

  socket.on('join room', async ({ room, password }) => {
    if (!room) return socket.emit('join error', 'Room missing');
    if (rooms[room] && rooms[room] !== password) {
      socket.emit('join error', 'Incorrect room password');
      return;
    }
    socket.join(room);
    socket.currentRoom = room;
    console.log(`Socket ${socket.id} joined room: ${room}`);

    // Fetch ALL messages ascending
    try {
      const allMessages = await Message.find({ room }).sort({ timestamp: 1 });
      allMessages.forEach(msg => socket.emit('chat message', msg.toJSON ? msg.toJSON() : msg));
    } catch (err) { console.error("Error fetching messages:", err); }

    // Pinned messages
    try {
      const pinned = await Message.find({ room, pinned: true }).sort({ timestamp: -1 }).limit(20);
      socket.emit('pinned messages', pinned);
    } catch(err){ console.error("Error fetching pinned:", err); }
  });

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
      if (newMsg.room) {
        io.to(newMsg.room).emit('chat message', newMsg);
        io.to(newMsg.room).emit('message status', { id: newMsg._id, status: 'delivered' });
      } else {
        io.emit('chat message', newMsg);
      }
    } catch(err){ console.error("Error saving message:", err); }
  });

  socket.on('edit message', async ({ room, id, text }) => {
    try {
      const sanitized = sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} });
      const msg = await Message.findByIdAndUpdate(id, { text: sanitized }, { new: true });
      if (msg) io.to(room).emit('edit message', { id, text: msg.text });
    } catch(err){ console.error("Error editing message:", err); }
  });

  socket.on('delete message', async ({ room, id }) => {
    try {
      await Message.findByIdAndDelete(id);
      io.to(room).emit('delete message', id);
    } catch(err){ console.error("Error deleting message:", err); }
  });

  socket.on('pin message', async ({ room, id }) => {
    try {
      const msg = await Message.findByIdAndUpdate(id, { pinned: true }, { new: true });
      if (msg) io.to(room).emit('message pinned', msg);
    } catch(err){ console.error("Error pinning message:", err); }
  });

  socket.on('unpin message', async ({ room, id }) => {
    try {
      const msg = await Message.findByIdAndUpdate(id, { pinned: false }, { new: true });
      if (msg) io.to(room).emit('message unpinned', msg);
    } catch(err){ console.error("Error unpinning message:", err); }
  });

  socket.on('get pinned', async ({ room }) => {
    try {
      const pinned = await Message.find({ room, pinned: true }).sort({ timestamp: -1 }).limit(20);
      socket.emit('pinned messages', pinned);
    } catch(err){ console.error("Error fetching pinned:", err); }
  });

  socket.on('star message', async ({ room, id, user }) => {
    try {
      const msg = await Message.findById(id);
      if (!msg) return;
      if (!msg.starredBy.includes(user)) msg.starredBy.push(user);
      await msg.save();
      io.to(room).emit('message starred', { id, starredBy: msg.starredBy });
    } catch(err){ console.error("Error starring message:", err); }
  });

  socket.on('unstar message', async ({ room, id, user }) => {
    try {
      const msg = await Message.findById(id);
      if (!msg) return;
      msg.starredBy = msg.starredBy.filter(u => u !== user);
      await msg.save();
      io.to(room).emit('message unstarred', { id, starredBy: msg.starredBy });
    } catch(err){ console.error("Error unstarring message:", err); }
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
    } catch(err){ console.error("Error reacting to message:", err); }
  });

  // Typing — per-room
  socket.on('typing', (username) => {
    if (!canSendTyping(socket.id)) return;
    const room = socket.currentRoom;
    if (!room) return;
    if (!typingUsers.has(room)) typingUsers.set(room, new Map());
    const roomMap = typingUsers.get(room);
    roomMap.set(socket.id, username);
    io.to(room).emit('typing', Array.from(roomMap.values()));
  });

  socket.on('stop typing', () => {
    const room = socket.currentRoom;
    if (!room || !typingUsers.has(room)) return;
    const roomMap = typingUsers.get(room);
    roomMap.delete(socket.id);
    io.to(room).emit('typing', Array.from(roomMap.values()));
  });

  socket.on('disconnect', () => {
    const room = socket.currentRoom;
    if (room && typingUsers.has(room)) {
      const roomMap = typingUsers.get(room);
      roomMap.delete(socket.id);
      io.to(room).emit('typing', Array.from(roomMap.values()));
    }
  });
});

// Fallback to index.html (SPA)
server.listen(PORT, () => console.log(`🟢 Server running on port ${PORT}`));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
