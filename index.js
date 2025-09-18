import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import Message from './src/models/Message.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // serve frontend files

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('🟢 Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

app.get('/', (req, res) => {
  res.sendFile('index.html', { root: './public' });
});

// Socket.IO
io.on('connection', (socket) => {
  console.log('A user connected');

  // Join room & send message history
  socket.on('join room', async (room) => {
    socket.join(room);
    const history = await Message.find({ room }).sort({ timestamp: 1 });
    socket.emit('chat history', history);
  });

  // Handle incoming messages
  socket.on('chat message', async (msg) => {
    const message = new Message(msg);
    await message.save();
    io.to(msg.room).emit('chat message', {
      id: message._id,
      room: msg.room,
      user: msg.user,
      text: message.text,
      timestamp: message.timestamp,
      status: message.status
    });
  });

  // Typing indicators
  socket.on('typing', (data) => {
    socket.to(data.room).emit('typing', data.user);
  });

  socket.on('stop typing', (data) => {
    socket.to(data.room).emit('stop typing', data.user);
  });

  // Message read
  socket.on('read message', async ({ room, id }) => {
    const msg = await Message.findById(id);
    if (msg) {
      msg.status = 'read';
      await msg.save();
      io.to(room).emit('message status', { id, status: 'read' });
    }
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected');
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🟢 Server running on port ${PORT}`));
