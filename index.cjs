import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Message from './src/models/Message.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('🟢 Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Root route
app.get('/', (req, res) => res.send('🟢 Dizygotic Chat Server is running!'));

// ---------------- Socket.IO ----------------
const roomsTyping = {}; // track typing users per room

io.on('connection', (socket) => {
  console.log('A user connected');

  socket.on('join room', async (room, username) => {
    socket.join(room);
    console.log(`${username} joined room ${room}`);
    
    // Send message history
    const history = await Message.find({ room }).sort({ _id: 1 }).lean();
    socket.emit('history', history);

    // Track typing users
    if (!roomsTyping[room]) roomsTyping[room] = [];
  });

  socket.on('chat message', async (msg) => {
    // Save message in DB
    const dbMsg = await Message.create(msg);

    // Broadcast to room
    io.to(msg.room).emit('chat message', dbMsg);
  });

  socket.on('typing', ({ room, username }) => {
    if (!roomsTyping[room].includes(username)) roomsTyping[room].push(username);
    io.to(room).emit('typing', roomsTyping[room]);
  });

  socket.on('stop typing', ({ room, username }) => {
    roomsTyping[room] = roomsTyping[room].filter(u => u !== username);
    io.to(room).emit('typing', roomsTyping[room]);
  });

  socket.on('read message', async ({ room, id }) => {
    const msg = await Message.findById(id);
    if (msg) {
      msg.status = 'read';
      await msg.save();
      io.to(room).emit('message status', { id, status: 'read' });
    }
  });

  socket.on('disconnect', () => console.log('A user disconnected'));
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🟢 Server running on port ${PORT}`));
