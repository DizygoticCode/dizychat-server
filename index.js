const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const cheerio = require('cheerio');

// Fix fetch in Node CommonJS
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

dotenv.config();

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

// ---------------- MongoDB Schema ----------------
const messageSchema = new mongoose.Schema({
  room: String,
  user: String,
  text: String,
  timestamp: { type: Date, default: Date.now },
  status: { type: String, default: 'sent' },
});
const Message = mongoose.model('Message', messageSchema);

// ---------------- Serve Static Files ----------------
app.use(express.static(path.join(__dirname, 'public')));

// ---------------- Link Preview Endpoint ----------------
app.get('/link-preview', async (req, res) => {
  let { url } = req.query;
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  if (!/^https?:\/\//i.test(url)) {
    url = 'http://' + url;
  }

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

// ---------------- Socket.IO ----------------
let typingUsers = {};

io.on('connection', socket => {
  console.log("A user connected");

  socket.on('join room', room => {
    socket.join(room);
    console.log(`User joined room: ${room}`);
  });

  socket.on('get history', async room => {
    try {
      const history = await Message.find({ room }).sort({ timestamp: 1 }).limit(50);
      socket.emit('room history', history);
    } catch (err) { console.error("Error fetching history:", err); }
  });

  socket.on('chat message', async msgData => {
    try {
      const newMsg = new Message({ ...msgData, timestamp: msgData.timestamp ? new Date(msgData.timestamp) : new Date() });
      await newMsg.save();
      io.to(msgData.room).emit('chat message', newMsg);
      io.to(msgData.room).emit('message status', { id: newMsg._id, status: 'delivered' });
    } catch (err) { console.error("Error saving message:", err); }
  });

  socket.on('read message', async ({ room, id }) => {
    try {
      await Message.findByIdAndUpdate(id, { status: 'read' });
      io.to(room).emit('message status', { id, status: 'read' });
    } catch (err) { console.error("Error marking as read:", err); }
  });

  socket.on('typing', username => {
    typingUsers[socket.id] = username;
    io.emit('typing', Object.values(typingUsers));
  });

  socket.on('stop typing', () => {
    delete typingUsers[socket.id];
    io.emit('typing', Object.values(typingUsers));
  });

  socket.on('disconnect', () => {
    console.log("User disconnected");
    delete typingUsers[socket.id];
    io.emit('typing', Object.values(typingUsers));
  });
});

// ---------------- Start Server ----------------
server.listen(PORT, () => console.log(`🟢 Server running on port ${PORT}`));

// ---------------- Serve index.html for all other routes ----------------
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
