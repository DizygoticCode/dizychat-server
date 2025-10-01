// ---------------- Imports ----------------
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const cheerio = require('cheerio');
const Message = require('./src/models/message'); // CommonJS model

// Fix fetch in Node CommonJS
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

dotenv.config();

// ---------------- App Setup ----------------
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 10000;

// ---------------- MongoDB Connection ----------------
const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
  console.error("❌ MONGO_URI is not defined. Set it in .env or environment variables.");
  process.exit(1);
}
const safeUri = mongoUri.replace(/:\/\/.*:.*@/, "://****:****@");
console.log(`Connecting to MongoDB at: ${safeUri}`);

mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("🟢 Connected to MongoDB"))
  .catch(err => { console.error("❌ MongoDB connection error:", err); process.exit(1); });

// ---------------- MongoDB Text Index ----------------
Message.collection.createIndex({ text: "text" })
  .then(() => console.log("✅ Text index created on Message.text"))
  .catch(err => console.error("❌ Error creating text index:", err));

// ---------------- Serve Static Files ----------------
app.use(express.static(path.join(__dirname, 'public')));

// ---------------- Link Preview Endpoint ----------------
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
  } catch (err) {
    console.error("Preview fetch error:", err.message);
    res.json({ title: '', image: '' });
  }
});
// Pin a message
socket.on('pin message', async ({ room, id }) => {
  const msg = await Message.findByIdAndUpdate(id, { pinned: true }, { new: true });
  if (msg) io.to(room).emit('message pinned', msg);
});

// Unpin
socket.on('unpin message', async ({ room, id }) => {
  const msg = await Message.findByIdAndUpdate(id, { pinned: false }, { new: true });
  if (msg) io.to(room).emit('message unpinned', msg);
});

// Star / unstar
socket.on('star message', async ({ room, id, user }) => {
  const msg = await Message.findById(id);
  if (!msg) return;
  if (!msg.starredBy.includes(user)) msg.starredBy.push(user);
  await msg.save();
  io.to(room).emit('message starred', { id, starredBy: msg.starredBy });
});

socket.on('unstar message', async ({ room, id, user }) => {
  const msg = await Message.findById(id);
  if (!msg) return;
  msg.starredBy = msg.starredBy.filter(u => u !== user);
  await msg.save();
  io.to(room).emit('message unstarred', { id, starredBy: msg.starredBy });
});
// ---------------- Pin Message ----------------
socket.on('pin message', async ({ room, id }) => {
  try {
    const msg = await Message.findByIdAndUpdate(id, { pinned: true }, { new: true });
    if (msg) io.to(room).emit('message pinned', msg);
  } catch (err) { console.error("Error pinning message:", err); }
});

// ---------------- Unpin Message ----------------
socket.on('unpin message', async ({ room, id }) => {
  try {
    const msg = await Message.findByIdAndUpdate(id, { pinned: false }, { new: true });
    if (msg) io.to(room).emit('message unpinned', msg);
  } catch (err) { console.error("Error unpinning message:", err); }
});

// ---------------- Get Pinned Messages ----------------
socket.on('get pinned', async ({ room }) => {
  try {
    const pinned = await Message.find({ room, pinned: true }).sort({ timestamp: -1 }).limit(20);
    socket.emit('pinned messages', pinned);
  } catch (err) { console.error("Error fetching pinned:", err); }
});


// ---------------- Socket.IO ----------------
let typingUsers = {};
let rooms = {}; // Store room passwords: rooms[roomName] = password

// ---------------- Rate Limiting ----------------
const RATE_LIMIT_WINDOW = 2000; // 2 seconds
const MAX_MESSAGES_PER_WINDOW = 3;
const MAX_TYPING_EVENTS_PER_WINDOW = 5;

const messageTimestamps = new Map(); // socket.id => [timestamps]
const typingTimestamps = new Map();  // socket.id => [timestamps]

function canSendMessage(socketId) {
  const now = Date.now();
  if (!messageTimestamps.has(socketId)) messageTimestamps.set(socketId, []);
  const timestamps = messageTimestamps.get(socketId);
  while (timestamps.length && now - timestamps[0] > RATE_LIMIT_WINDOW) timestamps.shift();
  if (timestamps.length >= MAX_MESSAGES_PER_WINDOW) return false;
  timestamps.push(now);
  return true;
}

function canSendTyping(socketId) {
  const now = Date.now();
  if (!typingTimestamps.has(socketId)) typingTimestamps.set(socketId, []);
  const timestamps = typingTimestamps.get(socketId);
  while (timestamps.length && now - timestamps[0] > RATE_LIMIT_WINDOW) timestamps.shift();
  if (timestamps.length >= MAX_TYPING_EVENTS_PER_WINDOW) return false;
  timestamps.push(now);
  return true;
}

