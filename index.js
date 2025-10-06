// ---------------- Imports ----------------
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

// ---------------- App Setup ----------------
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] }
});
const PORT = process.env.PORT || 10000;

// ---------------- MongoDB ----------------
const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
  console.error("MONGO_URI missing");
  process.exit(1);
}

mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("🟢 Connected to MongoDB"))
  .catch(err => { console.error("❌ MongoDB error:", err); process.exit(1); });

// ---------------- Static Files ----------------
app.use(express.static(path.join(__dirname, 'public')));

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
    const title = $('meta[property="og:title"]').attr('content') || $('title').text() || '';
    const image = $('meta[property="og:image"]').attr('content') || $('img').first().attr('src') || '';
    res.json({ title, image });
  } catch (err) { 
    res.json({ title: '', image: '' }); 
  }
});

// ---------------- Socket.IO ----------------
let typingUsers = {};
let rooms = {}; // room passwords
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

// ---------------- Socket.IO Handlers ----------------
io.on('connection', socket => {
  console.log("A user connected");

  // ----- Join Room -----
  socket.on('join room', async ({ room, password }) => {
    if (rooms[room] && rooms[room] !== password) {
      socket.emit('join error', 'Incorrect room password');
      return;
    }
    socket.join(room);
    console.log(`User joined room: ${room}`);

    // Fetch last 50 messages
    try {
      const lastMessages = await Message.find({ room })
        .sort({ timestamp: 1 })
        .limit(50);
      lastMessages.forEach(msg => socket.emit('chat message', msg.toJSON()));
    } catch (err) { console.error("Error fetching last messages:", err); }

    // Send pinned messages
    try {
      const pinned = await Message.find({ room, pinned: true }).sort({ timestamp: -1 }).limit(20);
      socket.emit('pinned messages', pinned);
    } catch(err){ console.error("Error fetching pinned:", err); }
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
    } catch(err){ console.error("Error saving message:", err); }
  });

  // ----- Edit / Delete / Pin / Star / React -----
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

  // ----- Disconnect -----
  socket.on('disconnect', () => {
    console.log("User disconnected");
    delete typingUsers[socket.id];
  });
});

// ---------------- Start Server ----------------
server.listen(PORT, () => console.log(`🟢 Server running on port ${PORT}`));

// ---------------- Serve index.html for all other routes ----------------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
