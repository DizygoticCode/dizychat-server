const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

// ---------------- MongoDB Connection ----------------
const mongoUri = process.env.MONGO_URI;

if (!mongoUri) {
  console.error("❌ No MONGO_URI found in environment variables");
  process.exit(1);
}

mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("🟢 Connected to MongoDB"))
.catch(err => console.error("❌ MongoDB connection error:", err));

// ---------------- MongoDB Schema ----------------
const messageSchema = new mongoose.Schema({
  room: String,
  user: String,
  text: String,
  timestamp: { type: Date, default: Date.now },
  status: { type: String, default: 'sent' },
});

const Message = mongoose.model('Message', messageSchema);

// ---------------- Static files ----------------
app.use(express.static(path.join(__dirname, 'public')));

// ---------------- Socket.IO ----------------
let typingUsers = {};

io.on('connection', (socket) => {
  console.log("A user connected");

  // Join a room
  socket.on('join room', (room) => {
    socket.join(room);
    console.log(`User joined room: ${room}`);
  });

  // Get message history
  socket.on('get history', async (room) => {
    const history = await Message.find({ room }).sort({ timestamp: 1 }).limit(50);
    socket.emit('room history', history);
  });

  // Handle new chat message
  socket.on('chat message', async (msgData) => {
    try {
      const newMsg = new Message({
        ...msgData,
        timestamp: msgData.timestamp ? new Date(msgData.timestamp) : new Date(),
      });

      await newMsg.save();

      io.to(msgData.room).emit('chat message', newMsg);
      io.to(msgData.room).emit('message status', { id: newMsg._id, status: 'delivered' });
    } catch (err) {
      console.error("Error saving message:", err);
    }
  });

  // Handle read receipts
  socket.on('read message', async ({ room, id }) => {
    try {
      await Message.findByIdAndUpdate(id, { status: 'read' });
      io.to(room).emit('message status', { id, status: 'read' });
    } catch (err) {
      console.error("Error marking as read:", err);
    }
  });

  // Typing indicators
  socket.on('typing', (username) => {
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

// ---------------- Start server ----------------
server.listen(PORT, () => {
  console.log(`🟢 Server running on port ${PORT}`);
});