// ---------------- Socket.IO Events ----------------
io.on('connection', socket => {
  console.log("A user connected");

  // ---------------- Join Room ----------------
  socket.on('join room', ({ room, password }) => {
    if (rooms[room] && rooms[room] !== password) {
      socket.emit('join error', 'Incorrect room password');
      return;
    }
    socket.join(room);
    console.log(`User joined room: ${room}`);
  });

  // ---------------- Get Room History (paginated) ----------------
  socket.on('get history', async ({ room, page = 1, limit = 50 }) => {
    try {
      const skip = (page - 1) * limit;
      const history = await Message.find({ room })
        .sort({ timestamp: 1 }) // oldest first
        .skip(skip)
        .limit(limit);
      socket.emit('room history', history);
    } catch (err) { console.error("Error fetching history:", err); }
  });

  // ---------------- Search Messages ----------------
  socket.on('search messages', async ({ room, query }) => {
    try {
      if (!query || query.trim().length < 2) return;
      const results = await Message.find({
        room,
        $text: { $search: query }
      })
      .sort({ timestamp: -1 }) // newest first
      .limit(50);
      socket.emit('search results', results);
    } catch (err) { console.error("Error searching messages:", err); }
  });

  // ---------------- Chat Message ----------------
  socket.on('chat message', async msgData => {
    if (!canSendMessage(socket.id)) return; // rate limit
    try {
      if (msgData.text.length > 1000) msgData.text = msgData.text.substring(0, 1000);

      const newMsg = new Message({
        ...msgData,
        timestamp: msgData.timestamp ? new Date(msgData.timestamp) : new Date(),
        reactions: msgData.reactions || []
      });
      await newMsg.save();

      io.to(msgData.room).emit('chat message', newMsg);
      io.to(msgData.room).emit('message status', { id: newMsg._id, status: 'delivered' });
    } catch (err) { console.error("Error saving message:", err); }
  });

  // ---------------- Edit Message ----------------
  socket.on('edit message', async ({ room, id, text }) => {
    try {
      const sanitized = text.length > 1000 ? text.substring(0, 1000) : text;
      const msg = await Message.findByIdAndUpdate(id, { text: sanitized }, { new: true });
      if (msg) io.to(room).emit('edit message', { id, text: msg.text });
    } catch (err) { console.error("Error editing message:", err); }
  });

  // ---------------- Read Message ----------------
  socket.on('read message', async ({ room, id }) => {
    try {
      await Message.findByIdAndUpdate(id, { status: 'read' });
      io.to(room).emit('message status', { id, status: 'read' });
    } catch (err) { console.error("Error marking as read:", err); }
  });

  // ---------------- Delete Message ----------------
  socket.on('delete message', async ({ room, id }) => {
    try {
      await Message.findByIdAndDelete(id);
      io.to(room).emit('delete message', id);
    } catch (err) { console.error("Error deleting message:", err); }
  });

  // ---------------- Add / Update Reaction ----------------
  socket.on('react message', async ({ room, id, reaction, username }) => {
    try {
      const msg = await Message.findById(id);
      if (!msg) return;

      const existingIndex = msg.reactions.findIndex(r => r.user === username);
      if (existingIndex >= 0) {
        msg.reactions[existingIndex].emoji = reaction;
      } else {
        msg.reactions.push({ user: username, emoji: reaction });
      }
      await msg.save();
      io.to(room).emit('update reactions', { id, reactions: msg.reactions });
    } catch (err) { console.error("Error updating reaction:", err); }
  });

  // ---------------- Typing ----------------
  socket.on('typing', username => {
    if (!canSendTyping(socket.id)) return; // rate limit
    typingUsers[socket.id] = username;
    io.emit('typing', Object.values(typingUsers));
  });

  socket.on('stop typing', () => {
    delete typingUsers[socket.id];
    io.emit('typing', Object.values(typingUsers));
  });
  // ---------------- File Uploads ----------------
const multer = require('multer');
const fs = require('fs');

// Ensure uploads folder exists
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + unique + ext);
  }
});
const upload = multer({ storage });

// Upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({
    url: fileUrl,
    name: req.file.originalname,
    type: req.file.mimetype,
    size: req.file.size
  });
});

  // ---------------- Disconnect ----------------
  socket.on('disconnect', () => {
    console.log("User disconnected");
    delete typingUsers[socket.id];
  });
});

// ---------------- Start Server ----------------
server.listen(PORT, () => console.log(`🟢 Server running on port ${PORT}`));

// ---------------- Serve index.html for all other routes ----------------
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
